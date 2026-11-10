//! Read-only views [DEC H-16]. Web, CLI, verify and bench read the contract only through these
//! (no indexer, [DEC L-07]). Page sizes are capped at 50 to stay under the view gas limit.

use near_sdk::json_types::U128;
use near_sdk::near;

use crate::paths::{payment_path, PaymentPath, ResultPath, RESULT_PATH};
use crate::types::*;
use crate::{tank_available, Contract, ContractExt};

pub const MAX_PAGE: u64 = 50;

#[near(serializers = [json])]
pub struct ConfigView {
    pub config: Config,
    pub paused: bool,
    pub tank_available: U128,
    pub payment_path: String,
    pub result_path: String,
    pub build: String,
}

#[near(serializers = [json])]
pub struct VersionView {
    pub name: String,
    pub version: String,
    pub payment_path: String,
    pub result_path: String,
    pub build: String,
}

fn payment_path_name() -> &'static str {
    match payment_path() {
        PaymentPath::Notify => "notify",
        PaymentPath::Escrow => "escrow",
    }
}

fn result_path_name() -> &'static str {
    match RESULT_PATH {
        ResultPath::Chain => "chain",
        ResultPath::SignedHttps => "signed_https",
    }
}

fn build_name() -> &'static str {
    if cfg!(feature = "testnet") {
        "testnet"
    } else {
        "mainnet"
    }
}

