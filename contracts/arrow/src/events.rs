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
    /// `phase:"accepted"` in mt_on_transfer (budget already counted), `phase:"done"` on success.
    #[event_version("1.0.0")]
    ArrowEval {
        phase: String,
        listing_id: u64,
        eval_id: u64,
        buyer: AccountId,
        fee: U128,
        spent_milli: u64,
        left_milli: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        h: Option<String>,
    },
    /// `phase:"accepted"` in the transfer notification, `phase:"done"` once the key is released.
    #[event_version("1.0.0")]
    ArrowPurchase {
        phase: String,
        listing_id: u64,
        purchase_id: u64,
        buyer: AccountId,
        price: U128,
        #[serde(skip_serializing_if = "Option::is_none")]
        h: Option<String>,
    },
    /// `op=rehost`: the listing's blob moved to `blob_url` (same blob_sha256).
    #[event_version("1.0.0")]
    ArrowRehosted {
        listing_id: u64,
        blob_url: String,
    },
    /// A payout transfer failed; `amount` is now owed to `to` and `retry_payout` re-sends it.
    #[event_version("1.0.0")]
    ArrowPayoutFailed {
        to: AccountId,
        amount: U128,
        memo: String,
    },
    #[event_version("1.0.0")]
    ArrowRefund {
        kind: String,
        listing_id: u64,
        id: u64,
        reason: String,
        amount: U128,
    },
}
