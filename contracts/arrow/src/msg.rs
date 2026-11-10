//! `msg` of `mt_on_transfer` / `ft_on_transfer`. Single source: `fixtures/msg-vectors.json` [DEC H-06].

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::types::Mode;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Msg {
    List(ListMsg),
    Eval(EvalMsg),
    Buy(BuyMsg),
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ListMsg {
    pub title: String,
    pub public_desc: String,
    pub columns: Vec<String>,
    pub rows_claimed: u64,
    pub blob_url: String,
    pub blob_sha256: String,
    pub sealed_k: String,
    pub price: U128,
    pub eval_fee: U128,
    pub max_evals: u32,
    pub mode: Mode,
    pub payout: Option<AccountId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EvalMsg {
    pub listing_id: u64,
    pub sealed_criteria: String,
    pub buyer_pk: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BuyMsg {
    pub listing_id: u64,
    pub buyer_pk: String,
}

/// Parses the schema only; field rules are in `validate`. The error never echoes user input.
pub fn parse_msg(s: &str) -> Result<Msg, &'static str> {
    near_sdk::serde_json::from_str(s).map_err(|_| "json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::test_config;
    use crate::validate::{validate_buy, validate_eval, validate_list};
    use near_sdk::serde_json::{self, Value};

    const VECTORS: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/msg-vectors.json"));

    fn check(raw: &str) -> Result<(), &'static str> {
        let cfg = test_config();
        match parse_msg(raw)? {
            Msg::List(m) => validate_list(&m, &cfg),
            Msg::Eval(m) => validate_eval(&m),
            Msg::Buy(m) => validate_buy(&m),
        }
    }

    fn raw_of(case: &Value) -> String {
        match case.get("msg_raw").and_then(Value::as_str) {
            Some(r) => r.to_string(),
            None => serde_json::to_string(&case["msg"]).unwrap(),
        }
    }

    #[test]
    fn msg_vectors() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let valid = v["valid"].as_array().unwrap();
        let invalid = v["invalid"].as_array().unwrap();
        assert!(valid.len() >= 10 && invalid.len() >= 30, "vector file looks truncated");
        for case in valid {
            assert_eq!(check(&raw_of(case)), Ok(()), "valid case {} rejected", case["name"]);
        }
        for case in invalid {
            assert!(check(&raw_of(case)).is_err(), "invalid case {} ({}) accepted", case["name"], case["reason"]);
        }
    }

    fn buy_json(extra: &str) -> String {
        format!(r#"{{"op":"buy","listing_id":7,"buyer_pk":"04{}"{extra}}}"#, "ab".repeat(64))
    }

    #[test]
    fn msg_rejects_unknown_field() {
        assert!(parse_msg(&buy_json("")).is_ok());
        assert_eq!(parse_msg(&buy_json(r#","if":"x""#)), Err("json"));
    }

    #[test]
    fn msg_rejects_unknown_op() {
        let s = buy_json("").replace(r#""op":"buy""#, r#""op":"pay_if""#);
        assert_eq!(parse_msg(&s), Err("json"));
    }

    #[test]
    fn msg_rejects_string_ids() {
        let s = buy_json("").replace(r#""listing_id":7"#, r#""listing_id":"7""#);
        assert_eq!(parse_msg(&s), Err("json"));
    }
}