#[near]
impl Contract {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            config: self.cfg.clone(),
            paused: self.paused,
            tank_available: U128(tank_available()),
            payment_path: payment_path_name().into(),
            result_path: result_path_name().into(),
            build: build_name().into(),
        }
    }

    pub fn program_pubkey(&self) -> Option<String> {
        self.program_pubkey.clone()
    }

    pub fn get_listing(&self, listing_id: u64) -> Option<Listing> {
        self.listings.get(&listing_id).cloned()
    }

    /// Listings with id >= `from_index` (ids start at 1, so 0 reads from the first), at most 50.
    pub fn get_listings(&self, from_index: u64, limit: u64) -> Vec<Listing> {
        (from_index.max(1)..self.next_listing_id)
            .take(limit.min(MAX_PAGE) as usize)
            .filter_map(|id| self.listings.get(&id).cloned())
            .collect()
    }

    /// `sealed_criteria` is never serialized.
    pub fn get_eval(&self, eval_id: u64) -> Option<Eval> {
        self.evals.get(&eval_id).cloned()
    }

    /// The listing's evals in order; `from_index` is a 0-based position in that list. At most 50.
    pub fn get_evals_by_listing(&self, listing_id: u64, from_index: u64, limit: u64) -> Vec<Eval> {
        match self.evals_by_listing.get(&listing_id) {
            Some(ids) => ids
                .iter()
                .skip(from_index as usize)
                .take(limit.min(MAX_PAGE) as usize)
                .filter_map(|id| self.evals.get(id).cloned())
                .collect(),
            None => Vec::new(),
        }
    }

    pub fn get_purchase(&self, purchase_id: u64) -> Option<Purchase> {
        self.purchases.get(&purchase_id).cloned()
    }

    /// G1 counter [DEC A.1 G1]: spent = evals_used x bits, budget = max_evals x bits.
    pub fn leak_budget(&self, listing_id: u64) -> Option<LeakBudget> {
        self.listings.get(&listing_id).map(|l| {
            let bits = u64::from(l.bits_per_eval_milli);
            let budget = u64::from(l.max_evals) * bits;
            let spent = u64::from(l.evals_used) * bits;
            LeakBudget {
                listing_id,
                bits_per_eval_milli: l.bits_per_eval_milli,
                max_evals: l.max_evals,
                evals_used: l.evals_used,
                budget_milli: budget,
                spent_milli: spent,
                left_milli: budget - spent,
            }
        })
    }

    pub fn version(&self) -> VersionView {
        VersionView {
            name: "arrow".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            payment_path: payment_path_name().into(),
            result_path: result_path_name().into(),
            build: build_name().into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::msg::{BuyMsg, EvalMsg, Msg};
    use crate::testkit::*;
    use crate::types::*;
    use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
    use near_sdk::json_types::U128;
    use near_sdk::serde_json::{self, Value};
    use near_sdk::test_utils::get_logs;
    use near_sdk::PromiseResult;

    fn list(c: &mut crate::Contract, mode: Mode, max_evals: u32) {
        setup(intents(), 10 * NEAR);
        let mut m = list_msg();
        m.mode = mode;
        m.max_evals = max_evals;
        let _ = mt_call(c, seller(), 100_000, msg_json(Msg::List(m)));
    }

    fn eval(c: &mut crate::Contract, listing_id: u64) {
        setup(intents(), 10 * NEAR);
        let m = EvalMsg { listing_id, sealed_criteria: STANDARD.encode([9u8; 200]), buyer_pk: format!("04{}", "22".repeat(64)) };
        let _ = mt_call(c, buyer(), 100_000, msg_json(Msg::Eval(m)));
    }

    #[test]
    fn leak_budget_fields() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        list(&mut c, Mode::Scored, 50);
        list(&mut c, Mode::Verdict, 50);
        let b = c.leak_budget(1).unwrap();
        assert_eq!((b.bits_per_eval_milli, b.budget_milli, b.spent_milli, b.left_milli), (5673, 283_650, 0, 283_650));
        for _ in 0..3 {
            eval(&mut c, 1);
        }
        let b = c.leak_budget(1).unwrap();
        assert_eq!((b.listing_id, b.max_evals, b.evals_used, b.spent_milli, b.left_milli), (1, 50, 3, 17_019, 266_631));
        let v = c.leak_budget(2).unwrap();
        assert_eq!((v.bits_per_eval_milli, v.budget_milli), (1585, 79_250));
        assert!(c.leak_budget(3).is_none());
    }

    #[test]
    fn get_listings_caps_limit_50() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        for _ in 0..55 {
            list(&mut c, Mode::Scored, 5);
        }
        let page = c.get_listings(0, 100);
        assert_eq!((page.len(), page[0].id, page[49].id), (50, 1, 50));
        let rest = c.get_listings(51, 50);
        assert_eq!(rest.iter().map(|l| l.id).collect::<Vec<_>>(), vec![51, 52, 53, 54, 55]);
        assert!(c.get_listings(56, 10).is_empty());
        assert_eq!(c.get_listing(7).map(|l| l.id), Some(7));
        assert!(c.get_listing(99).is_none());
    }

    #[test]
    fn evals_by_listing_pages() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        list(&mut c, Mode::Scored, 100);
        list(&mut c, Mode::Scored, 100);
        for i in 0..6 {
            eval(&mut c, 1 + i % 2);
        }
        let ids = |v: Vec<Eval>| v.iter().map(|e| e.id).collect::<Vec<_>>();
        assert_eq!(ids(c.get_evals_by_listing(1, 0, 50)), vec![1, 3, 5]);
        assert_eq!(ids(c.get_evals_by_listing(2, 1, 1)), vec![4]);
        assert!(c.get_evals_by_listing(3, 0, 50).is_empty());
    }

    #[test]
    fn eval_view_hides_sealed_criteria() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        list(&mut c, Mode::Scored, 5);
        eval(&mut c, 1);
        let mut e = c.get_eval(1).unwrap();
        e.sealed_criteria = Some("secret".into());
        let v = serde_json::to_value(&e).unwrap();
        assert!(v.get("sealed_criteria").is_none(), "{v}");
        assert_eq!(v["status"], "pending");
    }

    #[test]
    fn version_reports_build() {
        setup(intents(), 10 * NEAR);
        let c = contract();
        let v = serde_json::to_value(c.version()).unwrap();
        let build = if cfg!(feature = "testnet") { "testnet" } else { "mainnet" };
        let path = if option_env!("ARROW_PAYMENT_PATH") == Some("escrow") { "escrow" } else { "notify" };
        assert_eq!(v["name"], "arrow");
        assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!((v["build"].as_str(), v["payment_path"].as_str(), v["result_path"].as_str()), (Some(build), Some(path), Some("chain")));
        let cfg = serde_json::to_value(c.get_config()).unwrap();
        assert_eq!((cfg["build"].as_str(), cfg["payment_path"].as_str(), cfg["paused"].as_bool()), (Some(build), Some(path), Some(false)));
        assert_eq!(cfg["config"]["treasury"], "treasury.test.near");
        assert!(cfg["tank_available"].as_str().unwrap().parse::<u128>().unwrap() > 0);
        assert_eq!(c.program_pubkey(), Some(format!("04{}", "11".repeat(64))));
    }

    #[test]
    fn events_are_nep297() {
        setup(intents(), 10 * NEAR);
        let mut c = contract();
        list(&mut c, Mode::Scored, 5);
        let mut logs = get_logs();
        eval(&mut c, 1);
        logs.extend(get_logs());
        setup(intents(), 10 * NEAR);
        let _ = mt_call(&mut c, buyer(), U128(250_000).0, msg_json(Msg::Buy(BuyMsg { listing_id: 1, buyer_pk: format!("04{}", "22".repeat(64)) })));
        logs.extend(get_logs());
        callback_env(PromiseResult::Failed);
        c.on_eval(1);
        logs.extend(get_logs());

        let mut seen = std::collections::BTreeSet::new();
        for l in logs.iter().filter(|l| l.starts_with("EVENT_JSON:")) {
            let v: Value = serde_json::from_str(&l["EVENT_JSON:".len()..]).unwrap();
            assert_eq!((v["standard"].as_str(), v["version"].as_str()), (Some("arrow"), Some("1.0.0")), "{l}");
            assert!(v["data"].is_object(), "data must be an object: {l}");
            let ev = v["event"].as_str().unwrap().to_string();
            assert!(ev.starts_with("arrow_") && ev.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_'), "{ev}");
            seen.insert(ev);
        }
        let want: std::collections::BTreeSet<String> = ["arrow_listed", "arrow_eval", "arrow_purchase", "arrow_refund"].iter().map(|s| s.to_string()).collect();
        assert_eq!(seen, want);
    }
}
