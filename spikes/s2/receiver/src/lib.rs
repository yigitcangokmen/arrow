//! S2 gate receiver (spike, not part of Arrow). Proves the refund pattern before the market
//! contract relies on it: the value a transfer notification (or its callback) returns as
//! "unused" goes back to the sender, and an OutLayer `null` (failure or yield timeout) becomes
//! a full refund plus an `arrow_refund` event.
//!
//! msg: `refund_all` -> return everything; `keep` -> keep everything;
//! `outlayer:<blob_url>` -> call OutLayer, refund on `null`.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, log, near, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};

#[near(serializers = [json])]
pub enum ExecutionSource {
    WasmUrl { url: String, hash: String, build_target: Option<String> },
}

#[near(serializers = [json])]
pub struct ResourceLimits {
    pub max_instructions: Option<u64>,
    pub max_memory_mb: Option<u32>,
    pub max_execution_seconds: Option<u64>,
}

#[near(serializers = [json])]
pub struct SecretsReference {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [json])]
pub enum ResponseFormat {
    Json,
}

#[near_sdk::ext_contract(ext_outlayer)]
#[allow(dead_code)]
pub trait OutLayer {
    #[allow(clippy::too_many_arguments)]
    fn request_execution(
        &mut self,
        source: ExecutionSource,
        resource_limits: Option<ResourceLimits>,
        input_data: Option<String>,
        secrets_ref: Option<SecretsReference>,
        response_format: Option<ResponseFormat>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    );
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct S2Receiver {
    outlayer: AccountId,
}

fn shaped(rail: &str, amount: U128) -> Value {
    if rail == "mt" {
        json!([amount])
    } else {
        json!(amount)
    }
}

#[near]
impl S2Receiver {
    #[init]
    pub fn new(outlayer: AccountId) -> Self {
        Self { outlayer }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<Value> {
        log!("s2: ft_on_transfer sender={} amount={} msg={}", sender_id, amount.0, msg);
        self.handle(amount, &msg, "ft")
    }

    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Value> {
        log!("s2: mt_on_transfer sender={} owners={:?} tokens={:?} msg={}", sender_id, previous_owner_ids, token_ids, msg);
        let amount = amounts.first().copied().unwrap_or(U128(0));
        self.handle(amount, &msg, "mt")
    }

    #[private]
    pub fn on_result(&mut self, amount: U128, rail: String) -> Value {
        let res = env::promise_result_checked(0, 1024);
        let ok = matches!(&res, Ok(b) if near_sdk::serde_json::from_slice::<Value>(b).ok().and_then(|v| v.get("ok").cloned()) == Some(json!(true)));
        if ok {
            return shaped(&rail, U128(0));
        }
        let reason = match &res {
            Ok(b) if b.as_slice() != b"null" => "not_ok",
            _ => "null",
        };
        let event = json!({"standard":"arrow","version":"1.0.0","event":"arrow_refund","data":{"reason":reason,"amount":amount}});
        log!("EVENT_JSON:{}", event);
        shaped(&rail, amount)
    }
}

impl S2Receiver {
    fn handle(&mut self, amount: U128, msg: &str, rail: &str) -> PromiseOrValue<Value> {
        if msg == "refund_all" {
            return PromiseOrValue::Value(shaped(rail, amount));
        }
        if msg == "keep" {
            return PromiseOrValue::Value(shaped(rail, U128(0)));
        }
        let blob_url = match msg.strip_prefix("outlayer:") {
            Some(u) => u,
            None => env::panic_str("s2: unknown msg"),
        };
        let input = json!({"v":1,"action":"eval","listing":{"blob_url":blob_url,"blob_sha256":"cd".repeat(32)}}).to_string();
        let call = ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(NearToken::from_millinear(10))
            .with_static_gas(Gas::from_tgas(50))
            .with_unused_gas_weight(0)
            .request_execution(
                ExecutionSource::WasmUrl {
                    url: "https://example.test/spike.wasm".into(),
                    hash: "ab".repeat(32),
                    build_target: Some("wasm32-wasip2".into()),
                },
                Some(ResourceLimits {
                    max_instructions: Some(2_000_000_000),
                    max_memory_mb: Some(128),
                    max_execution_seconds: Some(30),
                }),
                Some(input),
                Some(SecretsReference { profile: "arrow".into(), account_id: env::current_account_id() }),
                Some(ResponseFormat::Json),
                Some(env::current_account_id()),
                None,
            );
        let cb = Self::ext(env::current_account_id())
            .with_static_gas(Gas::from_tgas(20))
            .on_result(amount, rail.to_string());
        PromiseOrValue::Promise(call.then(cb))
    }
}
