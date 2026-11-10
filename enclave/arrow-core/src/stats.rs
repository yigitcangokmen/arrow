//! Pass 1 (statistics) and pass 2 (sample rows) over a dataset. fit_rule and novelty come only
//! from these deterministic numbers (DEC I-15, I-16), never from the LLM.

use std::collections::HashSet;
use std::ops::ControlFlow;

use sha2::{Digest, Sha256};

use crate::err::ArrowErr;
use crate::parse::{header, walk, Format};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StatsSpec {
    pub date_col: Option<usize>,
}

pub type Date = (u16, u8, u8);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stats {
    pub rows: u32,
    pub columns: Vec<String>,
    pub nulls: Vec<u32>,
    pub dup_rows: u32,
    pub date_min: Option<Date>,
    pub date_max: Option<Date>,
}

/// Trimmed empty, or `null|none|nan|n/a` in any case, or a missing/JSON-null cell.
pub fn is_null(cell: Option<&str>) -> bool {
    match cell {
        None => true,
        Some(c) => {
            let t = c.trim();
            t.is_empty()
                || ["null", "none", "nan", "n/a"].iter().any(|n| t.eq_ignore_ascii_case(n))
        }
    }
}

fn digits(b: &[u8]) -> Option<u32> {
    b.iter().try_fold(0u32, |acc, &d| {
        if d.is_ascii_digit() {
            acc.checked_mul(10)?.checked_add(u32::from(d.checked_sub(b'0')?))
        } else {
            None
        }
    })
}

/// The first 10 characters as `YYYY-MM-DD` with month 1-12 and day 1-31; anything else is None.
pub fn parse_date(cell: &str) -> Option<Date> {
    let b = cell.trim_start().as_bytes().get(..10)?;
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
        return None;
    }
    let y = u16::try_from(digits(b.get(..4)?)?).ok()?;
    let m = u8::try_from(digits(b.get(5..7)?)?).ok()?;
    let d = u8::try_from(digits(b.get(8..10)?)?).ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

fn row_hash(cells: &[Option<&str>]) -> [u8; 8] {
    let mut h = Sha256::new();
    for (i, c) in cells.iter().enumerate() {
        if i > 0 {
            h.update([0x1f]);
        }
        h.update(c.unwrap_or("").as_bytes());
    }
    let d = h.finalize();
    let mut out = [0u8; 8];
    out.iter_mut().zip(d.iter()).for_each(|(o, b)| *o = *b);
    out
}

/// Pass 1: row count, per-column null count, duplicate rows, date range.
pub fn compute(body: &[u8], f: Format, spec: &StatsSpec) -> Result<Stats, ArrowErr> {
    let columns = header(body, f)?;
    let mut nulls = vec![0u32; columns.len()];
    let mut seen: HashSet<[u8; 8]> = HashSet::new();
    let mut dup_rows: u32 = 0;
    let mut date_min: Option<Date> = None;
    let mut date_max: Option<Date> = None;
    let rows = walk(body, f, &columns, |_, cells| {
        for (n, c) in nulls.iter_mut().zip(cells.iter()) {
            if is_null(*c) {
                *n = n.saturating_add(1);
            }
        }
        if !seen.insert(row_hash(cells)) {
            dup_rows = dup_rows.saturating_add(1);
        }
        if let Some(dc) = spec.date_col {
            if let Some(d) = cells.get(dc).copied().flatten().and_then(parse_date) {
                date_min = Some(date_min.map_or(d, |m| m.min(d)));
                date_max = Some(date_max.map_or(d, |m| m.max(d)));
            }
        }
        Ok(ControlFlow::Continue(()))
    })?;
    Ok(Stats { rows, columns, nulls, dup_rows, date_min, date_max })
}

