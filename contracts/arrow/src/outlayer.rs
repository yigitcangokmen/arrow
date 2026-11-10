//! OutLayer `request_execution` (7 parameters, out-layer/outlayer contract/src/execution.rs:36)
//! and the wasm `input_data` (single source: fixtures/input-vectors.json).

use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

use crate::types::{Config, Eval, Limits, Listing, Mode, Purchase};

const REQUEST_GAS: Gas = Gas::from_tgas(150); // [DEC H-11]
const BUILD_TARGET: &str = "wasm32-wasip2";

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

/// The OutLayer call; the caller chains its own callback with `.then(...)`.
/// Payer is self, so OutLayer's refund of the unused deposit refills the gas tank.
pub fn request(cfg: &Config, input: String, deposit: u128, l: &Limits) -> Promise {
    ext_outlayer::ext(cfg.outlayer.clone())
        .with_attached_deposit(NearToken::from_yoctonear(deposit))
        .with_static_gas(REQUEST_GAS)
        .with_unused_gas_weight(0)
        .request_execution(
            ExecutionSource::WasmUrl {
                url: cfg.program_wasm_url.clone(),
                hash: cfg.program_wasm_hash.clone(),
                build_target: Some(BUILD_TARGET.to_string()),
            },
            Some(ResourceLimits {
                max_instructions: Some(l.max_instructions),
                max_memory_mb: Some(l.max_memory_mb),
                max_execution_seconds: Some(l.max_execution_seconds),
            }),
            Some(input),
            Some(SecretsReference {
                profile: cfg.secrets_ref.profile.clone(),
                account_id: cfg.secrets_ref.account_id.clone(),
            }),
            Some(ResponseFormat::Json),
            Some(env::current_account_id()),
            None,
        )
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct InputListing<'a> {
    id: u64,
    blob_url: &'a str,
    blob_sha256: &'a str,
    sealed_k: &'a str,
    mode: Mode,
    columns: &'a [String],
}

impl<'a> From<&'a Listing> for InputListing<'a> {
    fn from(l: &'a Listing) -> Self {
        Self {
            id: l.id,
            blob_url: &l.blob_url,
            blob_sha256: &l.blob_sha256,
            sealed_k: &l.sealed_k,
            mode: l.mode,
            columns: &l.columns,
        }
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct InputEval<'a> {
    id: u64,
    sealed_criteria: &'a str,
    buyer_pk: &'a str,
    seed: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EvalInput<'a> {
    v: u8,
    action: &'static str,
    listing: InputListing<'a>,
    eval: InputEval<'a>,
}

pub fn eval_input(listing: &Listing, eval: &Eval, sealed_criteria: &str) -> String {
    let input = EvalInput {
        v: 1,
        action: "eval",
        listing: listing.into(),
        eval: InputEval { id: eval.id, sealed_criteria, buyer_pk: &eval.buyer_pk, seed: &eval.seed },
    };
    match serde_json::to_string(&input) {
        Ok(s) => s,
        Err(_) => env::panic_str("Arrow: input serialization failed"),
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct InputRelease<'a> {
    id: u64,
    buyer_pk: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ReleaseInput<'a> {
    v: u8,
    action: &'static str,
    listing: InputListing<'a>,
    release: InputRelease<'a>,
}

pub fn release_input(listing: &Listing, purchase: &Purchase) -> String {
    let input = ReleaseInput {
        v: 1,
        action: "release",
        listing: listing.into(),
        release: InputRelease { id: purchase.id, buyer_pk: &purchase.buyer_pk },
    };
    match serde_json::to_string(&input) {
        Ok(s) => s,
        Err(_) => env::panic_str("Arrow: input serialization failed"),
    }
}
