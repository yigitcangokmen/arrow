//! `op=list`: record the listing, send the bond to the treasury, refund the rest.
//! `op=rehost`: the listing's seller points it at a new copy of the same ciphertext.

use near_sdk::{env, AccountId};

use crate::events::ArrowEvent;
use crate::msg::{ListMsg, RehostMsg};
use crate::rail::pay_out;
use crate::types::{Listing, Rail, LIST_TANK_RESERVE_EVALS};
use crate::validate::{validate_list, validate_rehost};
use crate::Contract;

impl Contract {
    /// Returns the amount to refund to the sender.
    pub(crate) fn handle_list(&mut self, sender: AccountId, amount: u128, m: ListMsg, rail: Rail) -> u128 {
        self.assert_open();
        if let Err(field) = validate_list(&m, &self.cfg) {
            env::panic_str(&format!("Arrow: E04 bad msg: {field}"));
        }
        if m.payout.as_ref() == Some(&env::current_account_id()) {
            env::panic_str("Arrow: E04 bad msg: payout");
        }
        // No first-lister registry (E19 is retired): anyone may list any blob_sha256. A copy of
        // someone else's blob and sealed_k is useless, because the enclave binds sealed_k to the
        // seller and refuses it under another account (ENC-1), and a registry only let a squatter
        // block the real seller for good (CRY-2, C-03, TN-1).
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
        self.listings.insert(id, listing);
        // C-02: the listing's storage is paid from the gas tank. It may not take the tank below
        // what LIST_TANK_RESERVE_EVALS evals need; the panic refunds the bond and drops the listing.
        self.listings.flush();
        let reserve = self.cfg.tank_min.0 + LIST_TANK_RESERVE_EVALS * self.cfg.outlayer_deposit_eval.0;
        if crate::tank_available() < reserve {
            env::panic_str("Arrow: E10 gas tank low");
        }
        amount - bond
    }

    /// X12-3: the listing's seller moves it to a new URL for the same bytes. `blob_sha256` is kept,
    /// so the enclave still refuses any other file (G3). The whole amount is returned.
    pub(crate) fn handle_rehost(&mut self, sender: AccountId, amount: u128, m: RehostMsg) -> u128 {
        self.assert_open();
        let mut listing = match self.listings.get(&m.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        if listing.seller != sender {
            env::panic_str("Arrow: E23 not the listing's seller");
        }
        if let Err(field) = validate_rehost(&m) {
            env::panic_str(&format!("Arrow: E04 bad msg: {field}"));
        }
        listing.blob_url = m.blob_url;
        ArrowEvent::ArrowRehosted { listing_id: listing.id, blob_url: listing.blob_url.clone() }.emit();
        self.listings.insert(listing.id, listing);
        amount
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
        assert_eq!(transfers.len(), 2);
        let (to, method, args, dep) = &transfers[0];
        assert_eq!((to.as_str(), method.as_str(), *dep), ("intents.test.near", "mt_transfer", 1));
        assert_eq!(args["receiver_id"], "treasury.test.near");
        assert_eq!(args["amount"], "100000");
        assert_eq!(args["token_id"], "nep141:usdc.test.near");
        // X12F-2: every payout is followed by an on_payout check on this contract.
        let (to, method, args, _) = &transfers[1];
        assert_eq!((to.as_str(), method.as_str()), ("arrow.test.near", "on_payout"));
        assert_eq!(args, &json!({"rail":"mt","to":"treasury.test.near","amount":"100000","memo":"arrow:bond:1"}));
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

    /// CRY-2 / C-03 / TN-1: no first-lister registry. A squatter who lists a seller's blob_sha256
    /// first (junk sealed_k) does not block the seller; the enclave's seller binding is what makes
    /// a copy useless (arrow-tee clone_with_other_seller_is_err).
    #[test]
    fn other_account_may_list_same_blob() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let squatter = acc("0x1111111111111111111111111111111111111111");
        let mut junk = list_msg();
        junk.sealed_k = near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [0xEEu8; SEALED_K_LIST_LEN]);
        assert_eq!(value_of(mt_call(&mut c, squatter.clone(), 100_000, msg_json(Msg::List(junk)))), json!(["0"]));
        assert_eq!(value_of(mt_call(&mut c, seller(), 100_000, list_json())), json!(["0"]));
        let sellers: Vec<_> = (1..=2).map(|i| c.listings.get(&i).map(|l| l.seller.clone())).collect();
        assert_eq!((c.next_listing_id, sellers), (3, vec![Some(squatter), Some(seller())]));
        assert!(c.blob_sellers.get(&list_msg().blob_sha256).is_none(), "the retired registry was written");
    }

