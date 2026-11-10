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

pub fn setup_with_deposit(predecessor: AccountId, balance: u128, deposit: u128) {
    let mut b = near_sdk::test_utils::VMContextBuilder::new();
    b.current_account_id(self_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .account_balance(near_sdk::NearToken::from_yoctonear(balance))
        .attached_deposit(near_sdk::NearToken::from_yoctonear(deposit));
    near_sdk::testing_env!(b.build());
}

pub fn setup(predecessor: AccountId, balance: u128) {
    setup_with_deposit(predecessor, balance, 0);
}

pub fn intents() -> AccountId {
    acc("intents.test.near")
}

pub fn seller() -> AccountId {
    acc("0x66a0dfed229e920feb17aa3186f87bd00e30844f")
}

/// A contract with the program key set (list/eval/buy need it).
pub fn contract() -> crate::Contract {
    let mut c = crate::Contract::new(test_config());
    c.program_pubkey = Some(format!("04{}", "11".repeat(64)));
    c
}

pub fn msg_json(m: crate::msg::Msg) -> String {
    near_sdk::serde_json::to_string(&m).unwrap()
}

/// Calls mt_on_transfer as intents.near with one USDC token and returns the immediate value.
pub fn mt_call(c: &mut crate::Contract, from: AccountId, amount: u128, msg: String) -> near_sdk::PromiseOrValue<near_sdk::serde_json::Value> {
    let token = c.cfg.usdc_token_id.clone();
    c.mt_on_transfer(from.clone(), vec![from], vec![token], vec![U128(amount)], msg)
}

pub fn value_of(r: near_sdk::PromiseOrValue<near_sdk::serde_json::Value>) -> near_sdk::serde_json::Value {
    match r {
        near_sdk::PromiseOrValue::Value(v) => v,
        near_sdk::PromiseOrValue::Promise(_) => panic!("expected a value, got a promise"),
    }
}

/// (receiver, method, args JSON) of every function call receipt created so far.
pub fn calls() -> Vec<(String, String, near_sdk::serde_json::Value, u128)> {
    use near_sdk::mock::MockAction;
    let mut out = Vec::new();
    for r in near_sdk::test_utils::get_created_receipts() {
        for a in r.actions {
            if let MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } = a {
                let v = near_sdk::serde_json::from_slice(&args).unwrap_or(near_sdk::serde_json::Value::Null);
                out.push((r.receiver_id.to_string(), String::from_utf8(method_name).unwrap(), v, attached_deposit.as_yoctonear()));
            }
        }
    }
    out
}

pub fn buyer() -> AccountId {
    acc("0x1111111111111111111111111111111111111111")
}

/// Context of an `on_*` callback with one promise result.
pub fn callback_env(result: near_sdk::PromiseResult) {
    let mut b = near_sdk::test_utils::VMContextBuilder::new();
    b.current_account_id(self_id())
        .predecessor_account_id(self_id())
        .account_balance(near_sdk::NearToken::from_yoctonear(10 * NEAR));
    near_sdk::testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
