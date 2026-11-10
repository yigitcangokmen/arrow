//! NEP-297 events: `EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_…","data":{…}}`.
//! Ids are JSON numbers, amounts U128 strings, `*_milli` numbers.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::types::Mode;

#[near(event_json(standard = "arrow"))]
pub enum ArrowEvent {
    #[event_version("1.0.0")]
    ArrowListed {
        listing_id: u64,
        seller: AccountId,
        payout: AccountId,
        title: String,
        mode: Mode,
        price: U128,
        eval_fee: U128,
        max_evals: u32,
        bits_per_eval_milli: u32,
        budget_milli: u64,
        blob_sha256: String,
        program_wasm_hash: String,
    },
}
