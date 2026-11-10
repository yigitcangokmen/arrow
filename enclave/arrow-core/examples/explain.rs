//! Local review tool for the bench and the room report: names the gate that decided a dataset.
//! Runs on local plaintext only and never enters the wasm.
//!
//!   cargo run -p arrow-core --example explain -- --list-patterns
//!   cargo run -p arrow-core --example explain -- --data <file.csv|jsonl> --criteria <criteria.json> \
//!     --seed <64 hex> --llm '{"fit_llm":5,"verdict":"BUY","injection_seen":false,"criterion_exfil":false}'
//!
//! Output (stdout, one JSON line): {"fit_rule","novelty","injection":{"family","via"}|null,"exfil","score","idx"}

use arrow_core::compose::{compose, Gates};
use arrow_core::llm::LlmOut;
use arrow_core::schema::{state_index, Mode, Verdict};
use arrow_core::{consts, criteria, exfil, fit, inject, minhash, novelty, parse, sample, stats};
use serde_json::{json, Value};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn fail(msg: &str) -> ! {
    eprintln!("explain: {msg}");
    std::process::exit(2)
}

fn llm_out(v: &Value) -> LlmOut {
    let verdict = match v["verdict"].as_str() {
        Some("BUY") => Verdict::Buy,
        Some("PASS") => Verdict::Pass,
        _ => fail("--llm verdict must be BUY or PASS"),
    };
    let fit_llm = v["fit_llm"].as_u64().filter(|f| (1..=5).contains(f)).unwrap_or_else(|| fail("--llm fit_llm must be 1..5")) as u8;
    LlmOut {
        fit_llm,
        verdict,
        injection_seen: v["injection_seen"].as_bool().unwrap_or(false),
        criterion_exfil: v["criterion_exfil"].as_bool().unwrap_or(false),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--list-patterns") {
        for (family, re) in inject::patterns_debug() {
            println!("{family}\t{re}");
        }
        println!("exfil\t{}", exfil::pattern_debug());
        return;
    }
    let data_path = arg(&args, "--data").unwrap_or_else(|| fail("--data <file> is required"));
    let crit_path = arg(&args, "--criteria").unwrap_or_else(|| fail("--criteria <file> is required"));
    let seed_hex = arg(&args, "--seed").unwrap_or_else(|| "00".repeat(32));
    let llm_json = arg(&args, "--llm").unwrap_or_else(|| r#"{"fit_llm":5,"verdict":"BUY","injection_seen":false,"criterion_exfil":false}"#.into());
    let mode = arg(&args, "--mode").unwrap_or_else(|| "scored".into()).parse::<Mode>().unwrap_or_else(|_| fail("--mode scored|verdict"));

    let seed: [u8; 32] = hex::decode(seed_hex.trim()).ok().and_then(|b| b.try_into().ok()).unwrap_or_else(|| fail("--seed must be 64 hex"));
    let llm: Value = serde_json::from_str(&llm_json).unwrap_or_else(|_| fail("--llm is not JSON"));
    let data = std::fs::read(&data_path).unwrap_or_else(|_| fail("cannot read --data"));
    let crit_raw = std::fs::read(&crit_path).unwrap_or_else(|_| fail("cannot read --criteria"));
    let crit = criteria::parse_criteria(&crit_raw).unwrap_or_else(|e| fail(&format!("criteria rejected: {e:?}")));

    let (f, body) = parse::detect(&data).unwrap_or_else(|e| fail(&format!("data rejected: {e:?}")));
    let cols = parse::header(body, f).unwrap_or_else(|e| fail(&format!("header rejected: {e:?}")));
    let spec = criteria::stats_spec(&crit, &cols);
    let st = stats::compute(body, f, &spec).unwrap_or_else(|e| fail(&format!("stats failed: {e:?}")));
    let fit_rule = fit::fit_rule(&crit, &st);
    let counts = crit.minhash.as_ref().filter(|_| spec.key_col.is_some()).and_then(|sig| minhash::counts(&st.key_base_hashes, sig).ok());
    let nov = novelty::novelty(crit.minhash.is_some(), spec.key_col.is_some(), counts);
    let idx = sample::sample_indices(&seed, st.rows, consts::SAMPLE_ROWS);
    let rows = stats::collect_rows(body, f, &st.columns, &idx).unwrap_or_else(|e| fail(&format!("sample failed: {e:?}")));
    let hit = inject::scan_dataset(&st.columns, &rows).unwrap_or_else(|e| fail(&format!("scan failed: {e:?}")));
    let ex = exfil::scan_criteria(&crit).unwrap_or_else(|e| fail(&format!("exfil scan failed: {e:?}")));

    let g = Gates { fit_rule, novelty: nov, injection_regex: hit.is_some(), exfil_regex: ex, min_fit: crit.min_fit, min_novelty: crit.min_novelty };
    let s = compose(&g, &llm_out(&llm));
    let state = state_index(mode, &s).unwrap_or_else(|e| fail(&format!("state index failed: {e:?}")));
    let out = json!({
        "fit_rule": fit_rule,
        "novelty": nov,
        "injection": hit.map(|h| json!({"family": h.family.label(), "via": h.via.label()})),
        "exfil": ex,
        "score": {"verdict": if s.verdict == Verdict::Buy { "BUY" } else { "PASS" }, "fit": s.fit, "novelty": s.novelty},
        "idx": state,
    });
    println!("{out}");
}
