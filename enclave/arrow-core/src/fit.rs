//! fit_rule (DEC I-15): start at 5, minus 1 for each given structural criterion the data misses,
//! never below 1. Integer arithmetic only.

use crate::criteria::{find_col, Criteria};
use crate::stats::Stats;

fn null_ok(nulls: u32, rows: u32, ppm: u64) -> bool {
    // nulls·1_000_000 ≤ ppm·rows, in u128 so it cannot overflow
    u128::from(nulls).saturating_mul(1_000_000) <= u128::from(ppm).saturating_mul(u128::from(rows))
}

pub fn fit_rule(c: &Criteria, s: &Stats) -> u8 {
    let mut unmet: u8 = 0;
    let mut miss = |bad: bool| {
        if bad {
            unmet = unmet.saturating_add(1);
        }
    };
    let required: Vec<Option<usize>> = c.required_columns.iter().map(|r| find_col(&s.columns, r)).collect();
    miss(required.iter().any(Option::is_none));
    if let Some(n) = c.min_rows {
        miss(s.rows < n);
    }
    if c.date_column.is_some() {
        let covered = match (s.date_min, s.date_max) {
            (Some(lo), Some(hi)) => c.date_from.is_none_or(|f| lo <= f) && c.date_to.is_none_or(|t| hi >= t),
            _ => false,
        };
        miss(!covered);
    }
    if let Some(ppm) = c.max_null_rate_ppm {
        let cols: Vec<usize> = if c.required_columns.is_empty() {
            (0..s.columns.len()).collect()
        } else {
            required.iter().flatten().copied().collect()
        };
        let bad = cols.iter().any(|&i| s.nulls.get(i).is_some_and(|&n| !null_ok(n, s.rows, ppm)));
        miss(bad);
    }
    5u8.saturating_sub(unmet).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::criteria::parse_criteria;

    fn stats() -> Stats {
        Stats {
            rows: 1000,
            columns: ["date", "region", "sku", "units"].iter().map(|s| s.to_string()).collect(),
            nulls: vec![0, 10, 0, 60],
            dup_rows: 0,
            date_min: Some((2025, 1, 1)),
            date_max: Some((2025, 12, 31)),
            key_base_hashes: vec![],
        }
    }

    fn crit(extra: &str) -> Criteria {
        parse_criteria(format!(r#"{{"v":1,"text":""{extra}}}"#).as_bytes()).unwrap()
    }

    #[test]
    fn fit_rule_each_criterion_minus_one() {
        let s = stats();
        let all_met = r#","required_columns":["date","sku"],"min_rows":1000,"date_column":"date","date_from":"2025-01-01","date_to":"2025-12-31","max_null_rate":0.01"#;
        assert_eq!(fit_rule(&crit(all_met), &s), 5);
        assert_eq!(fit_rule(&crit(""), &s), 5);
        assert_eq!(fit_rule(&crit(r#","required_columns":["date","price"]"#), &s), 4);
        assert_eq!(fit_rule(&crit(r#","min_rows":1001"#), &s), 4);
        assert_eq!(fit_rule(&crit(r#","date_column":"date","date_from":"2024-12-31""#), &s), 4);
        assert_eq!(fit_rule(&crit(r#","date_column":"date","date_to":"2026-01-01""#), &s), 4);
        // no required columns: all columns count; units has 6% nulls
        assert_eq!(fit_rule(&crit(r#","max_null_rate":0.05"#), &s), 4);
        assert_eq!(fit_rule(&crit(r#","max_null_rate":0.06"#), &s), 5);
        // with required columns only those count
        assert_eq!(fit_rule(&crit(r#","required_columns":["date"],"max_null_rate":0.0"#), &s), 5);
        // all required columns missing: the null-rate rule has no column to evaluate, so it holds
        let three = r#","required_columns":["x"],"min_rows":5000,"date_column":"date","date_from":"2020-01-01","max_null_rate":0.0"#;
        assert_eq!(fit_rule(&crit(three), &s), 2);
        let none_met = r#","required_columns":["x","units"],"min_rows":5000,"date_column":"date","date_from":"2020-01-01","max_null_rate":0.0"#;
        assert_eq!(fit_rule(&crit(none_met), &s), 1);
        let mut nodates = s.clone();
        nodates.date_min = None;
        nodates.date_max = None;
        assert_eq!(fit_rule(&crit(r#","date_column":"date""#), &nodates), 4);
    }
}
