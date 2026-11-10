//! `op=eval` and its OutLayer callback.
//! G1: `evals_used` is counted when the eval is accepted (in-flight) and never decremented [DEC H-08].
//! G3: the enclave's `h` must equal the listing's `blob_sha256`, else `hash_mismatch` refund.
//! RT B3: OutLayer answers `null` on failure and timeout, so the raw promise result is classified
//! here instead of using `#[callback_result]` [DEC H-09].

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, AccountId, Gas, PromiseError, PromiseOrValue};

use crate::events::ArrowEvent;
use crate::msg::EvalMsg;
use crate::outlayer::{eval_input, request};
use crate::paths::{PaymentPath, PAYMENT_PATH};
use crate::rail::{pay_out, refund_value, split};
use crate::types::*;
use crate::validate::{is_lower_hex, validate_eval};
use crate::{Contract, ContractExt};

const ON_EVAL_GAS: Gas = Gas::from_tgas(60); // [DEC H-11]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Eval,
    Release,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settled {
    /// `r` (eval) or `k` (release), base64 as received.
    pub sealed: String,
    pub h: String,
}

/// Maps the raw OutLayer result to a settled output or a refund reason
/// (`null`, `bad_output`, `not_ok`, `hash_mismatch`).
pub fn classify(res: Result<Vec<u8>, PromiseError>, expected_h: &str, action: Action) -> Result<Settled, &'static str> {
    let bytes = match res {
        Ok(b) => b,
        Err(PromiseError::Failed) => return Err("null"),
        Err(_) => return Err("bad_output"),
    };
    if bytes.len() > OUTPUT_LIMIT_BYTES {
        return Err("bad_output");
    }
    let out: ArrowOut = match serde_json::from_slice::<Option<ArrowOut>>(&bytes) {
        Ok(Some(o)) => o,
        Ok(None) => return Err("null"),
        Err(_) => return Err("bad_output"),
    };
    if out.v != 1 {
        return Err("bad_output");
    }
    if !out.ok {
        return Err("not_ok");
    }
    let (sealed, want_len, other) = match action {
        Action::Eval => (out.r, SEALED_RESULT_LEN, out.k.is_some()),
        Action::Release => (out.k, SEALED_K_LEN, out.r.is_some()),
    };
    let (sealed, h) = match (sealed, out.h) {
        (Some(s), Some(h)) if !other && out.pk.is_none() => (s, h),
        _ => return Err("bad_output"),
    };
    if !is_lower_hex(&h, 64) {
        return Err("bad_output");
    }
    match STANDARD.decode(&sealed) {
        Ok(b) if b.len() == want_len => {}
        _ => return Err("bad_output"),
    }
    if h != expected_h {
        return Err("hash_mismatch");
    }
    Ok(Settled { sealed, h })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn budget(l: &Listing) -> (u64, u64) {
    let spent = u64::from(l.evals_used) * u64::from(l.bits_per_eval_milli);
    let total = u64::from(l.max_evals) * u64::from(l.bits_per_eval_milli);
    (spent, total - spent)
}

