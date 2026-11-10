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

/// The full prompt pipeline on `fixtures/llm-example/` must give the golden request body byte for
/// byte. `ARROW_UPDATE_FIXTURES=1` rewrites the golden (never set in CI).
#[test]
fn llm_request_matches_fixture() {
    use arrow_core::{consts, llm, parse, prompt, sample, stats};
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
    let data = std::fs::read(format!("{dir}llm-example/data.csv")).unwrap();
    let crit: Value = serde_json::from_slice(&std::fs::read(format!("{dir}llm-example/criteria.json")).unwrap()).unwrap();
    let seed_hex = std::fs::read_to_string(format!("{dir}llm-example/seed.txt")).unwrap();
    let seed: [u8; 32] = hex::decode(seed_hex.trim()).unwrap().try_into().unwrap();

    let (f, body) = parse::detect(&data).unwrap();
    let cols = parse::header(body, f).unwrap();
    let date_col = cols.iter().position(|c| c == crit["date_column"].as_str().unwrap());
    let st = stats::compute(body, f, &stats::StatsSpec { date_col, key_col: None }).unwrap();
    let idx = sample::sample_indices(&seed, st.rows, consts::SAMPLE_ROWS);
    let rows = stats::collect_rows(body, f, &st.columns, &idx).unwrap();
    let token = prompt::spotlight_token(&seed);
    let user = prompt::user_message(&token, crit["text"].as_str().unwrap(), &st, &rows, llm::Reasoning::QwenNoThinking).unwrap();
    let req = llm::request_body("Qwen/Qwen3.8-27B", llm::Reasoning::QwenNoThinking, prompt::SYSTEM, &user).unwrap();

    let golden = format!("{dir}llm-request-example.json");
    if std::env::var("ARROW_UPDATE_FIXTURES").as_deref() == Ok("1") {
        std::fs::write(&golden, &req).unwrap();
    }
    assert_eq!(req, std::fs::read(&golden).unwrap());
    // The seller's "<diff>" cell is escaped, never raw.
    let s = String::from_utf8(req).unwrap();
    assert!(s.contains("\\\\u003cdiff\\\\u003e"));
    assert_eq!(s.matches(&format!("</data-{token}>")).count(), 1);
    assert_eq!(s.matches("</data-").count(), 2); // SYSTEM names the generic </data-TOKEN> once
}

/// Rust-side MinHash vectors in the WS4-T03 case schema. `ARROW_UPDATE_FIXTURES=1` regenerates.
fn minhash_cases() -> Vec<(&'static str, Vec<String>)> {
    use sha2::{Digest, Sha256};
    let h = |s: String| hex::encode(Sha256::digest(s.as_bytes()));
    let wallets = (0..20)
        .map(|i| {
            let a = format!("0x{}", &h(format!("arrow:wallet:{i}"))[..40]);
            if i % 2 == 0 { a } else { a.to_uppercase().replacen("0X", "0x", 1) }
        })
        .collect();
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    vec![
        ("ascii_wallets", wallets),
        ("turkish", s(&["İstanbul", "ISTANBUL", "ıi"])),
        ("greek_final_sigma", s(&["ΟΔΟΣ"])),
        ("fullwidth_nfkc", s(&["ＡＢＣ１２３", "e\u{301}cole", "ﬁle"])),
        ("whitespace", s(&["\u{A0} a\tb  c\u{3000}", "\u{FEFF}x\u{85}y", " a\u{2003}\u{2003}b "])),
        ("duplicates", s(&["k1", "k1", "K1", " k1 "])),
        ("empty_and_blank", s(&["", "   ", "\u{3000}"])),
        ("default_ignorable", s(&["\u{200B}ACME\u{2060}", "A\u{FE0F}CME", "\u{E0041}acme\u{E007F}", "\u{200B} acme", "İSTANBUL", "i\u{307}\u{307}"])),
        ("random_1000", (0..1000).map(|i| h(format!("arrow:mh:{i}"))).collect()),
    ]
}

