//! Sandbox-only stand-in for OutLayer's `request_execution` and for the intents
//! contract's `mt_transfer`. Never deployed to testnet or mainnet.
//!
//! The signature, JSON names and input checks match out-layer/outlayer
//! `contract/src/{lib.rs,execution.rs,projects.rs,secrets.rs}` (checked 2026-11-10),
//! so a misconfigured Arrow call fails here the same way it would on the real contract.
//! Real OutLayer returns `null` (not a PromiseError) on failure and on yield timeout.
//!
//! Mode selection: `?mock=<mode>` in `input_data.listing.blob_url`, else the mode stored
//! with `set_mode`, else `auto`.
//!
//! `never` yields; `resume_last(output)` then plays the worker publishing `output` for the newest
//! yield, inside the 200-block window or after it (a late publication, ARW-C3).

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::Vector;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault,
    Promise,
};

/// OutLayer base fee: kept on failure and timeout (0.001 NEAR).
pub const BASE_FEE: u128 = 1_000_000_000_000_000_000_000;
const PER_MILLION_INSTRUCTIONS: u128 = 100_000_000_000_000; // 1e14
const PER_MS: u128 = 100_000_000_000_000_000; // 1e17
pub const MAX_INSTRUCTIONS: u64 = 500_000_000_000;
pub const MAX_EXECUTION_SECONDS: u64 = 180;
pub const MAX_MEMORY_MB: u32 = 4096;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ExecutionSource {
    GitHub { repo: String, commit: String, build_target: Option<String> },
    WasmUrl { url: String, hash: String, build_target: Option<String> },
    Project { project_id: String, version_key: Option<String> },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ResourceLimits {
    pub max_instructions: Option<u64>,
    pub max_memory_mb: Option<u32>,
    pub max_execution_seconds: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SecretsReference {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ResponseFormat {
    Bytes,
    Text,
    Json,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RecordedRequest {
    pub seq: u64,
    pub predecessor: AccountId,
    pub signer: AccountId,
    pub deposit: U128,
    pub source: ExecutionSource,
    pub resource_limits: Option<ResourceLimits>,
    pub input_data: Option<String>,
    pub secrets_ref: Option<SecretsReference>,
    pub response_format: Option<ResponseFormat>,
    pub payer_account_id: Option<AccountId>,
    /// `params` as received, re-serialized to JSON text (serde_json::Value has no borsh).
    pub params: Option<String>,
    pub mode: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RecordedTransfer {
    pub seq: u64,
    pub predecessor: AccountId,
    pub receiver_id: AccountId,
    pub token_id: String,
    pub amount: U128,
    pub memo: Option<String>,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Requests,
    Transfers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockOutlayer {
    default_mode: String,
    requests: Vector<RecordedRequest>,
    transfers: Vector<RecordedTransfer>,
    pending: u32,
    /// data id of the newest `never` yield, for `resume_last`.
    last_yield: Option<[u8; 32]>,
}

#[near]
impl MockOutlayer {
    #[init]
    pub fn new() -> Self {
        Self {
            default_mode: "auto".to_string(),
            requests: Vector::new(StorageKey::Requests),
            transfers: Vector::new(StorageKey::Transfers),
            pending: 0,
            last_yield: None,
        }
    }

    /// Anyone may change the default mode. Sandbox only.
    pub fn set_mode(&mut self, mode: String) {
        self.default_mode = mode;
    }

    #[allow(clippy::too_many_arguments)]
    #[payable]
    pub fn request_execution(
        &mut self,
        source: ExecutionSource,
        resource_limits: Option<ResourceLimits>,
        input_data: Option<String>,
        secrets_ref: Option<SecretsReference>,
        response_format: Option<ResponseFormat>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) {
        if let Some(s) = &secrets_ref {
            check_profile(&s.profile);
        }
        check_source(&source);
        let limits = match &resource_limits {
            Some(l) => l.clone(),
            None => env::panic_str("mock: compile-only not supported"),
        };
        check_limits(&limits);
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit < estimate(&limits) {
            env::panic_str("Insufficient payment");
        }

        let input: Option<Value> = input_data.as_deref().and_then(|s| serde_json::from_str(s).ok());
        let mode = input
            .as_ref()
            .and_then(|v| v.pointer("/listing/blob_url"))
            .and_then(Value::as_str)
            .and_then(mode_from_url)
            .unwrap_or_else(|| self.default_mode.clone());

        let payer = payer_account_id.clone().unwrap_or_else(env::predecessor_account_id);
        self.requests.push(RecordedRequest {
            seq: u64::from(self.requests.len()) + 1,
            predecessor: env::predecessor_account_id(),
            signer: env::signer_account_id(),
            deposit: U128(deposit),
            source,
            resource_limits,
            input_data,
            secrets_ref,
            response_format,
            payer_account_id,
            params: params.map(|p| p.to_string()),
            mode: mode.clone(),
        });

        if mode == "panic" {
            env::panic_str("mock: request_execution failed");
        }
        if mode == "never" {
            self.pending += 1;
            let args = json!({ "payer": payer, "refund": U128(deposit - BASE_FEE) }).to_string();
            let idx = env::promise_yield_create(
                "mock_on_response",
                args,
                Gas::from_tgas(10),
                GasWeight(0),
                0,
            );
            self.last_yield = env::read_register(0).and_then(|id| id.try_into().ok());
            env::promise_return(idx);
            return;
        }

        refund(payer, deposit - BASE_FEE);
        let out = output_for(&mode, input.as_ref());
        env::value_return(out.as_bytes());
    }

    /// Yield callback. Resumed through `resume_last` it answers with the published output; after
    /// the yield timeout it answers like OutLayer does on timeout: raw `null`.
    #[private]
    pub fn mock_on_response(&mut self, payer: AccountId, refund: U128) {
        self.pending = self.pending.saturating_sub(1);
        self::refund(payer, refund.0);
        match env::promise_result_checked(0, 1024) {
            Ok(out) => env::value_return(&out),
            Err(_) => env::value_return(b"null"),
        }
    }

    /// The worker publishing `output` for the newest yield. Returns false when the yield is gone
    /// (already resumed or timed out): the output then reaches nobody's callback. Sandbox only.
    pub fn resume_last(&mut self, output: String) -> bool {
        match self.last_yield {
            Some(id) => env::promise_yield_resume(&id, output.as_bytes()),
            None => false,
        }
    }

    /// Records intents-style NEP-245 transfers (no balances kept).
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(amount.0 > 0, "amount should be positive");
        let _ = approval;
        self.transfers.push(RecordedTransfer {
            seq: u64::from(self.transfers.len()) + 1,
            predecessor: env::predecessor_account_id(),
            receiver_id,
            token_id,
            amount,
            memo,
        });
    }

    pub fn last_request(&self) -> Option<RecordedRequest> {
        self.requests.len().checked_sub(1).and_then(|i| self.requests.get(i).cloned())
    }

    pub fn requests_count(&self) -> u64 {
        u64::from(self.requests.len())
    }

    pub fn pending(&self) -> u32 {
        self.pending
    }

    pub fn transfers(&self) -> Vec<RecordedTransfer> {
        self.transfers.iter().cloned().collect()
    }
}

fn refund(to: AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to).transfer(NearToken::from_yoctonear(amount)).detach();
    }
}

/// `?mock=<mode>` or `&mock=<mode>` in a URL.
pub fn mode_from_url(url: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("mock="))
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}

/// OutLayer `secrets.rs` profile rule: 1-64 bytes of [A-Za-z0-9_-].
pub fn check_profile(profile: &str) {
    let ok = !profile.is_empty()
        && profile.len() <= 64
        && profile.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !ok {
        env::panic_str("secrets_ref.profile must be 1-64 characters of [A-Za-z0-9_-]");
    }
}

/// OutLayer `projects.rs` WasmUrl rules.
pub fn check_source(source: &ExecutionSource) {
    match source {
        ExecutionSource::WasmUrl { url, hash, build_target } => {
            if !url.starts_with("https://") {
                env::panic_str("wasm url must start with https://");
            }
            if url.len() > 2048 {
                env::panic_str("wasm url too long");
            }
            if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
                env::panic_str("wasm url contains whitespace or control characters");
            }
            if url.contains("EVENT_JSON") {
                env::panic_str("wasm url must not contain EVENT_JSON");
            }
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                env::panic_str("wasm hash must be 64 lowercase hex characters");
            }
            if let Some(t) = build_target {
                let ok = !t.is_empty()
                    && t.len() <= 64
                    && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
                if !ok {
                    env::panic_str("build_target must be 1-64 characters of [A-Za-z0-9._-]");
                }
            }
        }
        _ => env::panic_str("mock: only WasmUrl sources are supported"),
    }
}