impl Contract {
    pub(crate) fn handle_eval(&mut self, sender: AccountId, amount: u128, m: EvalMsg, rail: Rail) -> PromiseOrValue<Value> {
        self.assert_open();
        let mut listing = match self.listings.get(&m.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        if listing.program_hash_at_list != self.cfg.program_wasm_hash {
            env::panic_str("Arrow: E13 listing sealed to an old program");
        }
        if let Err(field) = validate_eval(&m) {
            env::panic_str(&format!("Arrow: E04 bad msg: {field}"));
        }
        if amount < listing.eval_fee.0 {
            env::panic_str("Arrow: E08 amount below required");
        }
        if listing.evals_used >= listing.max_evals {
            env::panic_str("Arrow: E09 leak budget exhausted");
        }
        self.assert_tank(self.cfg.outlayer_deposit_eval.0);
        if PAYMENT_PATH == PaymentPath::Escrow {
            env::panic_str("Arrow: E16 escrow path disabled");
        }
        self.charge_eval_cap(&sender);

        // Mutations start here. The budget counts the eval now and is never given back.
        listing.evals_used += 1;
        let id = self.next_eval_id;
        self.next_eval_id += 1;
        let eval = Eval {
            id,
            listing_id: listing.id,
            buyer: sender,
            buyer_pk: m.buyer_pk,
            paid: U128(amount),
            fee: listing.eval_fee,
            seed: hex(&env::random_seed_array()),
            rail,
            status: Status::Pending,
            sealed_result: None,
            h: None,
            refund_reason: None,
            created_at_ns: env::block_timestamp(),
            settled_at_ns: None,
            sealed_criteria: None,
        };
        let input = eval_input(&listing, &eval, &m.sealed_criteria);
        let (spent, left) = budget(&listing);
        ArrowEvent::ArrowEval {
            phase: "accepted".into(),
            listing_id: listing.id,
            eval_id: id,
            buyer: eval.buyer.clone(),
            fee: eval.fee,
            spent_milli: spent,
            left_milli: left,
            h: None,
        }
        .emit();
        self.evals_by_listing.entry(listing.id).or_default().push(id);
        self.listings.insert(listing.id, listing);
        self.evals.insert(id, eval);

        let call = request(&self.cfg, input, self.cfg.outlayer_deposit_eval.0, &self.cfg.limits_eval);
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(ON_EVAL_GAS)
            .with_unused_gas_weight(1)
            .on_eval(id);
        PromiseOrValue::Promise(call.then(callback))
    }
}

#[near]
impl Contract {
    /// OutLayer callback. Returns the unused amount in the rail's resolver shape.
    #[private]
    pub fn on_eval(&mut self, eval_id: u64) -> Value {
        let mut eval = match self.evals.get(&eval_id) {
            Some(e) if e.status == Status::Pending => e.clone(),
            _ => env::panic_str("Arrow: E17 wrong state"),
        };
        let listing = match self.listings.get(&eval.listing_id) {
            Some(l) => l.clone(),
            None => env::panic_str("Arrow: E07 unknown listing"),
        };
        let result = classify(env::promise_result_checked(0, MAX_OUTPUT_BYTES), &listing.blob_sha256, Action::Eval);
        eval.settled_at_ns = Some(env::block_timestamp());
        let refund = match result {
            Ok(s) => {
                let fee = eval.fee.0;
                let (seller_share, treasury_share) = split(fee, self.cfg.fee_bps_eval);
                pay_out(&self.cfg, eval.rail, listing.payout.clone(), seller_share, format!("arrow:eval:{eval_id}"));
                pay_out(&self.cfg, eval.rail, self.cfg.treasury.clone(), treasury_share, format!("arrow:eval-fee:{eval_id}"));
                let (spent, left) = budget(&listing);
                ArrowEvent::ArrowEval {
                    phase: "done".into(),
                    listing_id: listing.id,
                    eval_id,
                    buyer: eval.buyer.clone(),
                    fee: eval.fee,
                    spent_milli: spent,
                    left_milli: left,
                    h: Some(s.h.clone()),
                }
                .emit();
                eval.status = Status::Done;
                eval.sealed_result = Some(s.sealed);
                eval.h = Some(s.h);
                eval.paid.0 - fee
            }
            Err(reason) => {
                ArrowEvent::ArrowRefund {
                    kind: "eval".into(),
                    listing_id: listing.id,
                    id: eval_id,
                    reason: reason.into(),
                    amount: eval.paid,
                }
                .emit();
                eval.status = Status::Refunded;
                eval.refund_reason = Some(reason.into());
                eval.paid.0
            }
        };
        let rail = eval.rail;
        self.evals.insert(eval_id, eval);
        refund_value(rail, refund)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::msg::Msg;
    use crate::testkit::*;
    use near_sdk::serde_json::json;
    use near_sdk::test_utils::get_logs;
    use near_sdk::PromiseResult;

    const VECTORS_OUT: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/output-vectors.json"));
    const VECTORS_IN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/input-vectors.json"));

    fn eval_msg(listing_id: u64) -> EvalMsg {
        EvalMsg {
            listing_id,
            sealed_criteria: STANDARD.encode([9u8; 200]),
            buyer_pk: format!("04{}", "22".repeat(64)),
        }
    }

    /// A contract with one listing (eval fee 50000, max_evals as given).
    fn listed(max_evals: u32) -> crate::Contract {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let mut m = list_msg();
        m.eval_fee = U128(50_000);
        m.max_evals = max_evals;
        let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(m)));
        setup(intents(), 10 * NEAR); // clear receipts and logs
        c
    }

    fn eval(c: &mut crate::Contract, amount: u128) -> PromiseOrValue<Value> {
        mt_call(c, buyer(), amount, msg_json(Msg::Eval(eval_msg(1))))
    }

    fn auto_eval_output(h: &str, r_len: usize) -> Vec<u8> {
        json!({"v":1,"ok":true,"r":STANDARD.encode(vec![1u8; r_len]),"h":h}).to_string().into_bytes()
    }

