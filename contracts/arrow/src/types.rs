//! Shared types. JSON names here are the interface for the SDK (zod), web and enclave.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

pub const BITS_SCORED_MILLI: u32 = 5673; // ceil(1000*log2(51))  [DEC A.1 G1]
pub const BITS_VERDICT_MILLI: u32 = 1585; // ceil(1000*log2(3))
pub const SEALED_RESULT_LEN: usize = 98; // ECIES overhead 97 + 1 byte index  [DEC I-09]
pub const SEALED_K_LEN: usize = 129; // 97 + 32 (release output k)
pub const SEALED_K_LIST_LEN: usize = 193; // 97 + 96 (seller's sealed K || blob_sha256 || sha256(seller)) [DEC J-04, ENC-1]
pub const MAX_OUTPUT_BYTES: usize = 1024; // promise_result_checked bound
pub const OUTPUT_LIMIT_BYTES: usize = 900; // OutLayer blockchain-mode output limit [DEC I-07]
pub const MAX_SEALED_CRITERIA_B64: usize = 4140; // 97 + 32 (buyer/listing bind, ENC-2) + 2975 criteria = 3104 bytes
pub const INPUT_EVENT_THRESHOLD: usize = 10_000; // OutLayer puts larger input in state, keep below
pub const ESCROW_STALE_NS: u64 = 15 * 60 * 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * 1_000_000_000;