fn check_limits(l: &ResourceLimits) {
    if l.max_instructions.unwrap_or(0) > MAX_INSTRUCTIONS
        || l.max_execution_seconds.unwrap_or(0) > MAX_EXECUTION_SECONDS
        || l.max_memory_mb.unwrap_or(0) > MAX_MEMORY_MB
    {
        env::panic_str("resource limits exceed the hard caps");
    }
}

/// OutLayer `estimate_cost` with the live price (base 1e21, 1e14 per million instructions, 1e17 per ms).
/// A missing limit counts as the hard cap.
pub fn estimate(l: &ResourceLimits) -> u128 {
    let instr = u128::from(l.max_instructions.unwrap_or(MAX_INSTRUCTIONS));
    let secs = u128::from(l.max_execution_seconds.unwrap_or(MAX_EXECUTION_SECONDS));
    BASE_FEE + (instr / 1_000_000) * PER_MILLION_INSTRUCTIONS + secs * 1000 * PER_MS
}

fn b64_of(byte: u8, len: usize) -> String {
    STANDARD.encode(vec![byte; len])
}

/// Raw callback bytes for a mode (everything except `never` and `panic`).
pub fn output_for(mode: &str, input: Option<&Value>) -> String {
    if let Some(raw) = mode.strip_prefix("ok:") {
        return raw.to_string();
    }
    match mode {
        "null" => return "null".to_string(),
        "late" => return r#"{"v":1,"ok":false}"#.to_string(),
        "garbage" => return r#""not an object""#.to_string(),
        _ => {}
    }
    let action = input.and_then(|v| v.get("action")).and_then(Value::as_str).unwrap_or("");
    let listing_h = input
        .and_then(|v| v.pointer("/listing/blob_sha256"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let h = if mode == "badhash" { "00".repeat(32) } else { listing_h };
    let v = if mode == "wrongv" { 2 } else { 1 };
    let short = mode == "shortr";
    match action {
        "eval" => json!({"v": v, "ok": true, "r": b64_of(1, if short { 10 } else { 98 }), "h": h}).to_string(),
        "release" => json!({"v": v, "ok": true, "k": b64_of(2, if short { 10 } else { 129 }), "h": h}).to_string(),
        "derive" => json!({"v": v, "ok": true, "pk": format!("04{}", "11".repeat(64))}).to_string(),
        _ => r#"{"v":1,"ok":false}"#.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }

    fn eval_limits() -> ResourceLimits {
        ResourceLimits { max_instructions: Some(20_000_000_000), max_memory_mb: Some(512), max_execution_seconds: Some(100) }
    }

    fn wasm(url: &str, hash: &str) -> ExecutionSource {
        ExecutionSource::WasmUrl { url: url.into(), hash: hash.into(), build_target: Some("wasm32-wasip2".into()) }
    }

    fn call(c: &mut MockOutlayer, source: ExecutionSource, profile: &str) {
        c.request_execution(
            source,
            Some(eval_limits()),
            Some(r#"{"v":1,"action":"derive"}"#.into()),
            Some(SecretsReference { profile: profile.into(), account_id: accounts(1) }),
            Some(ResponseFormat::Json),
            Some(accounts(1)),
            None,
        );
    }

    #[test]
    fn mode_from_blob_url_query() {
        assert_eq!(mode_from_url("https://b.test/x.bin?mock=never").as_deref(), Some("never"));
        assert_eq!(mode_from_url("https://b.test/x.bin?a=1&mock=null").as_deref(), Some("null"));
        assert_eq!(mode_from_url("https://b.test/x.bin"), None);
        ctx(0);
        let mut c = MockOutlayer::new();
        c.set_mode("late".into());
        assert_eq!(c.default_mode, "late");
    }

    #[test]
    fn profile_rule_matches_outlayer() {
        check_profile("arrow");
        check_profile(&"a".repeat(64));
        for bad in ["", "a b", "ç"] {
            assert!(std::panic::catch_unwind(|| check_profile(bad)).is_err(), "{bad:?} accepted");
        }
        let long = "a".repeat(65);
        assert!(std::panic::catch_unwind(|| check_profile(&long)).is_err());
    }

    #[test]
    fn wasm_url_rule_matches_outlayer() {
        let hex = "ab".repeat(32);
        check_source(&wasm("https://x.test/a.wasm", &hex));
        let bad = [
            wasm("http://x.test/a.wasm", &hex),
            wasm("https://x.test/a.wasm", &"AB".repeat(32)),
            wasm("https://x.test/a.wasm", &hex[..63]),
            wasm("https://x.test/EVENT_JSON.wasm", &hex),
            wasm("https://x.test/a b.wasm", &hex),
        ];
        for s in bad {
            let s2 = s.clone();
            assert!(std::panic::catch_unwind(move || check_source(&s2)).is_err(), "{s:?} accepted");
        }
    }

    #[test]
    fn estimate_matches_outlayer_formula() {
        assert_eq!(estimate(&eval_limits()), 11_002_000_000_000_000_000_000);
        let release = ResourceLimits { max_instructions: Some(2_000_000_000), max_memory_mb: Some(128), max_execution_seconds: Some(30) };
        assert_eq!(estimate(&release), 4_000_200_000_000_000_000_000);
    }

    #[test]
    #[should_panic(expected = "Insufficient payment")]
    fn insufficient_payment_panics() {
        ctx(estimate(&eval_limits()) - 1);
        let mut c = MockOutlayer::new();
        call(&mut c, wasm("https://x.test/a.wasm", &"ab".repeat(32)), "arrow");
    }

    #[test]
    fn request_is_recorded_with_default_mode() {
        ctx(estimate(&eval_limits()));
        let mut c = MockOutlayer::new();
        call(&mut c, wasm("https://x.test/a.wasm", &"ab".repeat(32)), "arrow");
        let r = c.last_request().unwrap();
        assert_eq!((c.requests_count(), r.mode.as_str(), r.params), (1, "auto", None));
    }

    #[test]
    fn mt_transfer_requires_one_yocto() {
        for bad in [0u128, 2] {
            let res = std::panic::catch_unwind(move || {
                ctx(bad);
                let mut c = MockOutlayer::new();
                c.mt_transfer(accounts(2), "nep141:usdc".into(), U128(5), None, None);
            });
            assert!(res.is_err(), "{bad} yocto accepted");
        }
        ctx(1);
        let mut c = MockOutlayer::new();
        c.mt_transfer(accounts(2), "nep141:usdc".into(), U128(5), None, Some("m".into()));
        let t = c.transfers();
        assert_eq!((t.len(), t[0].amount.0, t[0].receiver_id.clone()), (1, 5, accounts(2)));
    }

    #[test]
    fn outputs_per_mode() {
        let input = json!({"v":1,"action":"eval","listing":{"blob_sha256":"cd".repeat(32)}});
        let auto: Value = serde_json::from_str(&output_for("auto", Some(&input))).unwrap();
        assert_eq!(STANDARD.decode(auto["r"].as_str().unwrap()).unwrap().len(), 98);
        assert_eq!(auto["h"], "cd".repeat(32));
        assert_eq!(output_for("null", Some(&input)), "null");
        assert_eq!(output_for("late", Some(&input)), r#"{"v":1,"ok":false}"#);
        assert_eq!(output_for("ok:{\"x\":1}", None), r#"{"x":1}"#);
        let bad: Value = serde_json::from_str(&output_for("badhash", Some(&input))).unwrap();
        assert_eq!(bad["h"], "00".repeat(32));
        let rel = json!({"v":1,"action":"release","listing":{"blob_sha256":"cd".repeat(32)}});
        let k: Value = serde_json::from_str(&output_for("shortr", Some(&rel))).unwrap();
        assert_eq!(STANDARD.decode(k["k"].as_str().unwrap()).unwrap().len(), 10);
    }
}
