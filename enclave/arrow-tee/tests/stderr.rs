//! no_stderr_on_any_error (WS3-T10, DEC I-01): every malformed input, wrong environment, bad blob
//! and bad LLM answer gives exactly `{"v":1,"ok":false}` on stdout, 0 bytes on stderr and exit 0,
//! run through wasmtime against the release wasm and the dev-endpoints wasm.
//!
//! Needs WASM_REL, WASM_DEV, FAKE_URL and FAKE_BLOB_DIR; `bash scripts/dev/stderr-harness.sh` sets
//! them up. ARROW_ONLY=<case> runs one case. Inputs are built at run time from a test master; no
//! key, plaintext K or data is printed.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ERR: &[u8] = br#"{"v":1,"ok":false}"#;
const THREADS: usize = 8;
const T_PAD: Duration = Duration::from_secs(45);
const CRIT: &str = r#"{"v":1,"required_columns":["trade_id","date","side","price"],"min_rows":40,"text":"NEAR trade prints","min_fit":4,"min_novelty":3}"#;
const SELLER: &str = "seller.arrowhq.testnet";
const LISTING_ID: u64 = 7;

#[derive(Clone, Copy, PartialEq)]
enum Wasm {
    Rel,
    Dev,
}

#[derive(Clone)]
enum Expect {
    Err,
    /// Err, and the run ends inside [lo, hi) seconds (timeouts measured with the pad off).
    ErrWithin(u64, u64),
    Derive(String),
    /// ok:true, `r` opens to this state index, `h` equals this hash; optionally at least T_PAD.
    Eval { idx: u8, h: String, padded: bool },
    Release { k: [u8; 32], h: String },
    /// dev `__panic`: trap, empty stdout, the canary never reaches stderr.
    Panic,
}

struct Case {
    name: &'static str,
    wasm: Wasm,
    stdin: Vec<u8>,
    env: Vec<(String, String)>,
    /// Age of the block when the run starts; None leaves NEAR_BLOCK_TIMESTAMP out.
    block_age_s: Option<u64>,
    expect: Expect,
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

fn label_sk(label: &str) -> k256::SecretKey {
    k256::SecretKey::from_slice(&sha(label.as_bytes())).unwrap()
}

fn pk65(sk: &k256::SecretKey) -> [u8; 65] {
    sk.public_key().to_encoded_point(false).as_bytes().try_into().unwrap()
}

fn seal(pk: &[u8; 65], pt: &[u8]) -> String {
    STANDARD.encode(ecies::encrypt(pk, pt).unwrap())
}

fn open(sk: &k256::SecretKey, b64: &str) -> Vec<u8> {
    ecies::decrypt(&sk.to_bytes(), &STANDARD.decode(b64).unwrap()).unwrap()
}

/// sealed_k plaintext: K ‖ blob_sha256 ‖ sha256(seller).
fn k_payload(k: &[u8; 32], blob_sha: &[u8; 32], seller: &str) -> Vec<u8> {
    [k.as_slice(), blob_sha.as_slice(), &sha(seller.as_bytes())].concat()
}

/// sealed_criteria plaintext: sha256(buyer_pk ‖ listing_id BE) ‖ criteria JSON.
fn crit_payload(buyer: &k256::SecretKey, listing_id: u64, crit: &[u8]) -> Vec<u8> {
    let bind = sha(&[pk65(buyer).as_slice(), &listing_id.to_be_bytes()].concat());
    [bind.as_slice(), crit].concat()
}

fn xchacha_blob(k: &[u8; 32], label: &str, plain: &[u8]) -> Vec<u8> {
    let nonce: [u8; 24] = sha(label.as_bytes())[..24].try_into().unwrap();
    let mut blob = nonce.to_vec();
    blob.extend(XChaCha20Poly1305::new(&(*k).into()).encrypt(&XNonce::from(nonce), plain).unwrap());
    blob
}

/// 60 rows; memo + note fill the 40-row prompt to well over 4096 bytes (cells stay ≤200 chars).
fn csv(cols_extra: usize, ragged: bool, memo: &str) -> Vec<u8> {
    let extra: String = (0..cols_extra).map(|i| format!(",x{i}")).collect();
    let mut s = format!("trade_id,date,side,price,memo,note{extra}\n");
    let fill = "routine fill at venue alpha with settlement on the next business day ".repeat(3);
    for i in 0..60 {
        let tail = if ragged && i == 30 { String::new() } else { ",0".repeat(cols_extra) };
        s.push_str(&format!(
            "T{i},2026-10-{:02},{},{}.5,{memo} {},{}{tail}\n",
            1 + i % 28,
            if i % 2 == 0 { "BUY" } else { "SELL" },
            3 + i % 5,
            &fill[..170],
            &fill[..150]
        ));
    }
    s.into_bytes()
}

struct Fx {
    blob_dir: String,
    fake: String,
    master: String,
    ppk: [u8; 65],
    buyer: k256::SecretKey,
    k: [u8; 32],
}

impl Fx {
    fn put_blob(&self, name: &str, blob: &[u8]) -> String {
        std::fs::write(format!("{}/{name}.bin", self.blob_dir), blob).unwrap();
        format!("{}/blob/{name}", self.fake)
    }

