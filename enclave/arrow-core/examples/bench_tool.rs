//! Native bench helper (WS6-T05). Not enclave code: it may print to stderr and use unwrap-free but panic-tolerant
//! plain Rust. It only calls arrow-core's public API and changes nothing in `src/`.
//!
//!   cargo run -q -p arrow-core --example bench_tool -- gates --data <file> [--criteria <file>] [--id <name>]
//!   cargo run -q -p arrow-core --example bench_tool -- sample --data <file> --seed <u64>
//!   cargo run -q -p arrow-core --example bench_tool -- llm-request --data <file> [--criteria <file>] --seed <u64> [--model <name>]
//!
//! `gates` prints the deterministic numbers (rows, nulls, dates, fit_rule, novelty band when the criteria carry a
//! MinHash). `regex_flag` is null until the G5 scanner (WS3-T06, `arrow_core::inject`) is part of this tree.
//! `llm-request` prints the exact request body the enclave would send for the seeded sample, which is what the
//! LLM-only baseline posts to NEAR AI.

use std::collections::HashMap;
use std::process::ExitCode;

use arrow_core::criteria::{parse_criteria, stats_spec, Criteria};
use arrow_core::fit::fit_rule;
use arrow_core::llm::{request_body, Reasoning};
use arrow_core::minhash::counts;
use arrow_core::novelty::novelty;
use arrow_core::parse::{detect, header};
use arrow_core::prompt::{spotlight_token, user_message, SYSTEM};
use arrow_core::sample::sample_indices;
use arrow_core::stats::{collect_rows, compute, Stats};
use sha2::{Digest, Sha256};

fn flags(args: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if let Some(name) = a.strip_prefix("--") {
            if let Some(v) = it.next() {
                m.insert(name.to_string(), v.clone());
            }
        }
    }
    m
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

/// A bench wrapper file ({"id","suite",...,"criteria":{...}}) or a bare criteria file; only the criteria object is parsed.
fn criteria_bytes(raw: &[u8]) -> Result<Vec<u8>, String> {
    let v: serde_json::Value = serde_json::from_slice(raw).map_err(|e| format!("criteria json: {e}"))?;
    let inner = if v.get("suite").is_some() { v.get("criteria").cloned().ok_or("wrapper without criteria")? } else { v };
    serde_json::to_vec(&inner).map_err(|e| e.to_string())
}

fn empty_criteria() -> Result<Criteria, String> {
    parse_criteria(br#"{"v":1,"text":""}"#).map_err(|e| format!("{e:?}"))
}

struct Loaded {
    criteria: Criteria,
    has_criteria: bool,
    stats: Stats,
    format: arrow_core::parse::Format,
    plain: Vec<u8>,
}

fn load(f: &HashMap<String, String>) -> Result<Loaded, String> {
    let data = f.get("data").ok_or("--data is required")?;
    let plain = read(data)?;
    let (format, body) = detect(&plain).map_err(|e| format!("{e:?}"))?;
    let (criteria, has_criteria) = match f.get("criteria") {
        Some(p) => (parse_criteria(&criteria_bytes(&read(p)?)?).map_err(|e| format!("criteria: {e:?}"))?, true),
        None => (empty_criteria()?, false),
    };
    let cols = header(body, format).map_err(|e| format!("{e:?}"))?;
    let stats = compute(body, format, &stats_spec(&criteria, &cols)).map_err(|e| format!("{e:?}"))?;
    Ok(Loaded { criteria, has_criteria, stats, format, plain })
}

fn seed32(seed: &str) -> [u8; 32] {
    Sha256::digest(seed.as_bytes()).into()
}

fn date(d: Option<(u16, u8, u8)>) -> serde_json::Value {
    d.map_or(serde_json::Value::Null, |(y, m, dd)| serde_json::Value::String(format!("{y:04}-{m:02}-{dd:02}")))
}

fn gates(f: &HashMap<String, String>) -> Result<serde_json::Value, String> {
    let l = load(f)?;
    let band = match &l.criteria.minhash {
        Some(sig) => {
            let c = counts(&l.stats.key_base_hashes, sig).map_err(|e| format!("{e:?}"))?;
            novelty(true, !l.stats.key_base_hashes.is_empty(), Some(c)).map_or(serde_json::Value::Null, |b| b.into())
        }
        None => serde_json::Value::Null,
    };
    let id = f.get("id").cloned().unwrap_or_else(|| f.get("data").cloned().unwrap_or_default());
    Ok(serde_json::json!({
        "dataset": id,
        "regex_flag": null,
        "gate_name": null,
        "flagged_cells": null,
        "fit_rule": fit_rule(&l.criteria, &l.stats),
        "novelty_band": band,
        "has_criteria": l.has_criteria,
        "rows": l.stats.rows,
        "columns": l.stats.columns,
        "nulls": l.stats.nulls,
        "dup_rows": l.stats.dup_rows,
        "date_min": date(l.stats.date_min),
        "date_max": date(l.stats.date_max),
    }))
}

fn sampled(l: &Loaded, seed: &[u8; 32]) -> Result<Vec<Vec<String>>, String> {
    let idx = sample_indices(seed, l.stats.rows, arrow_core::consts::SAMPLE_ROWS);
    let (_, body) = detect(&l.plain).map_err(|e| format!("{e:?}"))?;
    collect_rows(body, l.format, &l.stats.columns, &idx).map_err(|e| format!("{e:?}"))
}

fn sample(f: &HashMap<String, String>) -> Result<serde_json::Value, String> {
    let l = load(f)?;
    let seed = seed32(f.get("seed").ok_or("--seed is required")?);
    let idx = sample_indices(&seed, l.stats.rows, arrow_core::consts::SAMPLE_ROWS);
    Ok(serde_json::json!({ "rows_total": l.stats.rows, "indices": idx, "rows": sampled(&l, &seed)? }))
}

fn llm_request(f: &HashMap<String, String>) -> Result<serde_json::Value, String> {
    let l = load(f)?;
    let seed = seed32(f.get("seed").ok_or("--seed is required")?);
    let rows = sampled(&l, &seed)?;
    let model = f.get("model").map_or("Qwen/Qwen3.8-27B", String::as_str);
    let token = spotlight_token(&seed);
    let user = user_message(&token, &l.criteria.text, &l.stats, &rows, Reasoning::QwenNoThinking).map_err(|e| format!("{e:?}"))?;
    let body = request_body(model, Reasoning::QwenNoThinking, SYSTEM, &user).map_err(|e| format!("{e:?}"))?;
    Ok(serde_json::json!({ "model": model, "seed_label": f.get("seed"), "body": String::from_utf8(body).map_err(|e| e.to_string())? }))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((cmd, rest)) = args.split_first() else {
        eprintln!("usage: bench_tool gates|sample|llm-request --data <file> ...");
        return ExitCode::from(2);
    };
    let f = flags(rest);
    let out = match cmd.as_str() {
        "gates" => gates(&f),
        "sample" => sample(&f),
        "llm-request" => llm_request(&f),
        other => Err(format!("unknown command {other}")),
    };
    match out {
        Ok(v) => {
            println!("{v}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("bench_tool: {e}");
            ExitCode::from(1)
        }
    }
}
