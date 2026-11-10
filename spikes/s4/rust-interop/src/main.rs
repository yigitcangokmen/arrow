//! S4-b: does what the browser seals open in the enclave, and the other way round?
//!
//! ts->rs: read the TS vectors (fixtures/ecies-vectors.json, xchacha-vectors.json, minhash-vectors.json)
//!         and open/recompute every case with the enclave's crates.
//! rs->ts: write fixtures/ecies-vectors-rs.json and xchacha-vectors-rs.json in the WS4-T02 schema for
//!         sdk/test/crypto.interop.test.ts. ECIES is randomized, so an existing file is only verified;
//!         pass --write to regenerate.
//!
//! A missing TS file is PENDING, never PASS. Exit code 1 on any mismatch, 0 otherwise.

use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use k256::elliptic_curve::ops::Reduce;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

enum Line {
    Pass(usize, usize),
    Fail(usize, usize),
    Pending(&'static str),
}

/// `S4_FIXTURES_DIR` points the run at another directory (dry runs with scratch vectors).
fn fixtures() -> PathBuf {
    std::env::var_os("S4_FIXTURES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures"))
}

fn read(name: &str) -> Option<Value> {
    let s = std::fs::read_to_string(fixtures().join(name)).ok()?;
    serde_json::from_str(&s).ok()
}

fn write(name: &str, v: &Value) {
    let s = serde_json::to_string_pretty(v).unwrap() + "\n";
    std::fs::write(fixtures().join(name), s).unwrap();
}

