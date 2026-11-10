//! Field rules for `msg` and `Config` [DEC H-06, I-13]. Errors name the field only.

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};

use crate::msg::{BuyMsg, EvalMsg, ListMsg};
use crate::types::*;

const OUTLAYER_MAX_INSTRUCTIONS: u64 = 500_000_000_000;
const OUTLAYER_MAX_SECONDS: u64 = 180;
const OUTLAYER_MAX_MEMORY_MB: u32 = 4096;
const PROGRAM_URL_MAX_BYTES: usize = 2048;

pub fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `https://`, at most `max` bytes, no whitespace or control characters, no `EVENT_JSON`.
pub fn is_https_url(s: &str, max: usize) -> bool {
    s.starts_with("https://")
        && s.len() <= max
        && !s.chars().any(|c| c.is_whitespace() || c.is_control())
        && !s.contains("EVENT_JSON")
}

/// Decoded length of standard (padded) base64, or None if it is not base64.
pub fn b64_len(s: &str) -> Option<usize> {
    STANDARD.decode(s).ok().map(|v| v.len())
}

/// Character count in `min..=max`, no control characters, no `EVENT_JSON`.
pub fn check_text(s: &str, min: usize, max: usize) -> bool {
    let n = s.chars().count();
    n >= min && n <= max && !s.chars().any(char::is_control) && !s.contains("EVENT_JSON")
}

pub fn is_buyer_pk(s: &str) -> bool {
    s.starts_with("04") && is_lower_hex(s, 130)
}

/// OutLayer `secrets.rs`: 1-64 bytes of [A-Za-z0-9_-].
pub fn is_secrets_profile(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn validate_list(m: &ListMsg, cfg: &Config) -> Result<(), &'static str> {
    if !check_text(&m.title, 1, TITLE_MAX_CHARS) {
        return Err("title");
    }
    if !check_text(&m.public_desc, 0, DESC_MAX_CHARS) {
        return Err("public_desc");
    }
    if m.columns.is_empty()
        || m.columns.len() > COLUMNS_MAX
        || !m.columns.iter().all(|c| check_text(c, 1, COLUMN_MAX_CHARS))
    {
        return Err("columns");
    }
    if m.rows_claimed > ROWS_CLAIMED_MAX {
        return Err("rows_claimed");
    }
    if !is_https_url(&m.blob_url, BLOB_URL_MAX_BYTES) {
        return Err("blob_url");
    }
    if !is_lower_hex(&m.blob_sha256, 64) {
        return Err("blob_sha256");
    }
    if b64_len(&m.sealed_k) != Some(SEALED_K_LIST_LEN) {
        return Err("sealed_k");
    }
    if m.price.0 < cfg.min_price.0 {
        return Err("price");
    }
    if m.eval_fee.0 < cfg.min_eval_fee.0 {
        return Err("eval_fee");
    }
    if m.max_evals == 0 || m.max_evals > cfg.max_evals_cap {
        return Err("max_evals");
    }
    Ok(())
}

pub fn validate_eval(m: &EvalMsg) -> Result<(), &'static str> {
    if m.sealed_criteria.len() > MAX_SEALED_CRITERIA_B64 || !matches!(b64_len(&m.sealed_criteria), Some(n) if n >= 1) {
        return Err("sealed_criteria");
    }
    if !is_buyer_pk(&m.buyer_pk) {
        return Err("buyer_pk");
    }
    Ok(())
}

pub fn validate_buy(m: &BuyMsg) -> Result<(), &'static str> {
    if !is_buyer_pk(&m.buyer_pk) {
        return Err("buyer_pk");
    }
    Ok(())
}

pub fn validate_program(url: &str, hash: &str) -> Result<(), &'static str> {
    if !is_https_url(url, PROGRAM_URL_MAX_BYTES) {
        return Err("program_wasm_url");
    }
    if !is_lower_hex(hash, 64) {
        return Err("program_wasm_hash");
    }
    Ok(())
}

fn limits_ok(l: &Limits) -> bool {
    (1..=OUTLAYER_MAX_INSTRUCTIONS).contains(&l.max_instructions)
        && (1..=OUTLAYER_MAX_SECONDS).contains(&l.max_execution_seconds)
        && (1..=OUTLAYER_MAX_MEMORY_MB).contains(&l.max_memory_mb)
}