/// Pass 2: the cells of the rows at `idx_sorted` (ascending), stopping after the last one.
/// Missing cells become "".
pub fn collect_rows(body: &[u8], f: Format, cols: &[String], idx_sorted: &[u32]) -> Result<Vec<Vec<String>>, ArrowErr> {
    let mut out = Vec::with_capacity(idx_sorted.len());
    let mut want = idx_sorted.iter().peekable();
    if want.peek().is_none() {
        return Ok(out);
    }
    walk(body, f, cols, |i, cells| {
        if want.peek() == Some(&&i) {
            out.push(cells.iter().map(|c| c.unwrap_or("").to_owned()).collect());
            want.next();
            while want.peek() == Some(&&i) {
                want.next();
            }
        }
        Ok(if want.peek().is_none() { ControlFlow::Break(()) } else { ControlFlow::Continue(()) })
    })?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::detect;
    use rand_chacha::rand_core::{RngCore, SeedableRng};
    use rand_chacha::ChaCha20Rng;

    fn stats(input: &[u8], date_col: Option<usize>) -> Result<Stats, ArrowErr> {
        let (f, body) = detect(input)?;
        compute(body, f, &StatsSpec { date_col })
    }

    #[test]
    fn null_rate_counts() {
        let s = stats(b"a,b,c\n1,,x\nNULL, n/a ,y\nNaN,None,\n4,5,6\n", None).unwrap();
        assert_eq!(s.rows, 4);
        assert_eq!(s.nulls, vec![2, 3, 1]);
        let s = stats(b"{\"a\":1}\n{\"a\":null}\n{\"b\":2}\n", None).unwrap();
        assert_eq!(s.columns, vec!["a"]);
        assert_eq!(s.nulls, vec![2]);
    }

    #[test]
    fn dup_rows_counts() {
        let s = stats(b"a,b\n1,2\n1,2\n3,4\n1,2\n12,\n1,2\n", None).unwrap();
        assert_eq!(s.dup_rows, 3);
        // "1\x1f2" vs "12\x1f": the separator keeps them apart
        let s = stats(b"a,b\n1,2\n12,\n", None).unwrap();
        assert_eq!(s.dup_rows, 0);
    }

    #[test]
    fn date_range_iso_prefix() {
        let s = stats(
            b"d,v\n2024-03-01T10:00:00Z,1\n2023-12-31,2\nnot a date,3\n2024-13-01,4\n2025-01-32,5\n 2024-07-04,6\n",
            Some(0),
        )
        .unwrap();
        assert_eq!(s.date_min, Some((2023, 12, 31)));
        assert_eq!(s.date_max, Some((2024, 7, 4)));
        let s = stats(b"d\nx\n", Some(0)).unwrap();
        assert_eq!((s.date_min, s.date_max), (None, None));
        assert_eq!(parse_date("2024-1-01"), None);
        assert_eq!(parse_date("2024é01-01"), None);
    }

    #[test]
    fn collect_rows_returns_exact_indices() {
        let mut csv = String::from("i,sq\n");
        for i in 0..100 {
            csv.push_str(&format!("{i},{}\n", i * i));
        }
        let (f, body) = detect(csv.as_bytes()).unwrap();
        let cols = header(body, f).unwrap();
        let got = collect_rows(body, f, &cols, &[0, 7, 7, 42, 99]).unwrap();
        assert_eq!(got, vec![vec!["0", "0"], vec!["7", "49"], vec!["42", "1764"], vec!["99", "9801"]]);
        assert_eq!(collect_rows(body, f, &cols, &[]).unwrap().len(), 0);
        assert_eq!(collect_rows(body, f, &cols, &[5, 500]).unwrap(), vec![vec!["5", "25"]]);
        // Stops early: a broken tail after the last wanted row is never read.
        let broken = b"a\n1\n2\n\"unterminated";
        let (f, body) = detect(broken).unwrap();
        let cols = header(body, f).unwrap();
        assert_eq!(collect_rows(body, f, &cols, &[1]).unwrap(), vec![vec!["2"]]);
    }

    fn pipeline(input: &[u8]) {
        let Ok((f, body)) = detect(input) else { return };
        let Ok(s) = compute(body, f, &StatsSpec { date_col: Some(0) }) else { return };
        let idx: Vec<u32> = (0..s.rows).step_by(3).collect();
        let _ = collect_rows(body, f, &s.columns, &idx);
    }

    #[test]
    fn fuzz_1000_random_inputs_never_panic() {
        let mut rng = ChaCha20Rng::seed_from_u64(7);
        for _ in 0..1000 {
            let len = (rng.next_u32() % 4097) as usize;
            let mut buf = vec![0u8; len];
            rng.fill_bytes(&mut buf);
            pipeline(&buf);
        }
        let base = b"date,name,price\n2024-01-02,\"Ada, L\",3.5\n2024-02-03,Bob,4\n2024-03-04,\"multi\nline\",\n".to_vec();
        let jsonl = b"{\"date\":\"2024-01-02\",\"x\":[1,{\"y\":2}]}\n{\"date\":null}\n".to_vec();
        for i in 0..1000 {
            let mut m = if i % 2 == 0 { base.clone() } else { jsonl.clone() };
            for _ in 0..(1 + rng.next_u32() % 4) {
                if m.is_empty() {
                    break;
                }
                let pos = (rng.next_u32() as usize) % m.len();
                match rng.next_u32() % 4 {
                    0 => m[pos] ^= 1 << (rng.next_u32() % 8),
                    1 => m.truncate(pos),
                    2 => m.insert(pos, b'"'),
                    _ => m.insert(pos, b','),
                }
            }
            pipeline(&m);
        }
    }

    #[test]
    fn memory_streaming_200k_rows() {
        let mut csv = String::with_capacity(6_000_000);
        csv.push_str("date,a,b,c,d,e,f,g\n");
        for i in 0..200_000u32 {
            csv.push_str(&format!("2024-01-{:02},{},{},{},y,{},z,q\n", 1 + i % 28, i % 10, i % 7, i % 3, i % 5));
        }
        assert!(csv.len() <= crate::consts::MAX_BLOB, "{}", csv.len());
        let t = std::time::Instant::now();
        let s = stats(csv.as_bytes(), Some(0)).unwrap();
        let el = t.elapsed();
        assert_eq!(s.rows, 200_000);
        assert_eq!(s.date_min, Some((2024, 1, 1)));
        if !cfg!(debug_assertions) {
            assert!(el.as_secs_f64() < 2.0, "{el:?}");
        }
    }
}
