//! S3 spike contract (mainnet, human-deployed as arrow-spike.arrowhq.near; testnet twin for dry checks).
//! S3b: NEP-245 `mt_on_transfer` from intents.near → return value decides refund vs keep.
//! S3c: the same receipt tree calls OutLayer in chain mode and decides from its raw result.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

/// OutLayer request deposit paid from this contract's own balance (mt_on_transfer is not payable).
const OUTLAYER_DEPOSIT: NearToken = NearToken::from_millinear(20);

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Mode {
    RefundAll,
    Keep,
    Outlayer,
    OutlayerRefund,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::RefundAll => "refund_all",
            Mode::Keep => "keep",
            Mode::Outlayer => "outlayer",
            Mode::OutlayerRefund => "outlayer_refund",
        }
    }
}

/// `msg` is `{"mode":"refund_all"|"keep"|"outlayer"|"outlayer_refund"}`; anything else is None.
pub fn parse_mode(msg: &str) -> Option<Mode> {
    let v: Value = serde_json::from_str(msg).ok()?;
    match v.get("mode")?.as_str()? {
        "refund_all" => Some(Mode::RefundAll),
        "keep" => Some(Mode::Keep),
        "outlayer" => Some(Mode::Outlayer),
        "outlayer_refund" => Some(Mode::OutlayerRefund),
        _ => None,
    }
}

