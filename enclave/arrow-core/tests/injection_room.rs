//! G5 against the real injection room (`bench/injection-room/`, WS6-T03). Every attack with
//! `regex_expected: true` must be flagged by `scan_dataset` on the 40-row seeded sample and end in
//! PASS·1·1 even when the LLM votes BUY, fit 5, no flags. `regex_expected: false` rows are counted,
//! never asserted. Counts come from attacks.json.
//!
//! `ARROW_WRITE_NATIVE_GATES=1` also writes `bench/results/native-gates.json` (read by the bench
//! room test) until the WS-6 `bench_tool gates` runner replaces it.

use arrow_core::compose::{compose, Gates};
use arrow_core::llm::LlmOut;
use arrow_core::schema::{Verdict, GUARD_SCORE};
use arrow_core::{consts, criteria, exfil, fit, inject, parse, sample, stats};
use serde_json::{json, Map, Value};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
const WORST_LLM: LlmOut = LlmOut { fit_llm: 5, verdict: Verdict::Buy, injection_seen: false, criterion_exfil: false };
const SEED: [u8; 32] = [0u8; 32];

struct Run {
    fit_rule: u8,
    hit: Option<inject::Hit>,
    verdict: Verdict,
    guard: bool,
}

fn read(rel: &str) -> Vec<u8> {
    std::fs::read(format!("{ROOT}{rel}")).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

/// The enclave's deterministic path, minus crypto and the LLM.
fn run(data_rel: &str, crit: &criteria::Criteria) -> Run {
    let data = read(data_rel);
    let (f, body) = parse::detect(&data).unwrap();
    let cols = parse::header(body, f).unwrap();
    let st = stats::compute(body, f, &criteria::stats_spec(crit, &cols)).unwrap();
    let fit_rule = fit::fit_rule(crit, &st);
    let idx = sample::sample_indices(&SEED, st.rows, consts::SAMPLE_ROWS);
    let rows = stats::collect_rows(body, f, &st.columns, &idx).unwrap();
    let hit = inject::scan_dataset(&st.columns, &rows).unwrap();
    let ex = exfil::scan_criteria(crit).unwrap();
    let g = Gates { fit_rule, novelty: None, injection_regex: hit.is_some(), exfil_regex: ex, min_fit: crit.min_fit, min_novelty: crit.min_novelty };
    let s = compose(&g, &WORST_LLM);
    Run { fit_rule, hit, verdict: s.verdict, guard: s == GUARD_SCORE }
}

fn room() -> (Value, criteria::Criteria) {
    let manifest: Value = serde_json::from_slice(&read("bench/injection-room/attacks.json")).unwrap();
    let crit = criteria::parse_criteria(&read("bench/injection-room/criteria.json")).unwrap();
    (manifest, crit)
}

fn entry(r: &Run, expected: Option<bool>) -> Value {
    json!({
        "hit": r.hit.is_some(),
        "regex_flag": r.hit.is_some(),
        "regex_expected": expected,
        "gate_name": r.hit.map(|h| h.family.label()),
        "via": r.hit.map(|h| h.via.label()),
        "fit_rule": r.fit_rule,
        "worst_case_verdict": if r.verdict == Verdict::Buy { "BUY" } else { "PASS" },
    })
}

#[test]
fn injection_room_all_flagged() {
    let (manifest, crit) = room();
    let attacks = manifest["attacks"].as_array().unwrap();
    assert_eq!(attacks.len(), 24);
    let (mut t, mut a, mut f, mut b) = (0, 0, 0, 0);
    let mut families = Vec::new();
    let mut missed = Vec::new();
    let mut cases = Map::new();
    for at in attacks {
        let id = at["id"].as_str().unwrap();
        let expected = at["regex_expected"].as_bool().unwrap();
        let r = run(at["dataset"].as_str().unwrap(), &crit);
        assert_eq!(r.fit_rule, 5, "{id}: room datasets must pass the structural gates");
        if expected {
            t += 1;
            if r.hit.is_some() && r.guard && r.verdict == Verdict::Pass {
                a += 1;
            } else {
                missed.push(id.to_owned());
            }
        } else {
            f += 1;
            if r.hit.is_some() {
                b += 1;
            }
        }
        if let Some(h) = r.hit {
            families.push(format!("{id}={}/{}", h.family.label(), h.via.label()));
        }
        cases.insert(id.to_owned(), entry(&r, Some(expected)));
    }
    println!("room: {a}/{t} regex_expected flagged, {b}/{f} bypass-by-design also flagged, families: {}", families.join(" "));
    assert!(missed.is_empty(), "regex_expected:true not flagged: {missed:?}");

    if std::env::var("ARROW_WRITE_NATIVE_GATES").as_deref() == Ok("1") {
        for c in manifest["controls"].as_array().unwrap() {
            let r = run(c["dataset"].as_str().unwrap(), &crit);
            cases.insert(c["id"].as_str().unwrap().to_owned(), entry(&r, Some(false)));
        }
        let out = json!({
            "v": 1,
            "generator": "cargo test -p arrow-core --test injection_room (ARROW_WRITE_NATIVE_GATES=1)",
            "note": "Deterministic layer only (scanner + structural gates, seed 00..00, 40-row sample, worst-case LLM BUY/5/no flags). Synthetic room data.",
            "summary": {"regex_expected_true": t, "flagged_true": a, "regex_expected_false": f, "flagged_false": b},
            "cases": cases,
        });
        let dir = format!("{ROOT}bench/results");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/native-gates.json"), serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
    }
}

#[test]
fn clean_control_not_flagged() {
    let (manifest, crit) = room();
    let controls = manifest["controls"].as_array().unwrap();
    assert_eq!(controls.len(), 2);
    for c in controls {
        let id = c["id"].as_str().unwrap();
        let r = run(c["dataset"].as_str().unwrap(), &crit);
        assert_eq!(r.fit_rule, 5, "{id}");
        assert_eq!(r.hit, None, "{id} flagged");
        // with no flag the LLM's BUY survives the gates (whether it should vote BUY is the LLM's job)
        assert_eq!(r.verdict, Verdict::Buy, "{id}");
    }
    // the whole clean control, every row, not only the sample
    let data = read("bench/injection-room/control-clean-buysell.csv");
    let (f, body) = parse::detect(&data).unwrap();
    let cols = parse::header(body, f).unwrap();
    let all: Vec<u32> = (0..200).collect();
    let rows = stats::collect_rows(body, f, &cols, &all).unwrap();
    assert_eq!(rows.len(), 200);
    assert_eq!(inject::scan_dataset(&cols, &rows).unwrap(), None);
}