fn hx(v: &Value, k: &str) -> Vec<u8> {
    hex::decode(v[k].as_str().unwrap_or_default()).unwrap_or_default()
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

/// fixtures/README.md: sk = sha256(utf8(label)) mod n, label + "/1" if that is 0.
fn label_sk(label: &str) -> k256::SecretKey {
    for l in [label.to_owned(), format!("{label}/1")] {
        let s = <k256::Scalar as Reduce<k256::U256>>::reduce_bytes(&sha(l.as_bytes()).into());
        if let Some(nz) = Option::<k256::NonZeroScalar>::from(k256::NonZeroScalar::new(s)) {
            return k256::SecretKey::from(nz);
        }
    }
    unreachable!("two consecutive zero scalars")
}

fn pub_hex(sk: &k256::SecretKey) -> String {
    hex::encode(sk.public_key().to_encoded_point(false).as_bytes())
}

fn ecies_ts_to_rs() -> Line {
    let Some(f) = read("ecies-vectors.json") else { return Line::Pending("fixtures/ecies-vectors.json missing (WS4-T02)") };
    let cases = f["cases"].as_array().cloned().unwrap_or_default();
    let ok = cases
        .iter()
        .filter(|c| {
            let sk = hx(c, "scalar_hex");
            let pk_ok = k256::SecretKey::from_slice(&sk).map(|s| pub_hex(&s) == c["pub_hex"].as_str().unwrap_or("")).unwrap_or(false);
            let pt = ecies::decrypt(&sk, &hx(c, "ciphertext_hex")).ok();
            let ok = pk_ok && pt.as_deref() == Some(hx(c, "plaintext_hex").as_slice());
            if !ok {
                println!("  ecies ts->rs FAIL {}", c["id"]);
            }
            ok
        })
        .count();
    if ok == cases.len() && ok > 0 { Line::Pass(ok, cases.len()) } else { Line::Fail(ok, cases.len()) }
}

fn pattern(n: usize, salt: u8) -> Vec<u8> {
    (0..n).map(|i| (i as u8).wrapping_mul(31).wrapping_add(salt)).collect()
}

fn ecies_rs_to_ts(force: bool) -> (Line, String) {
    let name = "ecies-vectors-rs.json";
    if !force {
        if let Some(f) = read(name) {
            let cases = f["cases"].as_array().cloned().unwrap_or_default();
            let ok = cases
                .iter()
                .filter(|c| ecies::decrypt(&hx(c, "scalar_hex"), &hx(c, "ciphertext_hex")).ok().as_deref() == Some(hx(c, "plaintext_hex").as_slice()))
                .count();
            let msg = format!("{} vectors in fixtures/{name} (self-check {ok}/{})", cases.len(), cases.len());
            return (if ok == cases.len() && ok > 0 { Line::Pass(ok, cases.len()) } else { Line::Fail(ok, cases.len()) }, msg);
        }
    }
    let mut cases = Vec::new();
    for (id, n) in [("len1", 1usize), ("len32", 32), ("len64", 64), ("len1000", 1000), ("len2975", 2975)] {
        let sk = label_sk(&format!("arrow:vector:ecies-rs:{id}:v1"));
        let pk = sk.public_key().to_encoded_point(false);
        let pt = pattern(n, 7);
        let ct = ecies::encrypt(pk.as_bytes(), &pt).unwrap();
        assert_eq!(ct.len(), 97 + n, "ECIES overhead must be 97 (DEC I-09)");
        assert_eq!(ecies::decrypt(&sk.to_bytes(), &ct).unwrap(), pt);
        cases.push(json!({
            "id": id,
            "scalar_hex": hex::encode(sk.to_bytes()),
            "pub_hex": pub_hex(&sk),
            "plaintext_hex": hex::encode(&pt),
            "ciphertext_hex": hex::encode(&ct),
        }));
    }
    let n = cases.len();
    write(name, &json!({
        "version": 1,
        "generator": "ecies-rs@0.2.11 (pure) via spikes/s4/rust-interop",
        "note": "scalar = sha256(utf8(\"arrow:vector:ecies-rs:<id>:v1\")) mod n (W1-09 label keys, no funds). Plaintext byte i = (31*i + 7) mod 256. Ciphertext = eph_pk65 || nonce16 || ct || tag16.",
        "cases": cases,
    }));
    (Line::Pass(n, n), format!("wrote {n} vectors to fixtures/{name}"))
}

fn xchacha_open(key: &[u8], blob: &[u8]) -> Option<Vec<u8>> {
    let key: [u8; 32] = key.try_into().ok()?;
    let nonce: [u8; 24] = blob.get(..24)?.try_into().ok()?;
    XChaCha20Poly1305::new(&key.into()).decrypt(&XNonce::from(nonce), blob.get(24..)?).ok()
}

fn xchacha_case_ok(c: &Value) -> bool {
    let blob = hx(c, "blob_hex");
    let pt = xchacha_open(&hx(c, "key_hex"), &blob);
    let nonce_ok = blob.get(..24) == Some(hx(c, "nonce_hex").as_slice());
    let sha_ok = c["blob_sha256"].as_str() == Some(hex::encode(sha(&blob)).as_str());
    pt.as_deref() == Some(hx(c, "plaintext_hex").as_slice()) && nonce_ok && sha_ok
}

fn xchacha_ts_to_rs() -> Line {
    let Some(f) = read("xchacha-vectors.json") else { return Line::Pending("fixtures/xchacha-vectors.json missing (WS4-T02)") };
    let cases = f["cases"].as_array().cloned().unwrap_or_default();
    let ok = cases.iter().filter(|c| xchacha_case_ok(c)).count();
    if ok == cases.len() && ok > 0 { Line::Pass(ok, cases.len()) } else { Line::Fail(ok, cases.len()) }
}

fn xchacha_rs_to_ts() -> (Line, String) {
    let name = "xchacha-vectors-rs.json";
    let mut cases = Vec::new();
    for (id, n) in [("len0", 0usize), ("len1", 1), ("len1000", 1000), ("len65537", 65_537)] {
        let key = sha(format!("arrow:vector:xchacha-rs:{id}:key").as_bytes());
        let nonce: [u8; 24] = sha(format!("arrow:vector:xchacha-rs:{id}:nonce").as_bytes())[..24].try_into().unwrap();
        let pt = pattern(n, 11);
        let ct = XChaCha20Poly1305::new(&key.into()).encrypt(&XNonce::from(nonce), pt.as_slice()).unwrap();
        let mut blob = nonce.to_vec();
        blob.extend(ct);
        assert_eq!(blob.len(), 24 + n + 16);
        cases.push(json!({
            "id": id,
            "key_hex": hex::encode(key),
            "nonce_hex": hex::encode(nonce),
            "plaintext_hex": hex::encode(&pt),
            "blob_hex": hex::encode(&blob),
            "blob_sha256": hex::encode(sha(&blob)),
        }));
    }
    let n = cases.len();
    let ok = cases.iter().filter(|c| xchacha_case_ok(c)).count();
    write(name, &json!({
        "version": 1,
        "generator": "chacha20poly1305@0.10 via spikes/s4/rust-interop",
        "note": "Deterministic: key = sha256(\"arrow:vector:xchacha-rs:<id>:key\"), nonce = first 24 bytes of sha256(\"…:<id>:nonce\"). Plaintext byte i = (31*i + 11) mod 256. blob = nonce24 || ct || tag16, no AAD.",
        "cases": cases,
    }));
    (if ok == n { Line::Pass(ok, n) } else { Line::Fail(ok, n) }, format!("wrote {n} vectors to fixtures/{name}"))
}

fn minhash_check(name: &str) -> Option<(usize, usize)> {
    use arrow_core::{minhash, normalize};
    let f = read(name)?;
    let cases = f["cases"].as_array().cloned().unwrap_or_default();
    let ok = cases
        .iter()
        .filter(|c| {
            let keys: Vec<String> = c["keys"].as_array().into_iter().flatten().filter_map(|k| k.as_str().map(str::to_owned)).collect();
            let norm_ok = c["normalized"].as_array().is_some_and(|n| {
                n.len() == keys.len() && n.iter().zip(&keys).all(|(n, k)| n.as_str() == Some(normalize::normalize_key(k).as_str()))
            });
            let sig = minhash::signature(keys.iter().map(String::as_str)).map(|s| minhash::signature_hex(&s)).ok();
            norm_ok && sig.as_deref() == c["signature_hex"].as_str()
        })
        .count();
    Some((ok, cases.len()))
}

fn show(label: &str, l: &Line, extra: &str) -> bool {
    match l {
        Line::Pass(a, b) => println!("S4-b {label}: {a}/{b} PASS{extra}"),
        Line::Fail(a, b) => println!("S4-b {label}: {a}/{b} FAIL{extra}"),
        Line::Pending(why) => println!("S4-b {label}: PENDING ({why})"),
    }
    matches!(l, Line::Fail(..))
}

fn main() {
    let force = std::env::args().any(|a| a == "--write");
    let mut failed = false;
    let mut pending = false;

    let l = ecies_ts_to_rs();
    pending |= matches!(l, Line::Pending(_));
    failed |= show("ecies ts->rs", &l, "");
    let (l, msg) = ecies_rs_to_ts(force);
    failed |= show("ecies rs->ts", &l, &format!(" ({msg}; TS side: sdk/test/crypto.interop.test.ts)"));

    let l = xchacha_ts_to_rs();
    pending |= matches!(l, Line::Pending(_));
    failed |= show("xchacha ts->rs", &l, "");
    let (l, msg) = xchacha_rs_to_ts();
    failed |= show("xchacha rs->ts", &l, &format!(" ({msg})"));

    let l = match minhash_check("minhash-vectors.json") {
        None => Line::Pending("fixtures/minhash-vectors.json missing (WS4-T03)"),
        Some((a, b)) if a == b && b > 0 => Line::Pass(a, b),
        Some((a, b)) => Line::Fail(a, b),
    };
    pending |= matches!(l, Line::Pending(_));
    failed |= show("minhash ts->rs", &l, "");
    if let Some((a, b)) = minhash_check("minhash-vectors-rs.json") {
        failed |= show("minhash rs self-check", &if a == b { Line::Pass(a, b) } else { Line::Fail(a, b) }, " (fixtures/minhash-vectors-rs.json)");
    }

    let result = if failed { "FAIL" } else if pending { "PENDING (ts->rs needs WS4-T02/T03 vectors; rs->ts needs crypto.interop.test.ts)" } else { "PASS (rs->ts pending WS-4 vitest)" };
    println!("S4-b RESULT: {result}");
    if failed {
        std::process::exit(1);
    }
}