    /// TN-2: a payout to the market contract itself would strand the seller's share.
    #[test]
    #[should_panic(expected = "Arrow: E04 bad msg: payout")]
    fn list_payout_to_self_rejected() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.payout = Some(self_id());
        let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)));
    }

    /// The largest listing validate_list accepts, in 4-byte characters where they cost most.
    fn max_listing() -> crate::msg::ListMsg {
        let mut m = list_msg();
        m.title = "\u{1F600}".repeat(60);
        m.public_desc = "\u{1F600}".repeat(210);
        m.columns = vec!["\u{1F600}".repeat(10); 64];
        m.blob_url = format!("https://b.test/{}", "a".repeat(BLOB_URL_MAX_BYTES - 15));
        m.payout = Some(acc(&format!("{}.near", "p".repeat(59))));
        m
    }

    /// STATE-3 / C-02: one maximal listing costs the tank at most 4.8 kB of storage, about 0.048 NEAR
    /// (measured 4744 B; it was about 12.9 kB with 80/280/64x40 four-byte characters).
    #[test]
    fn max_listing_storage_bounded() {
        // The audit's listing (80/280/64x40 four-byte characters) and its parts at the character
        // limits: each one is either refused or stored within the bound.
        let mut candidates = vec![max_listing()];
        for part in 0..4 {
            let mut m = max_listing();
            if part == 0 || part == 3 {
                m.title = "\u{1F600}".repeat(80);
            }
            if part == 1 || part == 3 {
                m.public_desc = "\u{1F600}".repeat(280);
            }
            if part == 2 || part == 3 {
                m.columns = vec!["\u{1F600}".repeat(40); 64];
            }
            candidates.push(m);
        }
        for (i, m) in candidates.into_iter().enumerate() {
            setup(intents(), 10 * NEAR);
            near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage())); // each candidate on empty storage
            let mut c = contract();
            if crate::validate::validate_list(&m, &c.cfg).is_err() {
                assert!(i > 0, "the maximal valid listing was refused");
                continue;
            }
            let before = near_sdk::env::storage_usage();
            let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)));
            c.listings.flush();
            let used = near_sdk::env::storage_usage() - before;
            assert!(used <= 4_800, "candidate {i} stores {used} bytes");
        }
    }

    /// C-02: a listing may not take the tank below tank_min + 10 eval deposits, so listing spam
    /// stops while honest evals on existing listings still pass E10.
    #[test]
    fn listing_keeps_eval_reserve() {
        crate::paths::TEST_PAYMENT_PATH.with(|p| p.set(Some(crate::paths::PaymentPath::Notify)));
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        // tank = reserve + 100 bytes of storage: smaller than one more listing.
        let locked = 307_200 * near_sdk::env::storage_byte_cost().as_yoctonear();
        let reserve = c.cfg.tank_min.0 + LIST_TANK_RESERVE_EVALS * c.cfg.outlayer_deposit_eval.0;
        setup(intents(), locked + reserve + 100 * near_sdk::env::storage_byte_cost().as_yoctonear());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| mt_call(&mut c, seller(), 100_000, list_json()))).err().unwrap();
        let text = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(text.contains("Arrow: E10 gas tank low"), "{text}");
        let eval = crate::msg::EvalMsg { listing_id: 1, sealed_criteria: near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [9u8; 200]), buyer_pk: format!("04{}", "22".repeat(64)) };
        assert!(matches!(mt_call(&mut c, buyer(), 100_000, msg_json(Msg::Eval(eval))), near_sdk::PromiseOrValue::Promise(_)));
    }

    fn rehost(c: &mut crate::Contract, who: near_sdk::AccountId, listing_id: u64, url: &str) -> near_sdk::serde_json::Value {
        let m = crate::msg::RehostMsg { listing_id, blob_url: url.into() };
        value_of(mt_call(c, who, 1, msg_json(Msg::Rehost(m))))
    }

    /// X12-3: the seller can move the ciphertext to a new host; blob_sha256 stays, nothing is kept.
    #[test]
    fn rehost_by_seller_updates_url_keeps_sha() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        assert_eq!(rehost(&mut c, seller(), 1, "https://mirror.test/blob.bin"), json!(["1"]));
        let l = c.listings.get(&1).unwrap();
        assert_eq!((l.blob_url.as_str(), l.blob_sha256.clone()), ("https://mirror.test/blob.bin", list_msg().blob_sha256));
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_rehosted""#) && l.contains("mirror.test")), "{logs:?}");
    }

    #[test]
    fn rehost_refusals() {
        for (who, id, url, want) in [
            (buyer(), 1, "https://mirror.test/b.bin", "Arrow: E23 not the listing's seller"),
            (seller(), 1, "http://mirror.test/b.bin", "Arrow: E04 bad msg: blob_url"),
            (seller(), 2, "https://mirror.test/b.bin", "Arrow: E07 unknown listing"),
            (seller(), 1, "https://mirror.test/\u{202E}nib.exe", "Arrow: E04 bad msg: blob_url"),
            (seller(), 1, "https://mirror.test/a\u{200B}b.bin", "Arrow: E04 bad msg: blob_url"),
        ] {
            setup(intents(), 10 * NEAR);
            let mut c = contract();
            let _ = mt_call(&mut c, seller(), 100_000, list_json());
            let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rehost(&mut c, who.clone(), id, url))).err().unwrap();
            let text = err.downcast_ref::<String>().cloned().unwrap_or_default();
            assert!(text.contains(want), "{text}");
            assert_eq!(c.listings.get(&1).unwrap().blob_url, list_msg().blob_url);
        }
    }

    /// R2-4: a paused market refuses a rehost like every other op (E05).
    #[test]
    fn rehost_refused_while_paused() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, list_json());
        c.paused = true;
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rehost(&mut c, seller(), 1, "https://mirror.test/b.bin"))).err().unwrap();
        let text = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(text.contains("Arrow: E05 paused"), "{text}");
        assert_eq!(c.listings.get(&1).unwrap().blob_url, list_msg().blob_url);
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