    #[test]
    fn eval_increments_budget_in_flight() {
        let mut c = listed(20);
        assert!(matches!(eval(&mut c, 50_000), PromiseOrValue::Promise(_)));
        assert_eq!(c.listings.get(&1).unwrap().evals_used, 1);
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.paid.0, e.fee.0, e.seed.len()), (Status::Pending, 50_000, 50_000, 64));
        let logs = get_logs();
        let accepted = logs.iter().find(|l| l.contains(r#""event":"arrow_eval""#)).expect("arrow_eval event");
        assert!(accepted.contains(r#""phase":"accepted""#), "{accepted}");
        assert!(accepted.contains(&format!(r#""spent_milli":5673,"left_milli":{}"#, 20 * 5673 - 5673)), "{accepted}");
        assert!(!accepted.contains(r#""h""#));
    }

    #[test]
    #[should_panic(expected = "Arrow: E09 leak budget exhausted")]
    fn eval_budget_exhausted_panics() {
        let mut c = listed(1);
        let _ = eval(&mut c, 50_000);
        let _ = eval(&mut c, 50_000);
    }

    #[test]
    fn budget_survives_refund() {
        let mut c = listed(1);
        let _ = eval(&mut c, 50_000);
        callback_env(PromiseResult::Failed);
        c.on_eval(1);
        assert_eq!(c.listings.get(&1).unwrap().evals_used, 1);
        setup(intents(), 10 * NEAR);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| eval(&mut c, 50_000)));
        assert!(res.is_err(), "refunded eval gave its budget back");
    }

    #[test]
    #[should_panic(expected = "Arrow: E08 amount below required")]
    fn eval_below_fee() {
        let mut c = listed(20);
        let _ = eval(&mut c, 49_999);
    }

    #[test]
    #[should_panic(expected = "Arrow: E07 unknown listing")]
    fn eval_unknown_listing() {
        let mut c = listed(20);
        let _ = mt_call(&mut c, buyer(), 50_000, msg_json(Msg::Eval(eval_msg(2))));
    }

    #[test]
    #[should_panic(expected = "Arrow: E10 gas tank low")]
    fn eval_tank_low() {
        let mut c = listed(20);
        // tank_min 0.05 + deposit 0.02 > 0.06
        setup(intents(), NEAR / 100 * 6);
        let _ = eval(&mut c, 50_000);
    }

    #[test]
    #[should_panic(expected = "Arrow: E13 listing sealed to an old program")]
    fn eval_old_program() {
        let mut c = listed(20);
        c.cfg.program_wasm_hash = "ef".repeat(32);
        let _ = eval(&mut c, 50_000);
    }

    #[test]
    fn outlayer_request_args() {
        let mut c = listed(20);
        let _ = eval(&mut c, 50_000);
        let all = calls();
        let (to, _, args, dep) = all.iter().find(|(_, m, _, _)| m == "request_execution").expect("request_execution receipt");
        assert_eq!((to.as_str(), *dep), ("outlayer.test.near", NEAR / 50));
        assert_eq!(args["source"], json!({"WasmUrl":{"url":"https://example.test/arrow-tee.wasm","hash":"ab".repeat(32),"build_target":"wasm32-wasip2"}}));
        assert_eq!(args["resource_limits"], json!({"max_instructions":20_000_000_000u64,"max_memory_mb":512,"max_execution_seconds":100}));
        assert_eq!(args["secrets_ref"], json!({"profile":"arrow","account_id":"arrow.test.near"}));
        assert_eq!((args["response_format"].clone(), args["payer_account_id"].clone(), args["params"].clone()), (json!("Json"), json!("arrow.test.near"), Value::Null));
        let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
        assert_eq!((input["action"].clone(), input["eval"]["id"].clone(), input["listing"]["id"].clone()), (json!("eval"), json!(1), json!(1)));
        assert!(all.iter().any(|(to, m, a, _)| to == "arrow.test.near" && m == "on_eval" && a["eval_id"] == 1));
    }

    #[test]
    fn on_eval_success_pays_90_10() {
        let mut c = listed(20);
        let _ = eval(&mut c, 60_000);
        callback_env(PromiseResult::Successful(auto_eval_output(&"cd".repeat(32), 98)));
        let v = c.on_eval(1);
        assert_eq!(v, json!(["10000"]));
        let e = c.evals.get(&1).unwrap();
        assert_eq!((e.status, e.h.clone(), e.sealed_result.is_some()), (Status::Done, Some("cd".repeat(32)), true));
        let transfers: Vec<_> = calls().into_iter().filter(|(_, m, _, _)| m == "mt_transfer").collect();
        assert_eq!(transfers.len(), 2);
        let pairs: Vec<(String, String)> = transfers.iter().map(|(_, _, a, _)| (a["receiver_id"].as_str().unwrap().to_string(), a["amount"].as_str().unwrap().to_string())).collect();
        assert_eq!(pairs, vec![(seller().to_string(), "45000".into()), ("treasury.test.near".into(), "5000".into())]);
        assert!(transfers.iter().all(|(to, _, _, dep)| to == "intents.test.near" && *dep == 1));
        assert!(get_logs().iter().any(|l| l.contains(r#""phase":"done""#) && l.contains(&format!(r#""h":"{}""#, "cd".repeat(32)))));
    }

    #[test]
    fn on_eval_refund_table() {
        let good_h = "cd".repeat(32);
        let cases: Vec<(PromiseResult, &str)> = vec![
            (PromiseResult::Failed, "null"),
            (PromiseResult::Successful(b"null".to_vec()), "null"),
            (PromiseResult::Successful(b"\"x\"".to_vec()), "bad_output"),
            (PromiseResult::Successful(json!({"v":2,"ok":true,"r":STANDARD.encode([1u8; 98]),"h":good_h}).to_string().into_bytes()), "bad_output"),
            (PromiseResult::Successful(br#"{"v":1,"ok":false}"#.to_vec()), "not_ok"),
            (PromiseResult::Successful(auto_eval_output(&"00".repeat(32), 98)), "hash_mismatch"),
            (PromiseResult::Successful(auto_eval_output(&good_h, 97)), "bad_output"),
            (PromiseResult::Successful(vec![b' '; 1025]), "bad_output"),
        ];
        for (result, reason) in cases {
            let mut c = listed(20);
            let _ = eval(&mut c, 70_000);
            callback_env(result);
            let v = c.on_eval(1);
            assert_eq!(v, json!(["70000"]), "{reason}");
            let e = c.evals.get(&1).unwrap();
            assert_eq!((e.status, e.refund_reason.as_deref()), (Status::Refunded, Some(reason)));
            assert_eq!(c.listings.get(&1).unwrap().evals_used, 1, "{reason}: budget changed");
            assert!(calls().iter().all(|(_, m, _, _)| m != "mt_transfer"), "{reason}: paid out");
            let logs = get_logs();
            assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_refund""#) && l.contains(&format!(r#""reason":"{reason}""#)) && l.contains(r#""amount":"70000""#)), "{reason}: {logs:?}");
        }
    }

    #[test]
    #[should_panic(expected = "Arrow: E17 wrong state")]
    fn on_eval_twice_panics() {
        let mut c = listed(20);
        let _ = eval(&mut c, 50_000);
        callback_env(PromiseResult::Failed);
        c.on_eval(1);
        c.on_eval(1);
    }

    #[test]
    fn output_vectors_classify() {
        let v: Value = serde_json::from_str(VECTORS_OUT).unwrap();
        let mut checked = 0;
        for case in v["cases"].as_array().unwrap() {
            let raw = case["raw"].as_str().unwrap().as_bytes().to_vec();
            let action = match case["context"]["action"].as_str().unwrap() {
                "eval" => Action::Eval,
                "release" => Action::Release,
                _ => {
                    let got = if crate::admin::classify_pk(Ok(raw)).is_ok() { "accept_derive" } else { "reject_derive" };
                    assert_eq!(got, case["contract_decision"].as_str().unwrap(), "case {}", case["name"]);
                    checked += 1;
                    continue;
                }
            };
            let expected_h = case["context"]["listing_blob_sha256"].as_str().unwrap();
            let got = match classify(Ok(raw), expected_h, action) {
                Ok(_) if action == Action::Eval => "accept_eval".to_string(),
                Ok(_) => "accept_release".to_string(),
                Err(r) => format!("refund:{r}"),
            };
            assert_eq!(got, case["contract_decision"].as_str().unwrap(), "case {}", case["name"]);
            checked += 1;
        }
        assert!(checked >= 15, "only {checked} cases");
        assert_eq!(classify(Err(PromiseError::Failed), "x", Action::Eval), Err("null"));
        assert_eq!(classify(Err(PromiseError::TooLong(1025)), "x", Action::Eval), Err("bad_output"));
    }

    #[test]
    fn eval_input_matches_vectors() {
        let v: Value = serde_json::from_str(VECTORS_IN).unwrap();
        for case in v["valid"].as_array().unwrap().iter().filter(|c| c["input"]["action"] == "eval") {
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
                evals_used: 1,
                bits_per_eval_milli: 1,
                mode: serde_json::from_value(l["mode"].clone()).unwrap(),
                program_hash_at_list: String::new(),
                created_at_ns: 0,
            };
            let e = Eval {
                id: i["eval"]["id"].as_u64().unwrap(),
                listing_id: listing.id,
                buyer: buyer(),
                buyer_pk: i["eval"]["buyer_pk"].as_str().unwrap().into(),
                paid: U128(0),
                fee: U128(0),
                seed: i["eval"]["seed"].as_str().unwrap().into(),
                rail: Rail::Mt,
                status: Status::Pending,
                sealed_result: None,
                h: None,
                refund_reason: None,
                created_at_ns: 0,
                settled_at_ns: None,
                sealed_criteria: None,
            };
            let built: Value = serde_json::from_str(&eval_input(&listing, &e, i["eval"]["sealed_criteria"].as_str().unwrap())).unwrap();
            assert_eq!(&built, i, "case {}", case["name"]);
        }
    }

    #[test]
    fn input_data_under_event_threshold() {
        let mut listing_msg = list_msg();
        listing_msg.columns = (0..64).map(|i| format!("{i:0>40}")).collect();
        listing_msg.blob_url = format!("https://b.test/{}", "a".repeat(200 - 15));
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        let _ = mt_call(&mut c, seller(), 100_000, msg_json(Msg::List(listing_msg)));
        let listing = c.listings.get(&1).unwrap().clone();
        let crit = STANDARD.encode(vec![7u8; 3072]);
        let eval = Eval {
            id: u64::MAX,
            listing_id: u64::MAX,
            buyer: buyer(),
            buyer_pk: format!("04{}", "22".repeat(64)),
            paid: U128(0),
            fee: U128(0),
            seed: "ab".repeat(32),
            rail: Rail::Mt,
            status: Status::Pending,
            sealed_result: None,
            h: None,
            refund_reason: None,
            created_at_ns: 0,
            settled_at_ns: None,
            sealed_criteria: None,
        };
        let n = eval_input(&listing, &eval, &crit).len();
        assert!(n < INPUT_EVENT_THRESHOLD, "input_data is {n} bytes");
    }

    #[cfg(feature = "testnet")]
    mod caps {
        use super::*;

        fn listed_testnet() -> crate::Contract {
            let mut c = listed(500);
            if let Some(caps) = c.cfg.testnet_caps.as_mut() {
                caps.global_per_day = 12;
            }
            c
        }

        /// Fresh context per call: each eval schedules 210 TGas of promises.
        fn eval_at(c: &mut crate::Contract, who: &str, ts: u64) -> std::thread::Result<PromiseOrValue<Value>> {
            let mut b = near_sdk::test_utils::VMContextBuilder::new();
            b.current_account_id(self_id())
                .predecessor_account_id(intents())
                .account_balance(near_sdk::NearToken::from_yoctonear(10 * NEAR))
                .block_timestamp(ts);
            near_sdk::testing_env!(b.build());
            let who = acc(who);
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| mt_call(c, who, 50_000, msg_json(Msg::Eval(eval_msg(1))))))
        }

        fn eval_as(c: &mut crate::Contract, who: &str) -> std::thread::Result<PromiseOrValue<Value>> {
            eval_at(c, who, 0)
        }

        fn panic_text(e: Box<dyn std::any::Any + Send>) -> String {
            e.downcast_ref::<String>().cloned().unwrap_or_default()
        }

        #[test]
        fn cap_per_account_10_then_e11() {
            let mut c = listed_testnet();
            for _ in 0..10 {
                assert!(eval_as(&mut c, "a.test.near").is_ok());
            }
            let err = eval_as(&mut c, "a.test.near").err().map(panic_text).unwrap();
            assert!(err.contains("E11"), "{err}");
        }

        #[test]
        fn cap_global_then_e12() {
            let mut c = listed_testnet();
            for i in 0..12 {
                assert!(eval_as(&mut c, &format!("u{}.test.near", i % 6)).is_ok());
            }
            let err = eval_as(&mut c, "fresh.test.near").err().map(panic_text).unwrap();
            assert!(err.contains("E12"), "{err}");
        }

        #[test]
        fn cap_exempt_not_counted() {
            let mut c = listed_testnet();
            for _ in 0..15 {
                assert!(eval_as(&mut c, "bench.test.near").is_ok());
            }
            assert_eq!(c.cap_global_used, 0);
        }

        #[test]
        fn cap_resets_next_day() {
            let mut c = listed_testnet();
            for _ in 0..10 {
                assert!(eval_as(&mut c, "a.test.near").is_ok());
            }
            assert!(eval_as(&mut c, "a.test.near").is_err());
            assert!(eval_at(&mut c, "a.test.near", DAY_NS).is_ok());
            assert_eq!(c.cap_global_used, 1);
        }
    }
}
