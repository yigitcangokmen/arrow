//! `op=buy` and its OutLayer callback. The enclave re-seals the data key to the buyer's key
//! (`sealed_k_buyer`, written on chain) and returns `h`, the second G3 link [DEC A.1 G3].
//! No leak-budget check: sales stay open after the budget is spent [DEC A.1 G1].

use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::{env, near, AccountId, Gas, Promise, PromiseOrValue};

use crate::eval::{classify, Action};
use crate::events::ArrowEvent;
use crate::msg::BuyMsg;
use crate::outlayer::{release_input, request};
use crate::paths::{payment_path, PaymentPath};
use crate::rail::{pay_out, refund_value, split};
use crate::types::*;
use crate::validate::validate_buy;
use crate::{Contract, ContractExt, StorageKey};

const ON_RELEASE_GAS: Gas = Gas::from_tgas(60); // [DEC H-11]

/// sha256(listing_id ‖ buyer ‖ buyer_pk) → the newest purchase with that triple (X12-2 tabs, TN-6).
/// Opened on demand under its own prefix, not a state field.
fn bought_map() -> near_sdk::store::LookupMap<[u8; 32], u64> {
    near_sdk::store::LookupMap::new(StorageKey::Bought)
}

fn bought_key(listing_id: u64, buyer: &AccountId, buyer_pk: &str) -> [u8; 32] {
    env::sha256_array(format!("{listing_id}:{buyer}:{buyer_pk}").as_bytes())
}

impl Contract {
    pub(crate) fn handle_buy(&mut self, sender: AccountId, amount: u128, m: BuyMsg, rail: Rail) -> PromiseOrValue<Value> {
        self.assert_open();
        let listing = match self.listings.get(&m.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        if listing.program_hash_at_list != self.cfg.program_wasm_hash {
            env::panic_str("Arrow: E13 listing sealed to an old program");
        }
        if let Err(field) = validate_buy(&m) {
            env::panic_str(&format!("Arrow: E04 bad msg: {field}"));
        }
        if amount < listing.price.0 {
            env::panic_str("Arrow: E08 amount below required");
        }
        // The same payer buying the same listing to the same key again gets nothing new (the key is
        // already re-sealed to buyer_pk on chain); a second tab or a re-signed retry would pay twice.
        let key = bought_key(listing.id, &sender, &m.buyer_pk);
        let mut bought = bought_map();
        if let Some(prev) = bought.get(&key).and_then(|pid| self.purchases.get(pid)) {
            if prev.status != Status::Refunded {
                env::panic_str("Arrow: E22 already bought");
            }
        }
        self.assert_tank(self.cfg.outlayer_deposit_release.0);

        // Mutations start here.
        let id = self.next_purchase_id;
        self.next_purchase_id += 1;
        bought.insert(key, id);
        let mut purchase = Purchase {
            id,
            listing_id: listing.id,
            buyer: sender,
            buyer_pk: m.buyer_pk,
            paid: U128(amount),
            price: listing.price,
            rail,
            status: Status::Pending,
            sealed_k_buyer: None,
            h: None,
            refund_reason: None,
            created_at_ns: env::block_timestamp(),
            settled_at_ns: None,
        };
        ArrowEvent::ArrowPurchase {
            phase: "accepted".into(),
            listing_id: listing.id,
            purchase_id: id,
            buyer: purchase.buyer.clone(),
            price: purchase.price,
            h: None,
        }
        .emit();
        if payment_path() == PaymentPath::Escrow {
            // The price stays with the contract until a relayer calls request_release.
            let unused = amount - purchase.price.0;
            purchase.status = Status::Escrowed;
            self.purchases.insert(id, purchase);
            return PromiseOrValue::Value(refund_value(rail, unused));
        }
        let input = release_input(&listing, &purchase);
        self.purchases.insert(id, purchase);
        PromiseOrValue::Promise(self.release_promise(id, input))
    }

    /// The newest purchase of `listing_id` by `buyer` to `buyer_pk`, if any (lets a client find a
    /// purchase again after a reload instead of paying twice).
    pub(crate) fn purchase_by_buyer(&self, listing_id: u64, buyer: &AccountId, buyer_pk: &str) -> Option<Purchase> {
        bought_map().get(&bought_key(listing_id, buyer, buyer_pk)).and_then(|id| self.purchases.get(id)).cloned()
    }

    /// OutLayer release request chained to `on_release`.
    pub(crate) fn release_promise(&self, purchase_id: u64, input: String) -> Promise {
        let call = request(&self.cfg, input, self.cfg.outlayer_deposit_release.0, &self.cfg.limits_release);
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(ON_RELEASE_GAS)
            .with_unused_gas_weight(1)
            .on_release(purchase_id);
        call.then(callback)
    }
}

#[near]
impl Contract {
    /// OutLayer callback. Notify: returns the unused amount in the rail's resolver shape.
    /// Escrow: a refund pays the price back to the buyer and the return value is `null`.
    #[private]
    pub fn on_release(&mut self, purchase_id: u64) -> Value {
        let mut p = match self.purchases.get(&purchase_id) {
            Some(p) if p.status == Status::Pending => p.clone(),
            _ => env::panic_str("Arrow: E17 wrong state"),
        };
        let listing = match self.listings.get(&p.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        let escrow = payment_path() == PaymentPath::Escrow;
        let result = classify(env::promise_result_checked(0, MAX_OUTPUT_BYTES), &listing.blob_sha256, Action::Release);
        p.settled_at_ns = Some(env::block_timestamp());
        let refund = match result {
            Ok(s) => {
                let price = p.price.0;
                let (seller_share, treasury_share) = split(price, self.cfg.fee_bps_sale);
                pay_out(&self.cfg, p.rail, listing.payout.clone(), seller_share, format!("arrow:sale:{purchase_id}"));
                pay_out(&self.cfg, p.rail, self.cfg.treasury.clone(), treasury_share, format!("arrow:sale-fee:{purchase_id}"));
                ArrowEvent::ArrowPurchase {
                    phase: "done".into(),
                    listing_id: listing.id,
                    purchase_id,
                    buyer: p.buyer.clone(),
                    price: p.price,
                    h: Some(s.h.clone()),
                }
                .emit();
                p.status = Status::Done;
                p.sealed_k_buyer = Some(s.sealed);
                p.h = Some(s.h);
                p.paid.0 - price
            }
            Err(reason) => {
                let amount = if escrow { p.price } else { p.paid };
                if escrow {
                    pay_out(&self.cfg, p.rail, p.buyer.clone(), amount.0, format!("arrow:refund:buy:{purchase_id}"));
                }
                ArrowEvent::ArrowRefund {
                    kind: "buy".into(),
                    listing_id: listing.id,
                    id: purchase_id,
                    reason: reason.into(),
                    amount,
                }
                .emit();
                p.status = Status::Refunded;
                p.refund_reason = Some(reason.into());
                p.paid.0
            }
        };
        let rail = p.rail;
        self.purchases.insert(purchase_id, p);
        if escrow {
            Value::Null
        } else {
            refund_value(rail, refund)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::msg::{EvalMsg, Msg};
    use crate::testkit::*;
    use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
    use near_sdk::serde_json::{self, json};
    use near_sdk::test_utils::get_logs;
    use near_sdk::PromiseResult;

    const VECTORS_IN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/input-vectors.json"));

    fn buyer_pk() -> String {
        format!("04{}", "22".repeat(64))
    }

    /// A contract with one listing: price 2_000_000, eval fee 50000, max_evals as given.
    fn listed(max_evals: u32) -> crate::Contract {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.price = U128(2_000_000);
        m.eval_fee = U128(50_000);
        m.max_evals = max_evals;
        let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)));
        setup(intents(), 10 * NEAR);
        c
    }