pub const TITLE_MAX_CHARS: usize = 80;
pub const DESC_MAX_CHARS: usize = 280;
pub const COLUMNS_MAX: usize = 64;
pub const COLUMN_MAX_CHARS: usize = 40;
pub const BLOB_URL_MAX_BYTES: usize = 200;
pub const ROWS_CLAIMED_MAX: u64 = 200_000;
pub const MAX_EVALS_HARD_CAP: u32 = 500;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SecretsRef {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Limits {
    pub max_instructions: u64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TestnetCaps {
    pub per_account_per_day: u32,
    pub global_per_day: u32,
    pub exempt: Vec<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub outlayer: AccountId,
    pub intents: Option<AccountId>,
    pub usdc_token_id: String,
    pub program_wasm_url: String,
    pub program_wasm_hash: String,
    pub secrets_ref: SecretsRef,
    pub treasury: AccountId,
    pub fee_bps_eval: u16,
    pub fee_bps_sale: u16,
    pub min_eval_fee: U128,
    pub min_price: U128,
    pub listing_bond: U128,
    pub max_evals_cap: u32,
    pub outlayer_deposit_eval: U128,
    pub outlayer_deposit_release: U128,
    pub tank_min: U128,
    pub limits_eval: Limits,
    pub limits_release: Limits,
    pub testnet_caps: Option<TestnetCaps>,
}

/// `set_config` patch. Network wiring and the program (set_program) are not patchable.
#[near(serializers = [json])]
#[derive(Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct ConfigPatch {
    pub treasury: Option<AccountId>,
    pub fee_bps_eval: Option<u16>,
    pub fee_bps_sale: Option<u16>,
    pub min_eval_fee: Option<U128>,
    pub min_price: Option<U128>,
    pub listing_bond: Option<U128>,
    pub max_evals_cap: Option<u32>,
    pub outlayer_deposit_eval: Option<U128>,
    pub outlayer_deposit_release: Option<U128>,
    pub tank_min: Option<U128>,
    pub limits_eval: Option<Limits>,
    pub limits_release: Option<Limits>,
    pub testnet_caps: Option<TestnetCaps>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Verdict,
    Scored,
}

impl Mode {
    pub fn bits_milli(self) -> u32 {
        match self {
            Mode::Scored => BITS_SCORED_MILLI,
            Mode::Verdict => BITS_VERDICT_MILLI,
        }
    }
}

/// Mt = intents.near NEP-245, Ft = arrow-usd NEP-141 (testnet).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Rail {
    Mt,
    Ft,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Escrowed,
    Pending,
    Done,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub id: u64,
    pub seller: AccountId,
    pub payout: AccountId,
    pub title: String,
    pub public_desc: String,
    pub columns: Vec<String>,
    pub rows_claimed: u64,
    pub blob_url: String,
    pub blob_sha256: String,
    pub sealed_k: String,
    pub price: U128,
    pub eval_fee: U128,
    pub max_evals: u32,
    pub evals_used: u32,
    pub bits_per_eval_milli: u32,
    pub mode: Mode,
    pub program_hash_at_list: String,
    pub created_at_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Eval {
    pub id: u64,
    pub listing_id: u64,
    pub buyer: AccountId,
    pub buyer_pk: String,
    pub paid: U128,
    pub fee: U128,
    pub seed: String,
    pub rail: Rail,
    pub status: Status,
    pub sealed_result: Option<String>,
    pub h: Option<String>,
    pub refund_reason: Option<String>,
    pub created_at_ns: u64,
    pub settled_at_ns: Option<u64>,
    /// Escrow only, cleared at request_eval. Never in views.
    #[serde(skip_serializing)]
    pub sealed_criteria: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Purchase {
    pub id: u64,
    pub listing_id: u64,
    pub buyer: AccountId,
    pub buyer_pk: String,
    pub paid: U128,
    pub price: U128,
    pub rail: Rail,
    pub status: Status,
    pub sealed_k_buyer: Option<String>,
    pub h: Option<String>,
    pub refund_reason: Option<String>,
    pub created_at_ns: u64,
    pub settled_at_ns: Option<u64>,
}

/// Enclave output (`fixtures/output-vectors.json`). Unknown fields make it a bad output.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ArrowOut {
    pub v: u8,
    pub ok: bool,
    pub r: Option<String>,
    pub k: Option<String>,
    pub pk: Option<String>,
    pub h: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LeakBudget {
    pub listing_id: u64,
    pub bits_per_eval_milli: u32,
    pub max_evals: u32,
    pub evals_used: u32,
    pub budget_milli: u64,
    pub spent_milli: u64,
    pub left_milli: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_constants() {
        assert_eq!(((51f64).log2() * 1000.0).ceil() as u32, BITS_SCORED_MILLI);
        assert_eq!(((3f64).log2() * 1000.0).ceil() as u32, BITS_VERDICT_MILLI);
    }

    /// scripts/deploy/init-*.json are bare `Config` objects; each must pass `validate_config`
    /// on its own build once the program placeholders are filled (render-init.sh does that).
    #[test]
    fn init_json_templates_deserialize() {
        let (name, raw) = if cfg!(feature = "testnet") {
            ("testnet", include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/deploy/init-testnet.json")))
        } else {
            ("mainnet", include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/deploy/init-mainnet.json")))
        };
        assert!(raw.contains("__PROGRAM_WASM_URL__") && raw.contains("__PROGRAM_WASM_SHA256__"), "{name}: placeholders missing");
        let filled = raw
            .replace("__PROGRAM_WASM_URL__", "https://example.test/arrow-tee.wasm")
            .replace("__PROGRAM_WASM_SHA256__", &"ab".repeat(32));
        let cfg: Config = near_sdk::serde_json::from_str(&filled).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(crate::validate::validate_config(&cfg), Ok(()), "{name}");
        assert_eq!((cfg.secrets_ref.profile.as_str(), cfg.fee_bps_eval, cfg.fee_bps_sale), ("arrow", 1000, 200));
        if cfg!(feature = "testnet") {
            assert_eq!((cfg.intents.is_none(), cfg.usdc_token_id.as_str(), cfg.secrets_ref.account_id.as_str()), (true, "arrow-usd.arrowhq.testnet", "arrow.arrowhq.testnet"));
        } else {
            assert_eq!(cfg.intents.as_ref().map(|a| a.as_str()), Some("intents.near"));
            assert!(cfg.usdc_token_id.starts_with("nep141:17208628"));
            assert_eq!(cfg.secrets_ref.account_id.as_str(), "arrow-market.near");
        }
    }
}