fn minhash_vectors_json() -> String {
    use arrow_core::{minhash, normalize};
    let cases: Vec<Value> = minhash_cases()
        .into_iter()
        .map(|(id, keys)| {
            let normalized: Vec<String> = keys.iter().map(|k| normalize::normalize_key(k)).collect();
            let u64_hex: Vec<String> = normalized.iter().map(|n| format!("{:016x}", minhash::base_hash(n))).collect();
            let sig = minhash::signature(keys.iter().map(String::as_str)).unwrap();
            serde_json::json!({"id": id, "keys": keys, "normalized": normalized, "u64_hex": u64_hex, "signature_hex": minhash::signature_hex(&sig)})
        })
        .collect();
    let doc = serde_json::json!({
        "version": 1,
        "generator": "arrow-core (Rust), tests/fixtures_golden.rs minhash_rs_vectors_golden",
        "note": "u64_hex is base_hash(normalized) for every key, including empty ones; the signature skips keys whose normalized form is empty; no keys left => ffffffffffffffff x 128.",
        "cases": cases,
    });
    serde_json::to_string_pretty(&doc).unwrap() + "\n"
}

fn check_minhash_vectors(name: &str) {
    use arrow_core::{minhash, normalize};
    let f = fixture(name);
    let cases = f["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let keys: Vec<String> = c["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_owned()).collect();
        let norm: Vec<&str> = c["normalized"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
        let u64_hex: Vec<&str> = c["u64_hex"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
        for ((k, n), x) in keys.iter().zip(&norm).zip(&u64_hex) {
            assert_eq!(normalize::normalize_key(k), *n, "{} normalize {k:?}", c["id"]);
            assert_eq!(format!("{:016x}", minhash::base_hash(n)), *x, "{} base {k:?}", c["id"]);
        }
        let sig = minhash::signature(keys.iter().map(String::as_str)).unwrap();
        assert_eq!(minhash::signature_hex(&sig), c["signature_hex"].as_str().unwrap(), "{} signature", c["id"]);
    }
}

#[test]
fn minhash_rs_vectors_golden() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/minhash-vectors-rs.json");
    let doc = minhash_vectors_json();
    if std::env::var("ARROW_UPDATE_FIXTURES").as_deref() == Ok("1") {
        std::fs::write(path, &doc).unwrap();
    }
    assert_eq!(doc, std::fs::read_to_string(path).unwrap());
    check_minhash_vectors("minhash-vectors-rs.json");
}

/// The TS vectors (WS4-T03, `fixtures/minhash-vectors.json`).
#[test]
fn minhash_matches_ts_vectors() {
    check_minhash_vectors("minhash-vectors.json");
}

/// Every valid criteria vector parses, every invalid one is rejected (the enclave's 3072-byte cap
/// is looser than the SDK's 2975; `too_large` is 3483 bytes so both reject it).
#[test]
fn criteria_vectors() {
    let f = fixture("criteria-vectors.json");
    for c in f["valid"].as_array().unwrap() {
        let raw = serde_json::to_vec(&c["criteria"]).unwrap();
        let parsed = arrow_core::criteria::parse_criteria(&raw);
        assert!(parsed.is_ok(), "valid {} rejected", c["name"]);
        if c["name"] == "with_minhash_600_ascii_text" {
            let p = parsed.unwrap();
            assert!(p.minhash.is_some());
            assert_eq!(p.text.chars().count(), 600);
        }
    }
    for c in f["invalid"].as_array().unwrap() {
        let raw = serde_json::to_vec(&c["criteria"]).unwrap();
        assert_eq!(
            arrow_core::criteria::parse_criteria(&raw).err(),
            Some(arrow_core::ArrowErr::Criteria),
            "invalid {} accepted",
            c["name"]
        );
    }
}
