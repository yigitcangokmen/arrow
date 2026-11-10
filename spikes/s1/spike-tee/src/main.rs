//! S1-b spike program (OutLayer, wasm32-wasip2).
//!
//! Echoes the execution environment so the gate can check predecessor, signer,
//! block time vs wall clock (skew), secret access (PROTECTED_MASTER fingerprint)
//! and, in `echo+ai` mode, one NEAR AI call. Never writes to stderr; any error
//! prints `{"v":1,"ok":false}` and exits 0. Secret values never reach stdout.

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const NEARAI_URL: &str = "https://cloud-api.near.ai/v1/chat/completions";
const NEARAI_MODEL: &str = "Qwen/Qwen3.8-27B";

#[derive(Deserialize)]
struct Input {
    mode: String,
    #[serde(default)]
    sleep_s: u64,
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn fail() {
    print!("{}", r#"{"v":1,"ok":false}"#);
    let _ = io::stdout().flush();
}

/// One small NEAR AI call with the S1-a parameters. Returns (status, elapsed ms); status 0 on any error.
fn ai_call(key: &str) -> (u16, u128) {
    let body = json!({
        "model": NEARAI_MODEL,
        "messages": [
            {"role": "system", "content": "Answer only with the JSON object the schema asks for."},
            {"role": "user", "content": "Synthetic check: is this row useful? token=ABC,unlock_date=2026-12-01"}
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "arrow_verdict", "strict": true, "schema": {
            "type": "object", "additionalProperties": false, "required": ["fit_llm", "verdict"],
            "properties": {"fit_llm": {"type": "integer", "minimum": 1, "maximum": 5},
                           "verdict": {"type": "string", "enum": ["BUY", "PASS"]}}}}},
        "temperature": 0,
        "max_tokens": 64,
        "chat_template_kwargs": {"enable_thinking": false}
    });
    let started = Instant::now();
    let bytes = match serde_json::to_vec(&body) {
        Ok(b) => b,
        Err(_) => return (0, 0),
    };
    let res = wasi_http_client::Client::new()
        .post(NEARAI_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {key}").as_str())
        .connect_timeout(Duration::from_secs(10))
        .body(&bytes)
        .send();
    let elapsed = started.elapsed().as_millis();
    match res {
        Ok(r) => {
            let status = r.status();
            let _ = r.body(); // drain; content is not echoed
            (status, elapsed)
        }
        Err(_) => (0, elapsed),
    }
}

fn run(raw: &[u8]) -> Option<Value> {
    let input: Input = serde_json::from_slice(raw).ok()?;
    match input.mode.as_str() {
        "echo" | "echo+ai" | "sleep" => {}
        _ => return None,
    }
    if input.mode == "sleep" {
        std::thread::sleep(Duration::from_secs(input.sleep_s.min(300)));
    }

    let bts = env("NEAR_BLOCK_TIMESTAMP");
    let wall_ns = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_nanos();
    let skew_ms: Value = match bts.parse::<u128>() {
        Ok(b) => json!((wall_ns as i128 - b as i128) / 1_000_000),
        Err(_) => Value::Null,
    };
    let pm: Value = match std::env::var("PROTECTED_MASTER") {
        Ok(v) if !v.is_empty() => json!(&sha256_hex(v.as_bytes())[..8]),
        _ => Value::Null,
    };
    let key = env("NEARAI_API_KEY");
    let (ai_status, ai_ms): (Value, Value) = if input.mode == "echo+ai" {
        let (s, ms) = if key.is_empty() { (0, 0) } else { ai_call(&key) };
        (json!(s), json!(ms as u64))
    } else {
        (Value::Null, Value::Null)
    };

    Some(json!({
        "v": 1, "ok": true,
        "t": env("OUTLAYER_EXECUTION_TYPE"),
        "net": env("NEAR_NETWORK_ID"),
        "pred": env("NEAR_PREDECESSOR_ID"),
        "sender": env("NEAR_SENDER_ID"),
        "bts": bts,
        "bh": env("NEAR_BLOCK_HEIGHT"),
        "tx": env("NEAR_TRANSACTION_HASH"),
        "rid": env("NEAR_REQUEST_ID"),
        "wall": wall_ns.to_string(),
        "skew_ms": skew_ms,
        "pm": pm,
        "ai_key": !key.is_empty(),
        "ai_ms": ai_ms,
        "ai_status": ai_status,
        "in_sha": sha256_hex(raw),
    }))
}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let mut raw = Vec::new();
    if io::stdin().read_to_end(&mut raw).is_err() {
        return fail();
    }
    match run(&raw).and_then(|v| serde_json::to_string(&v).ok()) {
        Some(s) if s.len() <= 900 => {
            print!("{s}");
            let _ = io::stdout().flush();
        }
        _ => fail(),
    }
}