    fn env(&self, wasm: Wasm, llm_mode: &str) -> Vec<(String, String)> {
        let mut e = vec![
            ("OUTLAYER_EXECUTION_TYPE", "NEAR".to_owned()),
            ("NEAR_NETWORK_ID", "testnet".to_owned()),
            ("NEAR_PREDECESSOR_ID", "arrow.arrowhq.testnet".to_owned()),
            ("PROTECTED_MASTER", self.master.clone()),
            ("NEARAI_API_KEY", format!("mode:{llm_mode}")),
        ];
        if wasm == Wasm::Dev {
            e.push(("ARROW_DEV_NEARAI_URL", format!("{}/v1/chat/completions", self.fake)));
        }
        e.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
    }

    /// A valid eval input for `plain` (served from the fake host), plus its blob hash.
    fn eval_input(&self, name: &str, plain: &[u8], crit: &str) -> (Value, String) {
        let blob = xchacha_blob(&self.k, name, plain);
        let h = hex::encode(sha(&blob));
        let url = self.put_blob(name, &blob);
        let sealed_k = seal(&self.ppk, &k_payload(&self.k, &sha(&blob), SELLER));
        let input = json!({
            "v": 1, "action": "eval",
            "listing": {"id": LISTING_ID, "seller": SELLER, "blob_url": url, "blob_sha256": h, "sealed_k": sealed_k, "mode": "scored", "columns": []},
            "eval": {"id": 42, "sealed_criteria": self.seal_crit(crit.as_bytes()), "buyer_pk": hex::encode(pk65(&self.buyer)), "seed": "11".repeat(32)},
        });
        (input, h)
    }

    fn seal_crit(&self, crit: &[u8]) -> String {
        seal(&self.ppk, &crit_payload(&self.buyer, LISTING_ID, crit))
    }
}

fn var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set; run: bash scripts/dev/stderr-harness.sh"))
}

