//! S1-b spike contract (testnet only): calls OutLayer `request_execution` in chain mode
//! and logs the raw callback result, the same "raw result" pattern the market contract uses.

use near_sdk::serde_json::json;
use near_sdk::{env, log, near, require, AccountId, Gas, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Spike {
    outlayer: AccountId,
    wasm_url: String,
    wasm_hash: String,
    profile: String,
}

#[near]
impl Spike {
    #[init]
    pub fn new(outlayer: AccountId, wasm_url: String, wasm_hash: String, profile: String) -> Self {
        Self { outlayer, wasm_url, wasm_hash, profile }
    }

    pub fn set_wasm(&mut self, wasm_url: String, wasm_hash: String) {
        require!(env::predecessor_account_id() == env::current_account_id(), "self only");
        self.wasm_url = wasm_url;
        self.wasm_hash = wasm_hash;
    }

    pub fn get_wasm(&self) -> (String, String) {
        (self.wasm_url.clone(), self.wasm_hash.clone())
    }

    #[payable]
    pub fn run(&mut self, input: String, secrets: bool, max_seconds: u64) -> Promise {
        require!(max_seconds <= 100, "max_seconds <= 100 (yield window ~118 s)");
        let me = env::current_account_id();
        let secrets_ref = if secrets {
            json!({"profile": self.profile, "account_id": me})
        } else {
            json!(null)
        };
        // resource_limits is always Some: None makes OutLayer treat the request as compile_only.
        let args = json!({
            "source": {"WasmUrl": {"url": self.wasm_url, "hash": self.wasm_hash, "build_target": "wasm32-wasip2"}},
            "resource_limits": {"max_instructions": 20_000_000_000u64, "max_memory_mb": 512, "max_execution_seconds": max_seconds},
            "input_data": input,
            "secrets_ref": secrets_ref,
            "response_format": "Json",
            "payer_account_id": me,
            "params": null
        });
        Promise::new(self.outlayer.clone())
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                env::attached_deposit(),
                Gas::from_tgas(150),
            )
            .then(
                Self::ext(me)
                    .with_static_gas(Gas::from_tgas(60))
                    .on_result(env::block_timestamp()),
            )
    }

    #[private]
    pub fn on_result(&mut self, started_ns: u64) -> String {
        let elapsed_ms = env::block_timestamp().saturating_sub(started_ns) / 1_000_000;
        match env::promise_result_checked(0, 1024) {
            Ok(bytes) => {
                let out = String::from_utf8_lossy(&bytes).to_string();
                log!("S1B_RESULT ok elapsed_ms={} out={}", elapsed_ms, out);
                out
            }
            Err(e) => {
                log!("S1B_RESULT err={:?} elapsed_ms={}", e, elapsed_ms);
                String::new()
            }
        }
    }
}
