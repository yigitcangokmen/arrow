//! `op=list`: record the listing, send the bond to the treasury, refund the rest.

use near_sdk::{env, AccountId};

use crate::events::ArrowEvent;
use crate::msg::ListMsg;
use crate::rail::pay_out;
use crate::types::{Listing, Rail};
use crate::validate::validate_list;
use crate::Contract;

impl Contract {
    /// Returns the amount to refund to the sender.
    pub(crate) fn handle_list(&mut self, sender: AccountId, amount: u128, m: ListMsg, rail: Rail) -> u128 {
        self.assert_open();
        if let Err(field) = validate_list(&m, &self.cfg) {
            env::panic_str(&format!("Arrow: E04 bad msg: {field}"));
        }
        // ENC-1: sealed_k is bound to the seller inside the enclave; this refuses a clone at list time.
        if self.blob_sellers.get(&m.blob_sha256).is_some_and(|owner| *owner != sender) {
            env::panic_str("Arrow: E19 blob listed by another seller");
        }
        let bond = self.cfg.listing_bond.0;
        if amount < bond {
            env::panic_str("Arrow: E08 amount below required");
        }
        self.assert_tank(0);

        let id = self.next_listing_id;
        self.next_listing_id += 1;
        let bits = m.mode.bits_milli();
        let listing = Listing {
            id,
            seller: sender.clone(),
            payout: m.payout.unwrap_or(sender),
            title: m.title,
            public_desc: m.public_desc,
            columns: m.columns,
            rows_claimed: m.rows_claimed,
            blob_url: m.blob_url,
            blob_sha256: m.blob_sha256,
            sealed_k: m.sealed_k,
            price: m.price,
            eval_fee: m.eval_fee,
            max_evals: m.max_evals,
            evals_used: 0,
            bits_per_eval_milli: bits,
            mode: m.mode,
            program_hash_at_list: self.cfg.program_wasm_hash.clone(),
            created_at_ns: env::block_timestamp(),
        };
        pay_out(&self.cfg, rail, self.cfg.treasury.clone(), bond, format!("arrow:bond:{id}"));
        ArrowEvent::ArrowListed {
            listing_id: id,
            seller: listing.seller.clone(),
            payout: listing.payout.clone(),
            title: listing.title.clone(),
            mode: listing.mode,
            price: listing.price,
            eval_fee: listing.eval_fee,
            max_evals: listing.max_evals,
            bits_per_eval_milli: bits,
            budget_milli: u64::from(listing.max_evals) * u64::from(bits),
            blob_sha256: listing.blob_sha256.clone(),
            program_wasm_hash: listing.program_hash_at_list.clone(),
        }
        .emit();
        if !self.blob_sellers.contains_key(&listing.blob_sha256) {
            self.blob_sellers.insert(listing.blob_sha256.clone(), listing.seller.clone());
        }
        self.listings.insert(id, listing);
        amount - bond
    }
}

#[cfg(test)]
mod tests {
    use crate::msg::Msg;
    use crate::testkit::*;
    use crate::types::*;
    use near_sdk::serde_json::json;

    fn list_json() -> String {
        msg_json(Msg::List(list_msg()))
    }

    #[test]
    fn list_records_listing_and_returns_overpay() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let v = value_of(mt_call(&mut c, seller(), 150_000, list_json()));
        assert_eq!(v, json!(["50000"]));
        let l = c.listings.get(&1).unwrap().clone();
        let m = list_msg();
        assert_eq!((l.title, l.columns, l.blob_sha256, l.sealed_k, l.price, l.eval_fee, l.max_evals), (m.title, m.columns, m.blob_sha256, m.sealed_k, m.price, m.eval_fee, m.max_evals));
        assert_eq!((l.evals_used, l.bits_per_eval_milli, l.seller.clone(), l.payout), (0, 5673, seller(), seller()));
        assert_eq!(l.program_hash_at_list, test_config().program_wasm_hash);
        assert_eq!(c.next_listing_id, 2);
        let transfers = calls();
        assert_eq!(transfers.len(), 1);
        let (to, method, args, dep) = &transfers[0];
        assert_eq!((to.as_str(), method.as_str(), *dep), ("intents.test.near", "mt_transfer", 1));
        assert_eq!(args["receiver_id"], "treasury.test.near");
        assert_eq!(args["amount"], "100000");
        assert_eq!(args["token_id"], "nep141:usdc.test.near");
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.starts_with(r#"EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_listed""#)), "{logs:?}");
    }

    #[test]
    fn list_verdict_bits_and_named_payout() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.mode = Mode::Verdict;
        m.payout = Some(acc("payout.test.near"));
        assert_eq!(value_of(mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)))), json!(["0"]));
        let l = c.listings.get(&1).unwrap();
        assert_eq!((l.bits_per_eval_milli, l.payout.as_str()), (1585, "payout.test.near"));
    }

    #[test]
    #[should_panic(expected = "Arrow: E06 program key not initialised")]
    fn list_requires_program_key() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        c.program_pubkey = None;
        let _ = mt_call(&mut c, seller(), 150_000, list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E08 amount below required")]
    fn list_below_bond() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 99_999, list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E01 predecessor is not the intents contract")]
    fn list_wrong_predecessor() {
        setup(acc("mallory.test.near"), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 150_000, list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E02 wrong token")]
    fn list_wrong_token() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = c.mt_on_transfer(seller(), vec![seller()], vec!["nep141:other.near".into()], vec![near_sdk::json_types::U128(150_000)], list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E03 expected exactly one token, amount and owner")]
    fn list_two_tokens() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let t = c.cfg.usdc_token_id.clone();
        let a = near_sdk::json_types::U128(75_000);
        let _ = c.mt_on_transfer(seller(), vec![seller(), seller()], vec![t.clone(), t], vec![a, a], list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E05 paused")]
    fn list_paused() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        c.paused = true;
        let _ = mt_call(&mut c, seller(), 150_000, list_json());
    }

    #[test]
    #[should_panic(expected = "Arrow: E10 gas tank low")]
    fn list_tank_low() {
        setup(intents(), NEAR / 100);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 150_000, list_json());
    }

    /// ENC-1 defence in depth: a second account listing a blob_sha256 that is already listed
    /// (a clone of blob_url, blob_sha256 and sealed_k) is refused before any state change.
    #[test]
    #[should_panic(expected = "Arrow: E19 blob listed by another seller")]
    fn list_clone_by_other_seller_rejected() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        assert_eq!(c.blob_sellers.get(&list_msg().blob_sha256), Some(&seller()));
        let _ = mt_call(&mut c, acc("0x1111111111111111111111111111111111111111"), 100_000, list_json());
    }

    #[test]
    fn same_seller_may_relist_same_blob() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        assert_eq!((c.next_listing_id, c.listings.get(&2).map(|l| l.seller.clone())), (3, Some(seller())));
    }

    #[test]
    #[should_panic(expected = "Arrow: E04 bad msg: title")]
    fn list_bad_msg_names_field() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.title = String::new();
        let _ = mt_call(&mut c, seller(), 150_000, msg_json(Msg::List(m)));
    }
}
