//! Golden tests against the shared vectors in `fixtures/`.

use arrow_core::schema::{decode_state, state_index, Mode, Score, Verdict, GUARD_SCORE};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/").to_string() + name;
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn verdict(v: &Value) -> Verdict {
    match v.as_str().unwrap() {
        "BUY" => Verdict::Buy,
        "PASS" => Verdict::Pass,
        other => panic!("bad verdict {other}"),
    }
}

#[test]
fn state_index_vectors() {
    let f = fixture("state-index-vectors.json");
    let scored = f["scored"].as_array().unwrap();
    assert_eq!(scored.len(), 50);
    for row in scored {
        let s = Score {
            verdict: verdict(&row["verdict"]),
            fit: row["fit"].as_u64().unwrap() as u8,
            novelty: row["novelty"].as_u64().unwrap() as u8,
        };
        let idx = row["idx"].as_u64().unwrap() as u8;
        assert_eq!(state_index(Mode::Scored, &s).unwrap(), idx);
        assert_eq!(decode_state(Mode::Scored, idx), Some(s));
    }
    let vm = f["verdict_mode"].as_array().unwrap();
    assert_eq!(vm.len(), 2);
    for row in vm {
        let s = Score { verdict: verdict(&row["verdict"]), fit: 3, novelty: 3 };
        assert_eq!(u64::from(state_index(Mode::Verdict, &s).unwrap()), row["idx"].as_u64().unwrap());
    }
    assert_eq!(u64::from(state_index(Mode::Scored, &GUARD_SCORE).unwrap()), f["guard_tripped"]["scored_idx"].as_u64().unwrap());
    assert_eq!(u64::from(state_index(Mode::Verdict, &GUARD_SCORE).unwrap()), f["guard_tripped"]["verdict_idx"].as_u64().unwrap());
    assert_eq!(f["states"]["scored"].as_u64().unwrap(), 51);
    assert_eq!(f["states"]["verdict"].as_u64().unwrap(), 3);
    assert_eq!(f["bits_per_eval_milli"]["scored"].as_u64().unwrap(), u64::from(arrow_core::consts::BITS_PER_EVAL_MILLI_SCORED));
    assert_eq!(f["bits_per_eval_milli"]["verdict"].as_u64().unwrap(), u64::from(arrow_core::consts::BITS_PER_EVAL_MILLI_VERDICT));
    assert_eq!(
        f["result_ecies_len"].as_u64().unwrap() as usize,
        arrow_core::consts::ECIES_OVERHEAD + f["result_plaintext_len"].as_u64().unwrap() as usize
    );
}

#[test]
fn output_vectors_accept_sizes() {
    // Only accept_* cases are valid ArrowOut. Their byte lengths must match what schema.rs emits.
    let f = fixture("output-vectors.json");
    let cases = f["cases"].as_array().or_else(|| f["vectors"].as_array()).unwrap();
    let mut checked = 0;
    for c in cases {
        let decision = c["contract_decision"].as_str().unwrap_or("");
        let raw = c["raw"].as_str().unwrap();
        if decision == "refund:not_ok" {
            assert_eq!(raw.as_bytes(), arrow_core::schema::ERR_JSON);
        }
        if !decision.starts_with("accept") {
            continue;
        }
        let v: Value = serde_json::from_str(raw).unwrap();
        let rebuilt = if let Some(r) = v.get("r") {
            arrow_core::schema::out_eval(r.as_str().unwrap(), v["h"].as_str().unwrap()).unwrap()
        } else if let Some(k) = v.get("k") {
            arrow_core::schema::out_release(k.as_str().unwrap(), v["h"].as_str().unwrap()).unwrap()
        } else if let Some(pk) = v.get("pk") {
            arrow_core::schema::out_derive(pk.as_str().unwrap()).unwrap()
        } else {
            panic!("accept case without r/k/pk: {}", c["name"]);
        };
        assert_eq!(rebuilt, raw.as_bytes(), "case {}", c["name"]);
        checked += 1;
    }
    assert_eq!(checked, 3);
}
