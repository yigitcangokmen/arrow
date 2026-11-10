//! Escrow payment path [DEC H-15]: compiled into every build, live only when
//! `PAYMENT_PATH == Escrow`. The transfer notification accepts and holds the fee or price
//! (overpay returned at once); a relayer then calls `request_eval` / `request_release`, and
//! the Arrow contract itself pays a refund back. If nobody requests within 15 minutes, anyone
//! may call `refund_stale`.

use near_sdk::{env, near, Promise};

use crate::events::ArrowEvent;
use crate::outlayer::{eval_input, release_input};
use crate::paths::{payment_path, PaymentPath};
use crate::rail::pay_out;
use crate::types::{Status, ESCROW_STALE_NS};
use crate::{Contract, ContractExt};

fn assert_escrow() {
    if payment_path() != PaymentPath::Escrow {
        env::panic_str("Arrow: E16 escrow path disabled");
    }
}

#[near]
impl Contract {
    /// Anyone (the relayer). Idempotent: a second call fails with E17.
    pub fn request_eval(&mut self, eval_id: u64) -> Promise {
        assert_escrow();
        if self.paused {
            env::panic_str("Arrow: E05 paused");
        }
        let mut eval = match self.evals.get(&eval_id) {
            Some(e) if e.status == Status::Escrowed => e.clone(),
            _ => env::panic_str("Arrow: E17 wrong state"),
        };
        self.assert_tank(self.cfg.outlayer_deposit_eval.0);
        let listing = match self.listings.get(&eval.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        let criteria = eval.sealed_criteria.take().unwrap_or_default();
        eval.status = Status::Pending;
        let input = eval_input(&listing, &eval, &criteria);
        self.evals.insert(eval_id, eval);
        self.eval_promise(eval_id, input)
    }

    /// Anyone (the relayer). Idempotent: a second call fails with E17.
    pub fn request_release(&mut self, purchase_id: u64) -> Promise {
        assert_escrow();
        if self.paused {
            env::panic_str("Arrow: E05 paused");
        }
        let mut p = match self.purchases.get(&purchase_id) {
            Some(p) if p.status == Status::Escrowed => p.clone(),
            _ => env::panic_str("Arrow: E17 wrong state"),
        };
        self.assert_tank(self.cfg.outlayer_deposit_release.0);
        let listing = match self.listings.get(&p.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        p.status = Status::Pending;
        let input = release_input(&listing, &p);
        self.purchases.insert(purchase_id, p);
        self.release_promise(purchase_id, input)
    }

    /// Anyone, also while paused (the buyer's own way out if the relayer is gone).
    /// `kind` is `"eval"` or `"buy"`. Pays the held fee or price back with reason `stale`.
    pub fn refund_stale(&mut self, kind: String, id: u64) {
        assert_escrow();
        let now = env::block_timestamp();
        let (listing_id, buyer, rail, amount, created) = match kind.as_str() {
            "eval" => match self.evals.get(&id) {
                Some(e) if e.status == Status::Escrowed => (e.listing_id, e.buyer.clone(), e.rail, e.fee, e.created_at_ns),
                _ => env::panic_str("Arrow: E17 wrong state"),
            },
            "buy" => match self.purchases.get(&id) {
                Some(p) if p.status == Status::Escrowed => (p.listing_id, p.buyer.clone(), p.rail, p.price, p.created_at_ns),
                _ => env::panic_str("Arrow: E17 wrong state"),
            },
            _ => env::panic_str("Arrow: E04 bad msg: kind"),
        };
        if now.saturating_sub(created) < ESCROW_STALE_NS {
            env::panic_str("Arrow: E18 not stale yet");
        }
        if kind == "eval" {
            if let Some(mut e) = self.evals.get(&id).cloned() {
                e.status = Status::Refunded;
                e.refund_reason = Some("stale".into());
                e.sealed_criteria = None;
                e.settled_at_ns = Some(now);
                self.evals.insert(id, e);
            }
            self.release_eval_slot(listing_id);
        } else if let Some(mut p) = self.purchases.get(&id).cloned() {
            p.status = Status::Refunded;
            p.refund_reason = Some("stale".into());
            p.settled_at_ns = Some(now);
            self.purchases.insert(id, p);
        }
        pay_out(&self.cfg, rail, buyer, amount.0, format!("arrow:refund:{kind}:{id}"));
        ArrowEvent::ArrowRefund { kind, listing_id, id, reason: "stale".into(), amount }.emit();
    }
}

#[cfg(test)]
mod tests {
    use crate::msg::{BuyMsg, EvalMsg, Msg};
    use crate::paths::{PaymentPath, TEST_PAYMENT_PATH};
    use crate::testkit::*;
    use crate::types::*;
    use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
    use near_sdk::json_types::U128;
    use near_sdk::serde_json::{json, Value};
    use near_sdk::test_utils::get_logs;
    use near_sdk::{PromiseOrValue, PromiseResult};

    fn use_path(p: PaymentPath) {
        TEST_PAYMENT_PATH.with(|c| c.set(Some(p)));
    }

    fn panic_text(e: Box<dyn std::any::Any + Send>) -> String {
        e.downcast_ref::<String>().cloned().unwrap_or_default()
    }

    /// Escrow contract with one listing: eval fee 50000, price 2_000_000.
    fn listed() -> crate::Contract {
        use_path(PaymentPath::Escrow);
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.eval_fee = U128(50_000);
        m.price = U128(2_000_000);
        assert_eq!(value_of(mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)))), json!(["0"]));
        setup(intents(), 10 * NEAR);
        c
    }

    fn eval(c: &mut crate::Contract, amount: u128) -> Value {
        let m = EvalMsg { listing_id: 1, sealed_criteria: STANDARD.encode([9u8; 200]), buyer_pk: format!("04{}", "22".repeat(64)) };
        value_of(mt_call(c, buyer(), amount, msg_json(Msg::Eval(m))))
    }

    fn buy(c: &mut crate::Contract, amount: u128) -> Value {
        let m = BuyMsg { listing_id: 1, buyer_pk: format!("04{}", "22".repeat(64)) };
        value_of(mt_call(c, buyer(), amount, msg_json(Msg::Buy(m))))
    }

    /// The relayer's call context (any account).
    fn relayer_at(ts: u64) {
        let mut b = near_sdk::test_utils::VMContextBuilder::new();
        b.current_account_id(self_id())
            .predecessor_account_id(acc("relayer.test.near"))
            .account_balance(near_sdk::NearToken::from_yoctonear(10 * NEAR))
            .block_timestamp(ts);
        near_sdk::testing_env!(b.build());
    }

    fn mt_transfers() -> Vec<(String, String)> {
        calls()
            .into_iter()
            .filter(|(_, m, _, _)| m == "mt_transfer")
            .map(|(_, _, a, _)| (a["receiver_id"].as_str().unwrap().to_string(), a["amount"].as_str().unwrap().to_string()))
            .collect()
    }

    #[test]
    fn escrow_list_eval_accepts_and_holds() {
        let mut c = listed();
        assert_eq!(eval(&mut c, 80_000), json!(["30000"]));
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.fee.0, e.sealed_criteria.is_some()), (Status::Escrowed, 50_000, true));
        assert_eq!(c.listings.get(&1).unwrap().evals_used, 1);
        assert!(calls().iter().all(|(_, m, _, _)| m != "request_execution"), "no OutLayer call before request_eval");
    }

    #[test]
    fn escrow_emits_accepted_events() {
        let mut c = listed();
        let _ = eval(&mut c, 50_000);
        let mut logs = get_logs();
        setup(intents(), 10 * NEAR);
        assert_eq!(buy(&mut c, 2_000_000), json!(["0"]));
        logs.extend(get_logs());
        assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_eval""#) && l.contains(r#""phase":"accepted""#) && l.contains(r#""eval_id":1"#)), "{logs:?}");
        assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_purchase""#) && l.contains(r#""phase":"accepted""#) && l.contains(r#""purchase_id":1"#)), "{logs:?}");
        assert_eq!(c.purchases.get(&1).unwrap().status, Status::Escrowed);
    }

    #[test]
    fn escrow_request_eval_once() {
        let mut c = listed();
        let _ = eval(&mut c, 50_000);
        relayer_at(0);
        let _ = c.request_eval(1);
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.sealed_criteria.is_none()), (Status::Pending, true));
        let all = calls();
        let (_, _, args, dep) = all.iter().find(|(_, m, _, _)| m == "request_execution").expect("request_execution");
        assert_eq!(*dep, NEAR / 50);
        let input: Value = near_sdk::serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
        assert_eq!(input["eval"]["sealed_criteria"], json!(STANDARD.encode([9u8; 200])));
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.request_eval(1); })).map_err(panic_text).unwrap_err();
        assert!(err.contains("Arrow: E17 wrong state"), "{err}");
    }

    #[test]
    fn escrow_success_pays_90_10() {
        let mut c = listed();
        let _ = eval(&mut c, 50_000);
        relayer_at(0);
        let _ = c.request_eval(1);
        callback_env(PromiseResult::Successful(json!({"v":1,"ok":true,"r":STANDARD.encode([1u8; 98]),"h":"cd".repeat(32)}).to_string().into_bytes()));
        assert_eq!(c.on_eval(1), Value::Null);
        assert_eq!(c.evals.get(&1).unwrap().status, Status::Done);
        assert_eq!(mt_transfers(), vec![(seller().to_string(), "45000".into()), ("treasury.test.near".into(), "5000".into())]);
    }

    #[test]
    fn escrow_refund_on_null_transfers_back() {
        let mut c = listed();
        let _ = eval(&mut c, 80_000);
        relayer_at(0);
        let _ = c.request_eval(1);
        callback_env(PromiseResult::Successful(b"null".to_vec()));
        assert_eq!(c.on_eval(1), Value::Null);
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.refund_reason.as_deref()), (Status::Refunded, Some("null")));
        // only the held fee goes back (the 30000 overpay was returned at accept time), less the
        // treasury's 10 % that a failed eval keeps (ARW-C2)
        assert_eq!(mt_transfers(), vec![(buyer().to_string(), "45000".into()), ("treasury.test.near".into(), "5000".into())]);
        assert!(get_logs().iter().any(|l| l.contains(r#""event":"arrow_refund""#) && l.contains(r#""amount":"45000""#)));
        assert_eq!(c.listings.get(&1).unwrap().evals_used, 1);
    }

    /// ARW-C2: an escrowed eval holds an in-flight slot until it settles or refund_stale frees it.
    #[test]
    fn escrow_in_flight_slots_freed_by_settle_and_stale() {
        let mut c = listed();
        for _ in 0..MAX_EVALS_IN_FLIGHT {
            setup(intents(), 10 * NEAR);
            let _ = eval(&mut c, 50_000);
        }
        setup(intents(), 10 * NEAR);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| eval(&mut c, 50_000))).map_err(panic_text).unwrap_err();
        assert!(err.contains("Arrow: E21 too many evals in flight"), "{err}");
        relayer_at(ESCROW_STALE_NS);
        c.refund_stale("eval".into(), 1);
        relayer_at(0);
        let _ = c.request_eval(2);
        callback_env(PromiseResult::Failed);
        c.on_eval(2);
        for _ in 0..2 {
            setup(intents(), 10 * NEAR);
            assert_eq!(eval(&mut c, 50_000), json!(["0"]));
        }
        setup(intents(), 10 * NEAR);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| eval(&mut c, 50_000))).map_err(panic_text).unwrap_err();
        assert!(err.contains("E21"), "{err}");
    }

    #[test]
    fn escrow_buy_release_pays_98_2_and_refunds() {
        let mut c = listed();
        assert_eq!(buy(&mut c, 2_030_000), json!(["30000"]));
        relayer_at(0);
        let _ = c.request_release(1);
        assert_eq!(c.purchases.get(&1).unwrap().status, Status::Pending);
        callback_env(PromiseResult::Successful(json!({"v":1,"ok":true,"k":STANDARD.encode([2u8; 129]),"h":"cd".repeat(32)}).to_string().into_bytes()));
        assert_eq!(c.on_release(1), Value::Null);
        assert_eq!(mt_transfers(), vec![(seller().to_string(), "1960000".into()), ("treasury.test.near".into(), "40000".into())]);

        setup(intents(), 10 * NEAR);
        let _ = buy(&mut c, 2_000_000);
        relayer_at(0);
        let _ = c.request_release(2);
        callback_env(PromiseResult::Successful(br#"{"v":1,"ok":false}"#.to_vec()));
        assert_eq!(c.on_release(2), Value::Null);
        assert_eq!(c.purchases.get(&2).unwrap().refund_reason.as_deref(), Some("not_ok"));
        assert_eq!(mt_transfers(), vec![(buyer().to_string(), "2000000".into())]);
    }

    #[test]
    fn escrow_refund_stale_after_15_min() {
        let mut c = listed();
        let _ = eval(&mut c, 50_000);
        let _ = buy(&mut c, 2_000_000);
        relayer_at(ESCROW_STALE_NS - 1);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.refund_stale("eval".into(), 1))).map_err(panic_text).unwrap_err();
        assert!(err.contains("Arrow: E18 not stale yet"), "{err}");

        relayer_at(ESCROW_STALE_NS);
        c.paused = true; // still allowed while paused
        c.refund_stale("eval".into(), 1);
        c.refund_stale("buy".into(), 1);
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.refund_reason.as_deref(), e.sealed_criteria.is_none()), (Status::Refunded, Some("stale"), true));
        assert_eq!(c.purchases.get(&1).unwrap().refund_reason.as_deref(), Some("stale"));
        assert_eq!(mt_transfers(), vec![(buyer().to_string(), "50000".into()), (buyer().to_string(), "2000000".into())]);
        assert_eq!(get_logs().iter().filter(|l| l.contains(r#""reason":"stale""#)).count(), 2);

        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.refund_stale("eval".into(), 1))).map_err(panic_text).unwrap_err();
        assert!(err.contains("E17"), "{err}");
        c.paused = false;
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.request_eval(1); })).map_err(panic_text).unwrap_err();
        assert!(err.contains("E17"), "{err}");
    }

    #[test]
    fn escrow_request_checks_pause_and_tank() {
        let mut c = listed();
        let _ = eval(&mut c, 50_000);
        relayer_at(0);
        c.paused = true;
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.request_eval(1); })).map_err(panic_text).unwrap_err();
        assert!(err.contains("Arrow: E05 paused"), "{err}");
        c.paused = false;
        setup(acc("relayer.test.near"), NEAR / 100 * 6);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.request_eval(1); })).map_err(panic_text).unwrap_err();
        assert!(err.contains("Arrow: E10 gas tank low"), "{err}");
        assert_eq!(c.evals.get(&1).unwrap().status, Status::Escrowed);
    }

    #[test]
    fn notify_build_rejects_escrow_methods() {
        use_path(PaymentPath::Notify);
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        for i in 0..3 {
            let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match i {
                0 => {
                    let _ = c.request_eval(1);
                }
                1 => {
                    let _ = c.request_release(1);
                }
                _ => c.refund_stale("eval".into(), 1),
            }))
            .map_err(panic_text)
            .unwrap_err();
            assert!(err.contains("Arrow: E16 escrow path disabled"), "{err}");
        }
        // and the notification path does not hold funds
        let mut m = list_msg();
        m.eval_fee = U128(50_000);
        let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)));
        setup(intents(), 10 * NEAR);
        let em = EvalMsg { listing_id: 1, sealed_criteria: STANDARD.encode([9u8; 200]), buyer_pk: format!("04{}", "22".repeat(64)) };
        assert!(matches!(mt_call(&mut c, buyer(), 50_000, msg_json(Msg::Eval(em))), PromiseOrValue::Promise(_)));
        assert_eq!(c.evals.get(&1).unwrap().status, Status::Pending);
    }

    #[test]
    fn escrow_compiled_path_matches_env() {
        // Run with ARROW_PAYMENT_PATH=escrow to check the compile-time switch itself.
        let want = match option_env!("ARROW_PAYMENT_PATH") {
            Some("escrow") => PaymentPath::Escrow,
            Some("notify") => PaymentPath::Notify,
            _ => crate::paths::DEFAULT_PAYMENT_PATH,
        };
        assert_eq!(crate::paths::PAYMENT_PATH, want);
        assert_eq!(crate::paths::payment_path(), want);
    }
}