fn cases(fx: &Fx) -> (Vec<Case>, Vec<Case>) {
    let ok_plain = csv(0, false, "routine");
    let (base, h) = fx.eval_input("base", &ok_plain, CRIT);
    let mut errs: Vec<Case> = Vec::new();
    let mut add = |name, wasm, stdin: Vec<u8>, env: Vec<(String, String)>, age: Option<u64>, expect: Expect| {
        errs.push(Case { name, wasm, stdin, env, block_age_s: age, expect });
    };
    let rel = || fx.env(Wasm::Rel, "ok_buy");
    let dev = |m: &str| fx.env(Wasm::Dev, m);
    let with = |mut e: Vec<(String, String)>, k: &str, v: Option<&str>| {
        e.retain(|(n, _)| n != k);
        if let Some(v) = v {
            e.push((k.to_owned(), v.to_owned()));
        }
        e
    };
    let mutate = |path: &[&str], v: Value| {
        let mut i = base.clone();
        let mut p = &mut i;
        for s in &path[..path.len() - 1] {
            p = &mut p[*s];
        }
        p[path[path.len() - 1]] = v;
        i.to_string().into_bytes()
    };
    let b = base.to_string().into_bytes();
    let release = |listing: &Value| {
        json!({"v":1,"action":"release","listing":listing,"release":{"id":3,"buyer_pk":hex::encode(pk65(&fx.buyer))}}).to_string().into_bytes()
    };
    let e = Expect::Err;

    // 1-6: stdin shape
    add("empty_stdin", Wasm::Rel, vec![], rel(), Some(1), e.clone());
    add("not_json", Wasm::Rel, b"hello {".to_vec(), rel(), Some(1), e.clone());
    add("json_array", Wasm::Rel, b"[1,2,3]".to_vec(), rel(), Some(1), e.clone());
    add("v2", Wasm::Rel, mutate(&["v"], json!(2)), rel(), Some(1), e.clone());
    add("unknown_action", Wasm::Rel, mutate(&["action"], json!("steal")), rel(), Some(1), e.clone());
    let mut big = b.clone();
    big.resize(32 * 1024 + 1, b' ');
    add("stdin_32k_plus_1", Wasm::Rel, big, rel(), Some(1), e.clone());
    // 7-14: environment and secret
    add("no_predecessor", Wasm::Rel, b.clone(), with(rel(), "NEAR_PREDECESSOR_ID", None), Some(1), e.clone());
    add("attacker_predecessor", Wasm::Rel, b.clone(), with(rel(), "NEAR_PREDECESSOR_ID", Some("attacker.arrowhq.testnet")), Some(1), e.clone());
    add("https_mode", Wasm::Rel, b.clone(), with(rel(), "OUTLAYER_EXECUTION_TYPE", Some("HTTPS")), Some(1), e.clone());
    add("betanet", Wasm::Rel, b.clone(), with(rel(), "NEAR_NETWORK_ID", Some("betanet")), Some(1), e.clone());
    add("mainnet_with_testnet_predecessor", Wasm::Rel, b.clone(), with(rel(), "NEAR_NETWORK_ID", Some("mainnet")), Some(1), e.clone());
    add("no_master", Wasm::Rel, b.clone(), with(rel(), "PROTECTED_MASTER", None), Some(1), e.clone());
    add("master_not_hex", Wasm::Rel, b.clone(), with(rel(), "PROTECTED_MASTER", Some(&"zz".repeat(32))), Some(1), e.clone());
    add("master_8_bytes", Wasm::Rel, b.clone(), with(rel(), "PROTECTED_MASTER", Some(&"ab".repeat(8))), Some(1), e.clone());
    // 15-24: sealed values, keys, seed, criteria
    add("sealed_k_not_b64", Wasm::Rel, mutate(&["listing", "sealed_k"], json!("@@not base64@@")), rel(), Some(1), e.clone());
    let other_pk = pk65(&label_sk("arrow:test:other-program:v1"));
    let blob_sha = sha(&xchacha_blob(&fx.k, "base", &ok_plain));
    add("sealed_k_other_pk", Wasm::Rel, mutate(&["listing", "sealed_k"], json!(seal(&other_pk, &k_payload(&fx.k, &blob_sha, SELLER)))), rel(), Some(1), e.clone());
    add("sealed_k_63_bytes", Wasm::Rel, mutate(&["listing", "sealed_k"], json!(seal(&fx.ppk, &[7u8; 63]))), rel(), Some(1), e.clone());
    add("bind_hash_mismatch", Wasm::Rel, mutate(&["listing", "sealed_k"], json!(seal(&fx.ppk, &k_payload(&fx.k, &[9u8; 32], SELLER)))), rel(), Some(1), e.clone());
    // ENC-1: a clone carries the original sealed_k under another seller; the old 64-byte form is refused too
    add("clone_other_seller", Wasm::Rel, mutate(&["listing", "seller"], json!("attacker.testnet")), rel(), Some(1), e.clone());
    add("release_clone_other_seller", Wasm::Dev, release(&{ let mut l = base["listing"].clone(); l["seller"] = json!("attacker.testnet"); l }), dev("ok_buy"), Some(1), e.clone());
    add("sealed_k_64_unbound", Wasm::Rel, mutate(&["listing", "sealed_k"], json!(seal(&fx.ppk, &[fx.k.as_slice(), &blob_sha].concat()))), rel(), Some(1), e.clone());
    // ENC-2: the criteria ciphertext replayed under another buyer key or on another listing
    let attacker = label_sk("arrow:test:attacker:v1");
    add("criteria_other_buyer_pk", Wasm::Rel, mutate(&["eval", "buyer_pk"], json!(hex::encode(pk65(&attacker)))), rel(), Some(1), e.clone());
    add("criteria_other_listing", Wasm::Rel, mutate(&["listing", "id"], json!(LISTING_ID + 1)), rel(), Some(1), e.clone());
    add("criteria_unbound", Wasm::Rel, mutate(&["eval", "sealed_criteria"], json!(seal(&fx.ppk, CRIT.as_bytes()))), rel(), Some(1), e.clone());
    add("buyer_pk_128_hex", Wasm::Rel, mutate(&["eval", "buyer_pk"], json!(hex::encode(pk65(&fx.buyer))[..128].to_owned())), rel(), Some(1), e.clone());
    let mut off = pk65(&fx.buyer);
    off[64] ^= 1;
    add("buyer_pk_off_curve", Wasm::Rel, mutate(&["eval", "buyer_pk"], json!(hex::encode(off))), rel(), Some(1), e.clone());
    let compressed = hex::encode(fx.buyer.public_key().to_encoded_point(true).as_bytes());
    add("buyer_pk_compressed", Wasm::Rel, mutate(&["eval", "buyer_pk"], json!(compressed)), rel(), Some(1), e.clone());
    add("seed_63_hex", Wasm::Rel, mutate(&["eval", "seed"], json!("1".repeat(63))), rel(), Some(1), e.clone());
    add("criteria_garbage", Wasm::Rel, mutate(&["eval", "sealed_criteria"], json!(fx.seal_crit(b"\xff\x00garbage"))), rel(), Some(1), e.clone());
    let crit127 = format!(r#"{{"v":1,"text":"x","key_column":"trade_id","minhash":"{}"}}"#, "0".repeat(127 * 16));
    add("criteria_127_minhash", Wasm::Rel, mutate(&["eval", "sealed_criteria"], json!(fx.seal_crit(crit127.as_bytes()))), rel(), Some(1), e.clone());
    // 25-28: time guard and URL scheme
    add("no_block_timestamp", Wasm::Rel, b.clone(), rel(), None, e.clone());
    add("eval_late_100s", Wasm::Rel, b.clone(), rel(), Some(100), Expect::ErrWithin(0, 10));
    add("release_late_70s", Wasm::Rel, release(&base["listing"]), rel(), Some(70), e.clone());
    // ARW-C3: RELEASE_DEADLINE is 45 s; the dev wasm can fetch the fake host, so only the guard refuses
    add("release_late_50s_dev", Wasm::Dev, release(&base["listing"]), dev("ok_buy"), Some(50), e.clone());
    // The base blob URL is the fake host's http URL, which wasmtime -S http would fetch: the
    // release wasm has to refuse it itself.
    add("rel_rejects_http_blob_url", Wasm::Rel, b.clone(), rel(), Some(1), e.clone());
    // 29-35: blob and data (dev wasm, fake host)
    let url_of = |p: &str| json!(format!("{}{p}", fx.fake));
    add("blob_404_err", Wasm::Dev, mutate(&["listing", "blob_url"], url_of("/blob-404")), dev("ok_buy"), Some(1), e.clone());
    add("blob_over_5mib_rejected", Wasm::Dev, mutate(&["listing", "blob_url"], url_of("/blob-huge")), dev("ok_buy"), Some(1), e.clone());
    let other_blob = xchacha_blob(&fx.k, "other", &csv(0, false, "different"));
    let other_h = hex::encode(sha(&other_blob));
    let other_url = fx.put_blob("other", &other_blob);
    add("blob_sha_mismatch", Wasm::Dev, mutate(&["listing", "blob_url"], json!(other_url)), dev("ok_buy"), Some(1), e.clone());
    let wrong_k_blob = xchacha_blob(&[3u8; 32], "wrongk", &ok_plain);
    let wk_url = fx.put_blob("wrongk", &wrong_k_blob);
    let mut wk = base.clone();
    wk["listing"]["blob_url"] = json!(wk_url);
    wk["listing"]["blob_sha256"] = json!(hex::encode(sha(&wrong_k_blob)));
    wk["listing"]["sealed_k"] = json!(seal(&fx.ppk, &k_payload(&fx.k, &sha(&wrong_k_blob), SELLER)));
    add("right_hash_wrong_k", Wasm::Dev, wk.to_string().into_bytes(), dev("ok_buy"), Some(1), e.clone());
    // ENC-A1: release never hands back a K that does not open the blob it downloaded
    add("release_right_hash_wrong_k", Wasm::Dev, release(&wk["listing"]), dev("ok_buy"), Some(1), e.clone());
    let binary: Vec<u8> = (0..4000u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect();
    add("decrypted_binary_garbage", Wasm::Dev, fx.eval_input("binary", &binary, CRIT).0.to_string().into_bytes(), dev("ok_buy"), Some(1), e.clone());
    add("csv_65_columns", Wasm::Dev, fx.eval_input("wide", &csv(59, false, "routine"), CRIT).0.to_string().into_bytes(), dev("ok_buy"), Some(1), e.clone());
    add("csv_ragged", Wasm::Dev, fx.eval_input("ragged", &csv(1, true, "routine"), CRIT).0.to_string().into_bytes(), dev("ok_buy"), Some(1), e.clone());
    // 36-42: LLM answers
    for (name, m) in [
        ("llm_http500", "http500"),
        ("llm_bad_schema", "bad_schema"),
        ("llm_wrong_model", "wrong_model"),
        ("llm_not_json", "not_json"),
        ("llm_length_finish", "length_finish"),
        ("llm_huge_body", "huge_body"),
        ("llm_extra_field", "extra_field"),
        ("llm_two_choices", "two_choices"),
        ("llm_fenced", "fenced"),
    ] {
        add(name, Wasm::Dev, b.clone(), dev(m), Some(1), e.clone());
    }
    // Timeouts: pad off so the run time shows where the call was cut (chat 35 s; blob 15 s first
    // byte, 25 s total).
    add("llm_slow_times_out_under_40s", Wasm::Dev, b.clone(), with(dev("slow"), "ARROW_DEV_TPAD_MS", Some("0")), Some(1), Expect::ErrWithin(34, 40));
    add("blob_slow_times_out", Wasm::Dev, mutate(&["listing", "blob_url"], url_of("/blob-slow")), with(dev("ok_buy"), "ARROW_DEV_TPAD_MS", Some("0")), Some(1), Expect::ErrWithin(14, 26));
    add("blob_redirect_err", Wasm::Dev, mutate(&["listing", "blob_url"], url_of("/blob-redirect")), dev("ok_buy"), Some(1), e.clone());

    // Positives (not counted in N/N). BUY · fit 5 · novelty 3 (no signature) = 25 + 4·5 + 2.
    let ppk_hex = hex::encode(fx.ppk);
    let pos = vec![
        Case { name: "P1_rel_derive", wasm: Wasm::Rel, stdin: br#"{"v":1,"action":"derive"}"#.to_vec(), env: rel(), block_age_s: Some(1), expect: Expect::Derive(ppk_hex) },
        Case { name: "post_body_over_4096_ok", wasm: Wasm::Dev, stdin: b.clone(), env: with(dev("ok_buy"), "ARROW_DEV_TPAD_MS", Some("0")), block_age_s: Some(1), expect: Expect::Eval { idx: 47, h: h.clone(), padded: false } },
        Case { name: "P3_ok_inject_idx0", wasm: Wasm::Dev, stdin: b.clone(), env: with(dev("ok_inject"), "ARROW_DEV_TPAD_MS", Some("0")), block_age_s: Some(1), expect: Expect::Eval { idx: 0, h: h.clone(), padded: false } },
        // release downloads the blob now; the fake host is http, which only the dev wasm accepts
        Case { name: "P4_dev_release", wasm: Wasm::Dev, stdin: release(&base["listing"]), env: dev("ok_buy"), block_age_s: Some(1), expect: Expect::Release { k: fx.k, h: h.clone() } },
        // ARW-C1: a swapped blob gives h = its own hash and a zero key (the contract refunds hash_mismatch)
        Case { name: "P7_dev_release_swapped_blob", wasm: Wasm::Dev, stdin: release(&{ let mut l = base["listing"].clone(); l["blob_url"] = json!(other_url.clone()); l }), env: dev("ok_buy"), block_age_s: Some(1), expect: Expect::Release { k: [0u8; 32], h: other_h.clone() } },
        Case { name: "P5_dev_panic_canary", wasm: Wasm::Dev, stdin: br#"{"action":"__panic"}"#.to_vec(), env: dev("ok_buy"), block_age_s: Some(1), expect: Expect::Panic },
        Case { name: "P6_dev_eval_padded_45s", wasm: Wasm::Dev, stdin: b, env: dev("ok_buy"), block_age_s: Some(1), expect: Expect::Eval { idx: 47, h, padded: true } },
    ];
    (errs, pos)
}

struct Run {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    ok_exit: bool,
    took: Duration,
}

fn run(c: &Case, rel: &str, dev: &str) -> Run {
    let wasm = if c.wasm == Wasm::Rel { rel } else { dev };
    let mut cmd = Command::new("wasmtime");
    cmd.args(["run", "-S", "http"]);
    for (k, v) in &c.env {
        cmd.arg("--env").arg(format!("{k}={v}"));
    }
    if let Some(age) = c.block_age_s {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        cmd.arg("--env").arg(format!("NEAR_BLOCK_TIMESTAMP={}", now - u128::from(age) * 1_000_000_000));
    }
    cmd.arg(wasm).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let t = Instant::now();
    let mut child = cmd.spawn().expect("wasmtime not on PATH");
    let mut sin = child.stdin.take().unwrap();
    let input = c.stdin.clone();
    let writer = std::thread::spawn(move || {
        let _ = sin.write_all(&input);
    });
    let out = child.wait_with_output().unwrap();
    let _ = writer.join();
    Run { stdout: out.stdout, stderr: out.stderr, ok_exit: out.status.success(), took: t.elapsed() }
}

fn check(c: &Case, r: &Run, fx: &Fx) -> Result<(), String> {
    if c.expect.is_panic() {
        if !r.stdout.is_empty() || r.ok_exit {
            return Err(format!("expected a trap with empty stdout, got exit ok={} stdout {} B", r.ok_exit, r.stdout.len()));
        }
        if String::from_utf8_lossy(&r.stderr).contains("ARROW_PANIC_CANARY") {
            return Err("the panic message reached stderr".into());
        }
        return Ok(());
    }
    if !r.stderr.is_empty() {
        // Only test inputs exist here, so showing the start of stderr leaks nothing real.
        return Err(format!("stderr has {} bytes: {:?}", r.stderr.len(), String::from_utf8_lossy(r.stderr.get(..200).unwrap_or(&r.stderr))));
    }
    if !r.ok_exit {
        return Err("exit code is not 0".into());
    }
    let v: Value = match &c.expect {
        Expect::Err | Expect::ErrWithin(..) => {
            if r.stdout != ERR {
                return Err(format!("stdout is not the fixed error: {} B, ok:true={}", r.stdout.len(), r.stdout.starts_with(br#"{"v":1,"ok":true"#)));
            }
            if let Expect::ErrWithin(lo, hi) = c.expect {
                let s = r.took.as_secs_f64();
                if s < lo as f64 || s >= hi as f64 {
                    return Err(format!("took {s:.1} s, expected [{lo}, {hi})"));
                }
            }
            return Ok(());
        }
        _ => serde_json::from_slice(&r.stdout).map_err(|_| format!("stdout is not JSON ({} B)", r.stdout.len()))?,
    };
    if v["ok"] != true {
        return Err("ok is not true".into());
    }
    match &c.expect {
        Expect::Derive(pk) => (v["pk"] == pk.as_str() && r.stdout.len() == 155).then_some(()).ok_or("wrong pk or size".into()),
        Expect::Eval { idx, h, padded } => {
            let got = open(&fx.buyer, v["r"].as_str().unwrap_or_default());
            if got != [*idx] || v["h"] != h.as_str() || r.stdout.len() != 227 {
                return Err(format!("wrong state ({got:?} vs [{idx}]), h or size"));
            }
            if *padded && r.took < T_PAD {
                return Err(format!("took {:.1} s < 45 s pad", r.took.as_secs_f64()));
            }
            Ok(())
        }
        Expect::Release { k, h } => {
            let got = open(&fx.buyer, v["k"].as_str().unwrap_or_default());
            (got == k.as_slice() && v["h"] == h.as_str() && r.stdout.len() == 267).then_some(()).ok_or("wrong k, h or size".into())
        }
        _ => Err("unreachable expectation".into()),
    }
}

impl Expect {
    fn is_panic(&self) -> bool {
        matches!(self, Expect::Panic)
    }
}

/// (case name, is a positive control, result)
type Outcome = (&'static str, bool, Result<(), String>);

#[test]
fn no_stderr_on_any_error() {
    let (rel, dev, fake, blob_dir) = (var("WASM_REL"), var("WASM_DEV"), var("FAKE_URL"), var("FAKE_BLOB_DIR"));
    let master = hex::encode(sha(b"arrow/test/master/v1"));
    let mut okm = [0u8; 32];
    Hkdf::<Sha256>::new(None, &hex::decode(&master).unwrap()).expand(b"arrow/program/v1", &mut okm).unwrap();
    let ppk = pk65(&k256::SecretKey::from_slice(&okm).unwrap());
    let fx = Fx { blob_dir, fake, master, ppk, buyer: label_sk("arrow:test:buyer:v1"), k: sha(b"arrow/test/k/v1") };

    let (errs, pos) = cases(&fx);
    assert!(errs.len() >= 30, "the card asks for at least 30 error cases");
    let only = std::env::var("ARROW_ONLY").ok().filter(|o| !o.is_empty());
    let all: Vec<(&Case, bool)> = errs.iter().map(|c| (c, false)).chain(pos.iter().map(|c| (c, true))).filter(|(c, _)| only.as_deref().is_none_or(|o| o == c.name)).collect();
    assert!(!all.is_empty(), "no case named {only:?}");

    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Outcome>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..THREADS {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some((c, positive)) = all.get(i) else { break };
                let r = run(c, &rel, &dev);
                let res = check(c, &r, &fx);
                println!("{} {} ({:.1} s){}", if res.is_ok() { "PASS" } else { "FAIL" }, c.name, r.took.as_secs_f64(), res.as_ref().err().map(|e| format!(": {e}")).unwrap_or_default());
                results.lock().unwrap().push((c.name, *positive, res));
            });
        }
    });
    let results = results.into_inner().unwrap();
    let count = |p: bool| (results.iter().filter(|r| r.1 == p && r.2.is_ok()).count(), results.iter().filter(|r| r.1 == p).count());
    let ((ea, en), (pa, pn)) = (count(false), count(true));
    println!("no_stderr_on_any_error: {ea}/{en} PASS (positives {pa}/{pn})");
    assert_eq!((ea, pa), (en, pn), "failures above");
}