    fn buy(c: &mut crate::Contract, amount: u128) -> PromiseOrValue<Value> {
        mt_call(c, buyer(), amount, msg_json(Msg::Buy(BuyMsg { listing_id: 1, buyer_pk: buyer_pk() })))
    }

    fn release_output(h: &str, k_len: usize) -> Vec<u8> {
        json!({"v":1,"ok":true,"k":STANDARD.encode(vec![2u8; k_len]),"h":h}).to_string().into_bytes()
    }

    #[test]
    fn buy_success_pays_98_2() {
        let mut c = listed(20);
        assert!(matches!(buy(&mut c, 2_030_000), PromiseOrValue::Promise(_)));
        let p = c.purchases.get(&1).unwrap();
        assert_eq!((p.status, p.paid.0, p.price.0), (Status::Pending, 2_030_000, 2_000_000));
        assert!(get_logs().iter().any(|l| l.contains(r#""event":"arrow_purchase""#) && l.contains(r#""phase":"accepted""#)));

        callback_env(PromiseResult::Successful(release_output(&"cd".repeat(32), SEALED_K_LEN)));
        assert_eq!(c.on_release(1), json!(["30000"]));
        let p = c.purchases.get(&1).unwrap();
        assert_eq!((p.status, p.h.clone()), (Status::Done, Some("cd".repeat(32))));
        assert_eq!(STANDARD.decode(p.sealed_k_buyer.clone().unwrap()).unwrap().len(), SEALED_K_LEN);
        let pairs: Vec<(String, String, String)> = calls()
            .into_iter()
            .filter(|(_, m, _, _)| m == "mt_transfer")
            .map(|(to, _, a, _)| (to, a["receiver_id"].as_str().unwrap().to_string(), a["amount"].as_str().unwrap().to_string()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("intents.test.near".into(), seller().to_string(), "1960000".into()),
                ("intents.test.near".into(), "treasury.test.near".into(), "40000".into())
            ]
        );
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_purchase""#) && l.contains(r#""phase":"done""#) && l.contains(&format!(r#""h":"{}""#, "cd".repeat(32)))), "{logs:?}");
    }

    #[test]
    fn buy_refund_table() {
        let good_h = "cd".repeat(32);
        let cases: Vec<(PromiseResult, &str)> = vec![
            (PromiseResult::Failed, "null"),
            (PromiseResult::Successful(b"null".to_vec()), "null"),
            (PromiseResult::Successful(br#"{"v":1,"ok":false}"#.to_vec()), "not_ok"),
            (PromiseResult::Successful(release_output(&"00".repeat(32), SEALED_K_LEN)), "hash_mismatch"),
            (PromiseResult::Successful(release_output(&good_h, SEALED_K_LEN - 1)), "bad_output"),
            // an eval-shaped output (`r`) is not a release
            (PromiseResult::Successful(json!({"v":1,"ok":true,"r":STANDARD.encode([1u8; 98]),"h":good_h}).to_string().into_bytes()), "bad_output"),
            (PromiseResult::Successful(vec![b' '; 1025]), "bad_output"),
        ];
        for (result, reason) in cases {
            let mut c = listed(20);
            let _ = buy(&mut c, 2_000_000);
            callback_env(result);
            assert_eq!(c.on_release(1), json!(["2000000"]), "{reason}");
            let p = c.purchases.get(&1).unwrap();
            assert_eq!((p.status, p.refund_reason.as_deref(), p.sealed_k_buyer.is_none()), (Status::Refunded, Some(reason), true));
            assert!(calls().iter().all(|(_, m, _, _)| m != "mt_transfer"), "{reason}: paid out");
            let logs = get_logs();
            assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_refund""#) && l.contains(r#""kind":"buy""#) && l.contains(&format!(r#""reason":"{reason}""#)) && l.contains(r#""amount":"2000000""#)), "{reason}: {logs:?}");
        }
    }

    fn panic_text(r: std::thread::Result<PromiseOrValue<Value>>) -> String {
        r.err().and_then(|e| e.downcast_ref::<String>().cloned()).unwrap_or_default()
    }

    /// X12-2 (tabs) / TN-6: the same payer cannot buy the same listing to the same key twice while
    /// the first purchase is pending or done; a refunded one, a new key or another payer may.
    #[test]
    fn second_buy_same_key_is_e22() {
        crate::paths::TEST_PAYMENT_PATH.with(|p| p.set(Some(crate::paths::PaymentPath::Notify)));
        let mut c = listed(20);
        assert!(matches!(buy(&mut c, 2_000_000), PromiseOrValue::Promise(_)));
        setup(intents(), 10 * NEAR);
        let pending = panic_text(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| buy(&mut c, 2_000_000))));
        assert!(pending.contains("Arrow: E22 already bought"), "pending: {pending}");
        callback_env(PromiseResult::Successful(release_output(&"cd".repeat(32), SEALED_K_LEN)));
        c.on_release(1);
        setup(intents(), 10 * NEAR);
        let done = panic_text(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| buy(&mut c, 2_000_000))));
        assert!(done.contains("Arrow: E22 already bought"), "done: {done}");
        assert_eq!(c.next_purchase_id, 2);
        let found = c.get_purchase_by_buyer(1, buyer(), buyer_pk()).map(|p| (p.id, p.status));
        assert_eq!(found, Some((1, Status::Done)));
        // Another key, or another payer with the same key, may buy.
        let other_key = BuyMsg { listing_id: 1, buyer_pk: format!("04{}", "44".repeat(64)) };
        assert!(matches!(mt_call(&mut c, buyer(), 2_000_000, msg_json(Msg::Buy(other_key))), PromiseOrValue::Promise(_)));
        setup(intents(), 10 * NEAR);
        let same_key = BuyMsg { listing_id: 1, buyer_pk: buyer_pk() };
        assert!(matches!(mt_call(&mut c, acc("0x3333333333333333333333333333333333333333"), 2_000_000, msg_json(Msg::Buy(same_key))), PromiseOrValue::Promise(_)));
    }

    #[test]
    fn rebuy_after_refund_is_allowed() {
        crate::paths::TEST_PAYMENT_PATH.with(|p| p.set(Some(crate::paths::PaymentPath::Notify)));
        let mut c = listed(20);
        let _ = buy(&mut c, 2_000_000);
        callback_env(PromiseResult::Failed);
        c.on_release(1);
        setup(intents(), 10 * NEAR);
        assert!(matches!(buy(&mut c, 2_000_000), PromiseOrValue::Promise(_)));
        assert_eq!(c.get_purchase_by_buyer(1, buyer(), buyer_pk()).map(|p| p.id), Some(2));
    }

    #[test]
    fn buy_allowed_when_budget_exhausted() {
        let mut c = listed(1);
        let em = EvalMsg { listing_id: 1, sealed_criteria: STANDARD.encode([9u8; 200]), buyer_pk: buyer_pk() };
        let _ = mt_call(&mut c, buyer(), 50_000, msg_json(Msg::Eval(em)));
        let l = c.listings.get(&1).unwrap();
        assert_eq!(l.evals_used, l.max_evals);
        setup(intents(), 10 * NEAR);
        assert!(matches!(buy(&mut c, 2_000_000), PromiseOrValue::Promise(_)));
    }

    #[test]
    #[should_panic(expected = "Arrow: E08 amount below required")]
    fn buy_below_price() {
        let mut c = listed(20);
        let _ = buy(&mut c, 1_999_999);
    }

    #[test]
    #[should_panic(expected = "Arrow: E04 bad msg: buyer_pk")]
    fn buy_bad_buyer_pk() {
        let mut c = listed(20);
        let _ = mt_call(&mut c, buyer(), 2_000_000, msg_json(Msg::Buy(BuyMsg { listing_id: 1, buyer_pk: format!("05{}", "22".repeat(64)) })));
    }

    #[test]
    #[should_panic(expected = "Arrow: E13 listing sealed to an old program")]
    fn buy_old_program() {
        let mut c = listed(20);
        c.cfg.program_wasm_hash = "ef".repeat(32);
        let _ = buy(&mut c, 2_000_000);
    }

    #[test]
    #[should_panic(expected = "Arrow: E17 wrong state")]
    fn on_release_twice_panics() {
        let mut c = listed(20);
        let _ = buy(&mut c, 2_000_000);
        callback_env(PromiseResult::Failed);
        c.on_release(1);
        c.on_release(1);
    }

    #[test]
    fn outlayer_release_args() {
        let mut c = listed(20);
        let _ = buy(&mut c, 2_000_000);
        let all = calls();
        let (to, _, args, dep) = all.iter().find(|(_, m, _, _)| m == "request_execution").expect("request_execution receipt");
        assert_eq!((to.as_str(), *dep), ("outlayer.test.near", NEAR / 100));
        assert_eq!(args["resource_limits"], json!({"max_instructions":2_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":30}));
        assert_eq!(args["source"]["WasmUrl"]["build_target"], "wasm32-wasip2");
        assert_eq!((args["payer_account_id"].clone(), args["params"].clone()), (json!("arrow.test.near"), Value::Null));
        let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
        assert_eq!((input["action"].clone(), input["release"]["id"].clone(), input["release"]["buyer_pk"].clone()), (json!("release"), json!(1), json!(buyer_pk())));
        assert!(all.iter().any(|(to, m, a, _)| to == "arrow.test.near" && m == "on_release" && a["purchase_id"] == 1));
    }

    #[test]
    fn release_input_matches_vectors() {
        let v: Value = serde_json::from_str(VECTORS_IN).unwrap();
        let mut n = 0;
        for case in v["valid"].as_array().unwrap().iter().filter(|c| c["input"]["action"] == "release") {
            let i = &case["input"];
            let l = &i["listing"];
            let listing = Listing {
                id: l["id"].as_u64().unwrap(),
                seller: seller(),
                payout: seller(),
                title: "t".into(),
                public_desc: String::new(),
                columns: serde_json::from_value(l["columns"].clone()).unwrap(),
                rows_claimed: 1,
                blob_url: l["blob_url"].as_str().unwrap().into(),
                blob_sha256: l["blob_sha256"].as_str().unwrap().into(),
                sealed_k: l["sealed_k"].as_str().unwrap().into(),
                price: U128(100_000),
                eval_fee: U128(50_000),
                max_evals: 1,
                evals_used: 0,
                bits_per_eval_milli: 1,
                mode: serde_json::from_value(l["mode"].clone()).unwrap(),
                program_hash_at_list: String::new(),
                created_at_ns: 0,
            };
            let p = Purchase {
                id: i["release"]["id"].as_u64().unwrap(),
                listing_id: listing.id,
                buyer: buyer(),
                buyer_pk: i["release"]["buyer_pk"].as_str().unwrap().into(),
                paid: U128(0),
                price: U128(0),
                rail: Rail::Mt,
                status: Status::Pending,
                sealed_k_buyer: None,
                h: None,
                refund_reason: None,
                created_at_ns: 0,
                settled_at_ns: None,
            };
            let built: Value = serde_json::from_str(&release_input(&listing, &p)).unwrap();
            assert_eq!(&built, i, "case {}", case["name"]);
            n += 1;
        }
        assert!(n >= 1);
    }
}
