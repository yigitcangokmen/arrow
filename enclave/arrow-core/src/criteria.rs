//! Buyer criteria (DEC I-14). `fixtures/criteria-schema.json` is binding: unknown fields are
//! rejected and `text` is required. Every rule violation is `Err(Criteria)`.

use serde::Deserialize;

use crate::consts::{MAX_COLS, MAX_CRITERIA_BYTES, MAX_ROWS};
use crate::err::ArrowErr;
use crate::minhash::{parse_signature, K};
use crate::normalize::normalize_key;
use crate::stats::{parse_date, Date, StatsSpec};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    v: u8,
    #[serde(default)]
    required_columns: Vec<String>,
    min_rows: Option<u32>,
    date_column: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    max_null_rate: Option<f64>,
    key_column: Option<String>,
    text: String,
    #[serde(default = "d4")]
    min_fit: u8,
    #[serde(default = "d3")]
    min_novelty: u8,
    minhash: Option<String>,
}

fn d4() -> u8 {
    4
}
fn d3() -> u8 {
    3
}

/// Validated criteria. `max_null_rate_ppm` is round(max_null_rate · 1e6).
#[derive(Clone, Debug, PartialEq)]
pub struct Criteria {
    pub required_columns: Vec<String>,
    pub min_rows: Option<u32>,
    pub date_column: Option<String>,
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub max_null_rate_ppm: Option<u64>,
    pub key_column: Option<String>,
    pub text: String,
    pub min_fit: u8,
    pub min_novelty: u8,
    pub minhash: Option<[u64; K]>,
}

const MAX_NAME_CHARS: usize = 40;
const MAX_TEXT_CHARS: usize = 600;

fn name_ok(s: &str) -> bool {
    let n = s.chars().count();
    (1..=MAX_NAME_CHARS).contains(&n)
}

fn strict_date(s: &Option<String>) -> Result<Option<Date>, ArrowErr> {
    match s {
        None => Ok(None),
        Some(d) if d.len() == 10 => parse_date(d).map(Some).ok_or(ArrowErr::Criteria),
        Some(_) => Err(ArrowErr::Criteria),
    }
}

pub fn parse_criteria(plain: &[u8]) -> Result<Criteria, ArrowErr> {
    if plain.len() > MAX_CRITERIA_BYTES {
        return Err(ArrowErr::Criteria);
    }
    let r: Raw = serde_json::from_slice(plain).map_err(|_| ArrowErr::Criteria)?;
    let ok = r.v == 1
        && r.required_columns.len() <= MAX_COLS
        && r.required_columns.iter().all(|c| name_ok(c))
        && r.min_rows.is_none_or(|n| n <= MAX_ROWS)
        && r.date_column.as_deref().is_none_or(name_ok)
        && r.key_column.as_deref().is_none_or(name_ok)
        && r.text.chars().count() <= MAX_TEXT_CHARS
        && (1..=5).contains(&r.min_fit)
        && (1..=5).contains(&r.min_novelty)
        && (r.date_column.is_some() || (r.date_from.is_none() && r.date_to.is_none()));
    if !ok {
        return Err(ArrowErr::Criteria);
    }
    let date_from = strict_date(&r.date_from)?;
    let date_to = strict_date(&r.date_to)?;
    if let (Some(a), Some(b)) = (date_from, date_to) {
        if a > b {
            return Err(ArrowErr::Criteria);
        }
    }
    let max_null_rate_ppm = match r.max_null_rate {
        None => None,
        Some(x) if x.is_finite() && (0.0..=1.0).contains(&x) => Some((x * 1e6).round() as u64),
        Some(_) => return Err(ArrowErr::Criteria),
    };
    let minhash = r.minhash.as_deref().map(parse_signature).transpose()?;
    Ok(Criteria {
        required_columns: r.required_columns,
        min_rows: r.min_rows,
        date_column: r.date_column,
        date_from,
        date_to,
        max_null_rate_ppm,
        key_column: r.key_column,
        text: r.text,
        min_fit: r.min_fit,
        min_novelty: r.min_novelty,
        minhash,
    })
}

/// Column lookup by `normalize_key` equality; the parsed header is the truth, not the seller's
/// declared column list.
pub fn find_col(cols: &[String], name: &str) -> Option<usize> {
    let want = normalize_key(name);
    cols.iter().position(|c| normalize_key(c) == want)
}

/// Which columns pass 1 must look at for these criteria.
pub fn stats_spec(c: &Criteria, cols: &[String]) -> StatsSpec {
    StatsSpec {
        date_col: c.date_column.as_deref().and_then(|d| find_col(cols, d)),
        key_col: c.minhash.and(c.key_column.as_deref()).and_then(|k| find_col(cols, k)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn criteria_rejects_2032_minhash() {
        let j = format!(r#"{{"v":1,"text":"x","minhash":"{}"}}"#, "0".repeat(2032));
        assert_eq!(parse_criteria(j.as_bytes()), Err(ArrowErr::Criteria));
        let j = format!(r#"{{"v":1,"text":"x","minhash":"{}"}}"#, "0".repeat(2048));
        assert_eq!(parse_criteria(j.as_bytes()).unwrap().minhash, Some([0u64; K]));
    }

    #[test]
    fn criteria_rejects_oversize() {
        let pad = " ".repeat(MAX_CRITERIA_BYTES);
        let j = format!(r#"{{"v":1,"text":"x"}}{pad}"#);
        assert_eq!(parse_criteria(j.as_bytes()), Err(ArrowErr::Criteria));
    }

    #[test]
    fn criteria_rules() {
        let bad = [
            r#"{"v":2,"text":""}"#,
            r#"{"v":1}"#,
            r#"{"v":1,"text":"","min_novelty":0}"#,
            r#"{"v":1,"text":"","min_rows":200001}"#,
            r#"{"v":1,"text":"","date_from":"2025-01-01"}"#,
            r#"{"v":1,"text":"","date_column":"d","date_from":"2025-02-01","date_to":"2025-01-01"}"#,
            r#"{"v":1,"text":"","date_column":"d","date_from":"2025-1-01"}"#,
            r#"{"v":1,"text":"","date_column":"d","date_from":"2025-01-01x"}"#,
            r#"{"v":1,"text":"","max_null_rate":1.5}"#,
            r#"{"v":1,"text":"","max_null_rate":-0.1}"#,
            r#"{"v":1,"text":"","required_columns":[""]}"#,
            r#"{"v":1,"text":"","key_column":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
            "not json",
        ];
        for b in bad {
            assert_eq!(parse_criteria(b.as_bytes()), Err(ArrowErr::Criteria), "{b}");
        }
        let c = parse_criteria(br#"{"v":1,"text":"","max_null_rate":0.0500004,"date_column":"d","date_to":"2025-12-31"}"#).unwrap();
        assert_eq!((c.min_fit, c.min_novelty, c.max_null_rate_ppm), (4, 3, Some(50_000)));
        assert_eq!(c.date_to, Some((2025, 12, 31)));
    }

    #[test]
    fn find_col_normalized() {
        let cols: Vec<String> = ["Date", " SKU ", "ｕｎｉｔｓ"].iter().map(|s| s.to_string()).collect();
        assert_eq!(find_col(&cols, "date"), Some(0));
        assert_eq!(find_col(&cols, "sku"), Some(1));
        assert_eq!(find_col(&cols, "Units"), Some(2));
        assert_eq!(find_col(&cols, "region"), None);
    }
}
