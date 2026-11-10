//! fixtures/parse-vectors.json: what the enclave's parser accepts, pinned here so the web and CLI
//! sell preflight can be tested against the same inputs (QA-03, X12-U2).

use arrow_core::parse::{detect, for_each_row, header};
use arrow_core::ArrowErr;
use serde_json::Value;

fn bytes(c: &Value) -> Vec<u8> {
    if let Some(h) = c["hex"].as_str() {
        return hex::decode(h).unwrap();
    }
    let g = &c["generate"];
    let mut s = format!("{}\n", g["header"].as_str().unwrap());
    for _ in 0..g["rows"].as_u64().unwrap() {
        s.push_str(g["row"].as_str().unwrap());
        s.push('\n');
    }
    s.into_bytes()
}

fn rows(input: &[u8]) -> Result<u32, ArrowErr> {
    let (f, body) = detect(input)?;
    let cols = header(body, f)?;
    for_each_row(body, f, &cols, |_, _| Ok(()))
}

#[test]
fn parse_vectors() {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/parse-vectors.json");
    let f: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    for c in f["cases"].as_array().unwrap() {
        let got = rows(&bytes(c));
        let name = c["name"].as_str().unwrap();
        match c["enclave"].as_str().unwrap() {
            "ok" => assert_eq!(got, Ok(u32::try_from(c["rows"].as_u64().unwrap()).unwrap()), "{name}"),
            "Format" => assert_eq!(got, Err(ArrowErr::Format), "{name}"),
            "Empty" => assert_eq!(got, Err(ArrowErr::Empty), "{name}"),
            "Limits" => assert_eq!(got, Err(ArrowErr::Limits), "{name}"),
            other => panic!("{name}: unknown class {other}"),
        }
    }
}