/// Keep the tokens only when OutLayer returned `ok:true` with a secret fingerprint and the mode is `outlayer`.
pub fn keep_after_outlayer(mode: &str, raw: Option<&[u8]>) -> bool {
    let ok = raw
        .and_then(|b| serde_json::from_slice::<Value>(b).ok())
        .map(|v| v.get("ok") == Some(&Value::Bool(true)) && v.get("pm").is_some_and(|p| !p.is_null()))
        .unwrap_or(false);
    ok && mode == "outlayer"
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Spike {
    intents: AccountId,
    outlayer: AccountId,
    usdc: String,
    wasm_url: String,
    wasm_hash: String,
    profile: String,
    last: String,
}

#[near]
impl Spike {
    #[init]
    pub fn new(
        intents: AccountId,
        outlayer: AccountId,
        usdc: String,
        wasm_url: String,
        wasm_hash: String,
        profile: String,
    ) -> Self {
        Self { intents, outlayer, usdc, wasm_url, wasm_hash, profile, last: String::new() }
    }

    /// Fallback if mainnet OutLayer refuses the testnet FastFS URL: point at another copy of the same wasm.
    pub fn set_wasm(&mut self, wasm_url: String, wasm_hash: String) {
        require!(env::predecessor_account_id() == env::current_account_id(), "self only");
        self.wasm_url = wasm_url;
        self.wasm_hash = wasm_hash;
    }

    /// NEP-245 receiver. Returns the amounts to REFUND (refund_all → amounts, keep → zeros).
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(env::predecessor_account_id() == self.intents, "predecessor must be intents");
        require!(token_ids.len() == 1 && token_ids[0] == self.usdc, "token must be USDC only");
        log!(
            "S3_NOTIFY sender={} prev={:?} tokens={:?} amounts={:?} msg={}",
            sender_id,
            previous_owner_ids,
            token_ids,
            amounts.iter().map(|a| a.0).collect::<Vec<_>>(),
            msg
        );
        let mode = parse_mode(&msg).unwrap_or_else(|| env::panic_str("bad msg"));
        self.last = format!("notify mode={} sender={} msg={}", mode.as_str(), sender_id, msg);
        match mode {
            Mode::RefundAll => PromiseOrValue::Value(amounts),
            Mode::Keep => PromiseOrValue::Value(vec![U128(0); amounts.len()]),
            Mode::Outlayer | Mode::OutlayerRefund => {
                let me = env::current_account_id();
                let args = json!({
                    "source": {"WasmUrl": {"url": self.wasm_url, "hash": self.wasm_hash, "build_target": "wasm32-wasip2"}},
                    "resource_limits": {"max_instructions": 20_000_000_000u64, "max_memory_mb": 512, "max_execution_seconds": 100},
                    "input_data": "{\"mode\":\"echo+ai\"}",
                    "secrets_ref": {"profile": self.profile, "account_id": me},
                    "response_format": "Json",
                    "payer_account_id": me,
                    "params": null
                });
                PromiseOrValue::Promise(
                    Promise::new(self.outlayer.clone())
                        .function_call(
                            "request_execution".to_string(),
                            args.to_string().into_bytes(),
                            OUTLAYER_DEPOSIT,
                            Gas::from_tgas(150),
                        )
                        .then(Self::ext(me).with_static_gas(Gas::from_tgas(60)).on_outlayer(
                            amounts,
                            mode.as_str().to_string(),
                            env::block_timestamp(),
                        )),
                )
            }
        }
    }

    #[private]
    pub fn on_outlayer(&mut self, amounts: Vec<U128>, mode: String, started_ns: u64) -> Vec<U128> {
        let elapsed_ms = env::block_timestamp().saturating_sub(started_ns) / 1_000_000;
        let raw = env::promise_result_checked(0, 1024).ok();
        let keep = keep_after_outlayer(&mode, raw.as_deref());
        let out = raw.as_deref().map(String::from_utf8_lossy).unwrap_or_default().to_string();
        let decision = if keep { "keep" } else { "refund" };
        log!("S3C_RESULT decision={} elapsed_ms={} out={}", decision, elapsed_ms, out);
        self.last = format!("outlayer mode={mode} decision={decision} elapsed_ms={elapsed_ms}");
        if keep {
            vec![U128(0); amounts.len()]
        } else {
            amounts
        }
    }

    pub fn last(&self) -> String {
        self.last.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

    fn contract() -> Spike {
        Spike::new(
            "intents.near".parse().unwrap(),
            "outlayer.near".parse().unwrap(),
            USDC.to_string(),
            "https://example.invalid/spike-tee.wasm".to_string(),
            "00".repeat(32),
            "arrow".to_string(),
        )
    }

    fn as_predecessor(p: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("arrow-spike.arrowhq.near".parse().unwrap());
        b.predecessor_account_id(p.parse().unwrap());
        testing_env!(b.build());
    }

    fn call(c: &mut Spike, msg: &str) -> PromiseOrValue<Vec<U128>> {
        c.mt_on_transfer(
            "0x1111111111111111111111111111111111111111".parse().unwrap(),
            vec!["0x1111111111111111111111111111111111111111".parse().unwrap()],
            vec![USDC.to_string()],
            vec![U128(10_000)],
            msg.to_string(),
        )
    }

    #[test]
    fn parses_modes() {
        assert_eq!(parse_mode(r#"{"mode":"refund_all"}"#), Some(Mode::RefundAll));
        assert_eq!(parse_mode(r#"{"mode":"keep"}"#), Some(Mode::Keep));
        assert_eq!(parse_mode(r#"{"mode":"outlayer"}"#), Some(Mode::Outlayer));
        assert_eq!(parse_mode(r#"{"mode":"outlayer_refund"}"#), Some(Mode::OutlayerRefund));
        assert_eq!(parse_mode(r#"{"mode":"BUY"}"#), None);
        assert_eq!(parse_mode("not json"), None);
        assert_eq!(parse_mode(r#"{"op":"eval"}"#), None);
    }

    #[test]
    fn refund_all_returns_amounts_and_keep_returns_zeros() {
        as_predecessor("intents.near");
        let mut c = contract();
        match call(&mut c, r#"{"mode":"refund_all"}"#) {
            PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(10_000)]),
            _ => panic!("expected value"),
        }
        match call(&mut c, r#"{"mode":"keep"}"#) {
            PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(0)]),
            _ => panic!("expected value"),
        }
        assert!(c.last().starts_with("notify mode=keep"));
    }

    #[test]
    #[should_panic(expected = "predecessor must be intents")]
    fn rejects_other_predecessor() {
        as_predecessor("attacker.near");
        let _ = call(&mut contract(), r#"{"mode":"keep"}"#);
    }

    #[test]
    #[should_panic(expected = "bad msg")]
    fn rejects_unknown_mode() {
        as_predecessor("intents.near");
        let _ = call(&mut contract(), r#"{"mode":"nope"}"#);
    }

    #[test]
    fn outlayer_decision() {
        let good = br#"{"v":1,"ok":true,"pm":"27b9c0a1"}"#;
        assert!(keep_after_outlayer("outlayer", Some(good)));
        assert!(!keep_after_outlayer("outlayer_refund", Some(good)));
        assert!(!keep_after_outlayer("outlayer", Some(br#"{"v":1,"ok":true,"pm":null}"#)));
        assert!(!keep_after_outlayer("outlayer", Some(br#"{"v":1,"ok":false}"#)));
        assert!(!keep_after_outlayer("outlayer", Some(b"null")));
        assert!(!keep_after_outlayer("outlayer", None));
    }
}
