//! Unit-test fixtures shared by the modules' tests.

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_sdk::json_types::U128;
use near_sdk::AccountId;

use crate::msg::ListMsg;
use crate::types::*;

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

pub fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

pub fn self_id() -> AccountId {
    acc("arrow.test.near")
}

pub fn test_config() -> Config {
    Config {
        outlayer: acc("outlayer.test.near"),
        intents: Some(acc("intents.test.near")),
        usdc_token_id: "nep141:usdc.test.near".into(),
        program_wasm_url: "https://example.test/arrow-tee.wasm".into(),
        program_wasm_hash: "ab".repeat(32),
        secrets_ref: SecretsRef { profile: "arrow".into(), account_id: self_id() },
        treasury: acc("treasury.test.near"),
        fee_bps_eval: 1000,
        fee_bps_sale: 200,
        min_eval_fee: U128(50_000),
        min_price: U128(100_000),
        listing_bond: U128(100_000),
        max_evals_cap: 500,
        outlayer_deposit_eval: U128(NEAR / 50),
        outlayer_deposit_release: U128(NEAR / 100),
        tank_min: U128(NEAR / 20),
        limits_eval: Limits { max_instructions: 20_000_000_000, max_memory_mb: 512, max_execution_seconds: 100 },
        limits_release: Limits { max_instructions: 2_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 },
        testnet_caps: if cfg!(feature = "testnet") {
            Some(TestnetCaps { per_account_per_day: 10, global_per_day: 400, exempt: vec![acc("bench.test.near")] })
        } else {
            None
        },
    }
}

pub fn list_msg() -> ListMsg {
    ListMsg {
        title: "Retail sales (synthetic)".into(),
        public_desc: "Daily units per SKU.".into(),
        columns: vec!["date".into(), "sku".into(), "units".into()],
        rows_claimed: 12_000,
        blob_url: format!("https://b.test/{}.bin", "cd".repeat(32)),
        blob_sha256: "cd".repeat(32),
        sealed_k: STANDARD.encode([3u8; SEALED_K_LIST_LEN]),
        price: U128(250_000),
        eval_fee: U128(100_000),
        max_evals: 20,
        mode: Mode::Scored,
        payout: None,
    }
}
