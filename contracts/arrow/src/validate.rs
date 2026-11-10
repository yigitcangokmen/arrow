//! Field rules for `msg` and `Config` [DEC H-06, I-13]. Errors name the field only.

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};

use crate::msg::{BuyMsg, EvalMsg, ListMsg, RehostMsg};
use crate::types::*;

const OUTLAYER_MAX_INSTRUCTIONS: u64 = 500_000_000_000;
const OUTLAYER_MAX_SECONDS: u64 = 180;
const OUTLAYER_MAX_MEMORY_MB: u32 = 4096;
const PROGRAM_URL_MAX_BYTES: usize = 2048;

pub fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `https://`, at most `max` bytes, no whitespace, control or hidden characters, no `EVENT_JSON`.
pub fn is_https_url(s: &str, max: usize) -> bool {
    s.starts_with("https://")
        && s.len() <= max
        && !s.chars().any(|c| c.is_whitespace() || c.is_control() || is_hidden_char(c))
        && !s.contains("EVENT_JSON")
}

/// Decoded length of standard (padded) base64, or None if it is not base64.
pub fn b64_len(s: &str) -> Option<usize> {
    STANDARD.decode(s).ok().map(|v| v.len())
}

/// Invisible or reordering characters a reader cannot see (X12-U7): bidi controls (Bidi_Control),
/// tag characters U+E0000-E007F, and the zero-width space, word joiner, invisible operators and BOM.
/// ZWJ and ZWNJ stay allowed (emoji sequences, Persian and Indic text).
pub fn is_hidden_char(c: char) -> bool {
    matches!(c, '\u{061C}' | '\u{200B}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{E0000}'..='\u{E007F}')
}

/// Character count in `min..=max`, no control or hidden characters, no `EVENT_JSON`.
pub fn check_text(s: &str, min: usize, max: usize) -> bool {
    let n = s.chars().count();
    n >= min && n <= max && !s.chars().any(|c| c.is_control() || is_hidden_char(c)) && !s.contains("EVENT_JSON")
}

/// Bytes `s` takes inside a JSON string: serde_json escapes `"` and `\` (control characters are refused).
pub fn json_len(s: &str) -> usize {
    s.len() + s.bytes().filter(|b| *b == b'"' || *b == b'\\').count()
}

/// A payout id that can hold USDC (X12-2): a 64-hex implicit id, an `0x` (eth-implicit) or `0s`
/// (deterministic) id with 40 lowercase hex, or a named sub-account (has a dot). A bare top-level
/// name such as a lowercased Solana address is refused: on mainnet only the registrar can create one,
/// so the proceeds would be lost or go to whoever already owns that name.
pub fn is_payout_shape(id: &str) -> bool {
    is_lower_hex(id, 64)
        || ((id.starts_with("0x") || id.starts_with("0s")) && is_lower_hex(&id[2..], 40))
        || id.contains('.')
}

pub fn is_buyer_pk(s: &str) -> bool {
    s.starts_with("04") && is_lower_hex(s, 130)
}

