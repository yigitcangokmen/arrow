//! The synthetic demo scenes (fixtures/demo/, fixtures/criteria/) through arrow-core's real stats, fit_rule and
//! novelty. This is the proof behind fixtures/demo/expected.json; the TS estimators in
//! scripts/src/lib/containment.ts are only the pre-check used to pick the data seeds.

use arrow_core::criteria::{parse_criteria, stats_spec, Criteria};
use arrow_core::fit::fit_rule;
use arrow_core::minhash::counts;
use arrow_core::novelty::novelty;
use arrow_core::parse::detect;
use arrow_core::stats::{compute, Stats};

fn read(rel: &str) -> Vec<u8> {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../").to_string() + rel;
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn scene(data: &str, criteria: &str) -> (Criteria, Stats) {
    let c = parse_criteria(&read(criteria)).unwrap();
    let plain = read(data);
    let (f, body) = detect(&plain).unwrap();
    let cols = arrow_core::parse::header(body, f).unwrap();
    let stats = compute(body, f, &stats_spec(&c, &cols)).unwrap();
    (c, stats)
}

fn band(c: &Criteria, s: &Stats) -> u8 {
    let sig = c.minhash.as_ref().expect("scene criteria carry a minhash");
    let n = counts(&s.key_base_hashes, sig).unwrap();
    novelty(true, !s.key_base_hashes.is_empty(), Some(n)).unwrap()
}

#[test]
fn demo_bands_unlock_is_1() {
    let (c, s) = scene("fixtures/demo/unlock-schedule-412.csv", "fixtures/criteria/demo.json");
    assert_eq!(s.rows, 412);
    assert_eq!(s.key_base_hashes.len(), 412);
    assert_eq!(band(&c, &s), 1);
}

#[test]
fn demo_bands_labels_is_4() {
    let (c, s) = scene("fixtures/demo/wallet-labels-1000.csv", "fixtures/criteria/demo-buy.json");
    assert_eq!(s.rows, 1000);
    assert_eq!(s.key_base_hashes.len(), 1000);
    assert_eq!(band(&c, &s), 4);
}

#[test]
fn demo_fit_rule_unlock_is_4() {
    let (c, s) = scene("fixtures/demo/unlock-schedule-412.csv", "fixtures/criteria/demo.json");
    // one unmet criterion: the required column vesting_contract_audit does not exist
    assert_eq!(fit_rule(&c, &s), 4);
}

#[test]
fn demo_fit_rule_labels_is_5() {
    let (c, s) = scene("fixtures/demo/wallet-labels-1000.csv", "fixtures/criteria/demo-buy.json");
    assert_eq!(fit_rule(&c, &s), 5);
}