pub fn validate_config(cfg: &Config) -> Result<(), &'static str> {
    if cfg.fee_bps_eval > 10_000 || cfg.fee_bps_sale > 10_000 {
        return Err("fee_bps");
    }
    if cfg.min_eval_fee.0 == 0 || cfg.min_price.0 == 0 {
        return Err("min_amounts");
    }
    if cfg.max_evals_cap == 0 || cfg.max_evals_cap > MAX_EVALS_HARD_CAP {
        return Err("max_evals_cap");
    }
    if cfg.outlayer_deposit_eval.0 == 0 || cfg.outlayer_deposit_release.0 == 0 {
        return Err("outlayer_deposit");
    }
    validate_program(&cfg.program_wasm_url, &cfg.program_wasm_hash)?;
    if !is_secrets_profile(&cfg.secrets_ref.profile) {
        return Err("secrets_ref");
    }
    if !limits_ok(&cfg.limits_eval) || !limits_ok(&cfg.limits_release) {
        return Err("limits");
    }
    if cfg.testnet_caps.is_some() != cfg!(feature = "testnet") {
        return Err("testnet_caps");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{list_msg, test_config};

    fn pk(prefix: &str) -> String {
        format!("{prefix}{}", "ab".repeat(64))
    }

    #[test]
    fn validate_limits_table() {
        let cfg = test_config();
        let ok = |m: &ListMsg| validate_list(m, &cfg);
        let base = list_msg();
        assert_eq!(ok(&base), Ok(()));

        let mut m = base.clone();
        m.title = "T".repeat(80);
        assert_eq!(ok(&m), Ok(()));
        m.title = "T".repeat(81);
        assert_eq!(ok(&m), Err("title"));
        m.title = "ç".repeat(80); // characters, not bytes
        assert_eq!(ok(&m), Ok(()));

        let mut m = base.clone();
        m.columns = (0..64).map(|i| format!("c{i}")).collect();
        assert_eq!(ok(&m), Ok(()));
        m.columns.push("c64".into());
        assert_eq!(ok(&m), Err("columns"));
        m.columns = vec!["x".repeat(40)];
        assert_eq!(ok(&m), Ok(()));
        m.columns = vec!["x".repeat(41)];
        assert_eq!(ok(&m), Err("columns"));

        let mut m = base.clone();
        let prefix = "https://b.test/";
        m.blob_url = format!("{prefix}{}", "a".repeat(200 - prefix.len()));
        assert_eq!(ok(&m), Ok(()));
        m.blob_url.push('a');
        assert_eq!(ok(&m), Err("blob_url"));

        let mut m = base.clone();
        for (len, want) in [(63, Err("blob_sha256")), (64, Ok(())), (65, Err("blob_sha256"))] {
            m.blob_sha256 = "a".repeat(len);
            assert_eq!(ok(&m), want, "sha len {len}");
        }

        let mut m = base.clone();
        m.rows_claimed = ROWS_CLAIMED_MAX;
        assert_eq!(ok(&m), Ok(()));
        m.rows_claimed += 1;
        assert_eq!(ok(&m), Err("rows_claimed"));

        let mut m = base.clone();
        m.max_evals = 500;
        assert_eq!(ok(&m), Ok(()));
        m.max_evals = 501;
        assert_eq!(ok(&m), Err("max_evals"));

        let crit = |b64: String| EvalMsg { listing_id: 1, sealed_criteria: b64, buyer_pk: pk("04") };
        let max = STANDARD.encode(vec![7u8; 3072]);
        assert_eq!(max.len(), 4096);
        assert_eq!(validate_eval(&crit(max.clone())), Ok(()));
        assert_eq!(validate_eval(&crit(format!("{max}A"))), Err("sealed_criteria"));
        assert_eq!(validate_eval(&crit(String::new())), Err("sealed_criteria"));

        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("04") }), Ok(()));
        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("05") }), Err("buyer_pk"));
        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("04").to_uppercase() }), Err("buyer_pk"));
    }

    #[test]
    fn event_json_substring_rejected() {
        let cfg = test_config();
        let mut m = list_msg();
        m.title = "x EVENT_JSON y".into();
        assert_eq!(validate_list(&m, &cfg), Err("title"));
        let mut m = list_msg();
        m.columns = vec!["EVENT_JSON:".into()];
        assert_eq!(validate_list(&m, &cfg), Err("columns"));
        let mut m = list_msg();
        m.blob_url = "https://b.test/EVENT_JSON".into();
        assert_eq!(validate_list(&m, &cfg), Err("blob_url"));
    }

    #[test]
    fn config_rules() {
        assert_eq!(validate_config(&test_config()), Ok(()));
        let mut c = test_config();
        c.fee_bps_eval = 10_001;
        assert_eq!(validate_config(&c), Err("fee_bps"));
        let mut c = test_config();
        c.max_evals_cap = 501;
        assert_eq!(validate_config(&c), Err("max_evals_cap"));
        let mut c = test_config();
        c.program_wasm_url = "http://x.test/a.wasm".into();
        assert_eq!(validate_config(&c), Err("program_wasm_url"));
        let mut c = test_config();
        c.program_wasm_hash = "AB".repeat(32);
        assert_eq!(validate_config(&c), Err("program_wasm_hash"));
        let mut c = test_config();
        c.secrets_ref.profile = "a b".into();
        assert_eq!(validate_config(&c), Err("secrets_ref"));
        let mut c = test_config();
        c.limits_eval.max_execution_seconds = 181;
        assert_eq!(validate_config(&c), Err("limits"));
    }
}