/// OutLayer `secrets.rs`: 1-64 bytes of [A-Za-z0-9_-].
pub fn is_secrets_profile(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn validate_list(m: &ListMsg, cfg: &Config) -> Result<(), &'static str> {
    if !check_text(&m.title, 1, TITLE_MAX_CHARS) || m.title.len() > TITLE_MAX_BYTES {
        return Err("title");
    }
    if !check_text(&m.public_desc, 0, DESC_MAX_CHARS) || m.public_desc.len() > DESC_MAX_BYTES {
        return Err("public_desc");
    }
    if m.columns.is_empty()
        || m.columns.len() > COLUMNS_MAX
        || !m.columns.iter().all(|c| check_text(c, 1, COLUMN_MAX_CHARS))
        || m.columns.iter().map(|c| json_len(c)).sum::<usize>() > COLUMNS_MAX_JSON_BYTES
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
    // SCAM-6: an inspection never costs more than the data itself.
    if m.eval_fee.0 < cfg.min_eval_fee.0 || m.eval_fee.0 > m.price.0 {
        return Err("eval_fee");
    }
    if m.max_evals == 0 || m.max_evals > cfg.max_evals_cap {
        return Err("max_evals");
    }
    // C-04 / TN-2: intents.near refuses a transfer to its sender, so a payout to the intents
    // contract (or, checked in handle_list, to this contract) would strand the seller's share.
    if let Some(p) = &m.payout {
        if !is_payout_shape(p.as_str()) || cfg.intents.as_ref() == Some(p) {
            return Err("payout");
        }
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

pub fn validate_rehost(m: &RehostMsg) -> Result<(), &'static str> {
    if !is_https_url(&m.blob_url, BLOB_URL_MAX_BYTES) {
        return Err("blob_url");
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
    use near_sdk::json_types::U128;

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
        for bad in ["https://b.test/\u{202E}nib.exe", "https://b.test/a\u{200B}b", "https://b.test/\u{E0041}"] {
            m.blob_url = bad.into();
            assert_eq!(ok(&m), Err("blob_url"), "{bad:?}");
        }

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
        // ECIES 97 + criteria bind 32 + criteria JSON 2975 = 3104 bytes (ENC-2)
        let max = STANDARD.encode(vec![7u8; 3104]);
        assert_eq!(max.len(), 4140);
        assert_eq!(validate_eval(&crit(max.clone())), Ok(()));
        assert_eq!(validate_eval(&crit(format!("{max}A"))), Err("sealed_criteria"));
        assert_eq!(validate_eval(&crit(String::new())), Err("sealed_criteria"));

        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("04") }), Ok(()));
        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("05") }), Err("buyer_pk"));
        assert_eq!(validate_buy(&BuyMsg { listing_id: 1, buyer_pk: pk("04").to_uppercase() }), Err("buyer_pk"));
    }

    /// X12-U7: bidi controls, tag characters and zero-width/invisible characters are refused in
    /// every seller string; ZWJ emoji sequences stay valid.
    #[test]
    fn hidden_characters_rejected() {
        for bad in ["Prices \u{202E}DSU 00.1", "a\u{E0041}b", "a\u{200B}b", "a\u{2066}b\u{2069}", "\u{FEFF}a", "a\u{200F}"] {
            assert!(!check_text(bad, 1, 80), "{bad:?} accepted");
        }
        assert!(check_text("family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", 1, 80));
        assert!(check_text("\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}", 1, 80), "ZWNJ (Persian) refused");
        let cfg = test_config();
        let mut m = list_msg();
        m.title = "a\u{202E}b".into();
        assert_eq!(validate_list(&m, &cfg), Err("title"));
        let mut m = list_msg();
        m.columns = vec!["sku\u{E0069}".into()];
        assert_eq!(validate_list(&m, &cfg), Err("columns"));
    }

    /// STATE-3 / C-02 / C-05: UTF-8 byte caps next to the character caps. Every ASCII listing that
    /// was valid stays valid; 4-byte characters at the character limits are refused.
    #[test]
    fn listing_byte_caps() {
        let cfg = test_config();
        let ok = |m: &ListMsg| validate_list(m, &cfg);
        let emoji = "\u{1F600}";
        let mut m = list_msg();
        m.title = emoji.repeat(80);
        assert_eq!(ok(&m), Err("title"));
        m.title = emoji.repeat(60); // 240 bytes
        assert_eq!(ok(&m), Ok(()));
        m.title = "\u{8868}".repeat(80); // CJK, 3 bytes each
        assert_eq!(ok(&m), Ok(()));

        let mut m = list_msg();
        m.public_desc = emoji.repeat(280);
        assert_eq!(ok(&m), Err("public_desc"));
        m.public_desc = "\u{8868}".repeat(280);
        assert_eq!(ok(&m), Ok(()));

        let mut m = list_msg();
        m.columns = vec![emoji.repeat(40); 64];
        assert_eq!(ok(&m), Err("columns"));
        m.columns = vec![emoji.repeat(10); 64]; // 2560 bytes
        assert_eq!(ok(&m), Ok(()));
        m.columns = vec!["x".repeat(40); 64]; // the ASCII maximum stays valid
        assert_eq!(ok(&m), Ok(()));
        m.columns = vec!["\"".repeat(40); 64]; // 5120 bytes once JSON-escaped
        assert_eq!(ok(&m), Err("columns"));
    }

    /// X12-2 / C-04 / TN-2: a payout must be an id that can hold USDC inside intents.near.
    #[test]
    fn payout_rules() {
        let cfg = test_config();
        let with = |p: &str| {
            let mut m = list_msg();
            m.payout = Some(p.parse().unwrap());
            validate_list(&m, &cfg)
        };
        for bad in ["9wzdxwbbmkg8ztbnmquxvqrayrzzdsgydlvl9zytawwm", "near", "alice", "intents.test.near", "0x66a0dfed229e920feb17aa3186f87bd00e30844", "0xzz"] {
            assert_eq!(with(bad), Err("payout"), "{bad}");
        }
        for good in ["alice.near", "seller-payout.arrowhq.near", "0x66a0dfed229e920feb17aa3186f87bd00e30844f", &"ab".repeat(32), "0s66a0dfed229e920feb17aa3186f87bd00e30844f"] {
            assert_eq!(with(good), Ok(()), "{good}");
        }
    }

    /// SCAM-6: the inspection fee may not exceed the price.
    #[test]
    fn eval_fee_not_above_price() {
        let cfg = test_config();
        let mut m = list_msg();
        m.eval_fee = U128(m.price.0 + 1);
        assert_eq!(validate_list(&m, &cfg), Err("eval_fee"));
        m.eval_fee = m.price;
        assert_eq!(validate_list(&m, &cfg), Ok(()));
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
