//! Arrow market contract: mt_on_transfer (Intents) -> OutLayer request_execution -> on_eval / on_release.
//! Panic messages are `Arrow: Exx <text>` (tasks card §2.5); checks always run before any state change,
//! because a panic in a transfer-notification refunds the whole amount and rolls state back.

pub mod admin;
pub mod buy;
pub mod caps;
pub mod escrow;
pub mod eval;
pub mod events;
pub mod listing;
pub mod msg;
pub mod outlayer;
pub mod paths;
pub mod rail;
pub mod types;
pub mod validate;
pub mod views;

#[cfg(test)]
mod testkit;

use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

use crate::msg::{parse_msg, Msg};
use crate::types::*;
use crate::validate::validate_config;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    Evals,
    Purchases,
    EvalsByListing,
    CapByAccount,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    cfg: Config,
    paused: bool,
    program_pubkey: Option<String>,
    next_listing_id: u64,
    next_eval_id: u64,
    next_purchase_id: u64,
    listings: LookupMap<u64, Listing>,
    evals: LookupMap<u64, Eval>,
    purchases: LookupMap<u64, Purchase>,
    evals_by_listing: LookupMap<u64, Vec<u64>>,
    // Testnet daily caps; used only when cfg.testnet_caps is Some (testnet build).
    cap_day: u64,
    cap_global_used: u32,
    cap_by_account: LookupMap<AccountId, (u64, u32)>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(cfg: Config) -> Self {
        if let Err(field) = validate_config(&cfg) {
            env::panic_str(&format!("Arrow: E15 bad config: {field}"));
        }
        if cfg.secrets_ref.account_id != env::current_account_id() {
            env::panic_str("Arrow: E15 bad config: secrets_ref");
        }
        Self {
            cfg,
            paused: false,
            program_pubkey: None,
            next_listing_id: 1,
            next_eval_id: 1,
            next_purchase_id: 1,
            listings: LookupMap::new(StorageKey::Listings),
            evals: LookupMap::new(StorageKey::Evals),
            purchases: LookupMap::new(StorageKey::Purchases),
            evals_by_listing: LookupMap::new(StorageKey::EvalsByListing),
            cap_day: 0,
            cap_global_used: 0,
            cap_by_account: LookupMap::new(StorageKey::CapByAccount),
        }
    }

    /// NEP-245 transfer notification from intents.near. Returns the unused amounts (`["<n>"]`).
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Value> {
        let intents = match &self.cfg.intents {
            Some(i) => i.clone(),
            None => env::panic_str("Arrow: E20 intents disabled on this build"),
        };
        if env::predecessor_account_id() != intents {
            env::panic_str("Arrow: E01 predecessor is not the intents contract");
        }
        if token_ids.len() != 1
            || amounts.len() != 1
            || previous_owner_ids.len() != 1
            || previous_owner_ids[0] != sender_id
        {
            env::panic_str("Arrow: E03 expected exactly one token, amount and owner");
        }
        if token_ids[0] != self.cfg.usdc_token_id {
            env::panic_str("Arrow: E02 wrong token");
        }
        self.dispatch(sender_id, amounts[0].0, &msg, Rail::Mt)
    }

    /// NEP-141 transfer notification from arrow-usd (testnet build only). Returns the unused amount.
    #[cfg(feature = "testnet")]
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<Value> {
        if env::predecessor_account_id().as_str() != self.cfg.usdc_token_id {
            env::panic_str("Arrow: E02 wrong token");
        }
        self.dispatch(sender_id, amount.0, &msg, Rail::Ft)
    }

    /// Anyone may top up the NEAR gas tank that pays OutLayer deposits and storage.
    #[payable]
    pub fn fund_tank(&mut self) {
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > 0, "Arrow: attach NEAR to fund the tank");
        log!("arrow: tank funded {}", attached);
    }
}

impl Contract {
    fn dispatch(&mut self, sender: AccountId, amount: u128, msg: &str, rail: Rail) -> PromiseOrValue<Value> {
        let parsed = match parse_msg(msg) {
            Ok(m) => m,
            Err(field) => env::panic_str(&format!("Arrow: E04 bad msg: {field}")),
        };
        match parsed {
            Msg::List(m) => {
                let refund = self.handle_list(sender, amount, m, rail);
                PromiseOrValue::Value(rail::refund_value(rail, refund))
            }
            Msg::Eval(m) => self.handle_eval(sender, amount, m, rail),
            Msg::Buy(m) => self.handle_buy(sender, amount, m, rail),
        }
    }

    /// E05 / E06: shared preconditions of list, eval and buy.
    pub(crate) fn assert_open(&self) {
        if self.paused {
            env::panic_str("Arrow: E05 paused");
        }
        if self.program_pubkey.is_none() {
            env::panic_str("Arrow: E06 program key not initialised");
        }
    }

    /// E10: the free NEAR balance must cover `tank_min` plus the OutLayer deposit about to be sent.
    pub(crate) fn assert_tank(&self, outlayer_deposit: u128) {
        if tank_available() < self.cfg.tank_min.0 + outlayer_deposit {
            env::panic_str("Arrow: E10 gas tank low");
        }
    }
}

/// NEAR not locked by storage [W2-D9]. OutLayer refunds arrive as plain transfers, so no counter.
pub(crate) fn tank_available() -> u128 {
    let locked = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
    env::account_balance().as_yoctonear().saturating_sub(locked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;

    #[test]
    fn new_rejects_bad_config() {
        let mut cases: Vec<Config> = Vec::new();
        let mut c = test_config();
        c.fee_bps_sale = 10_001;
        cases.push(c);
        let mut c = test_config();
        c.max_evals_cap = 501;
        cases.push(c);
        let mut c = test_config();
        c.program_wasm_url = "http://example.test/a.wasm".into();
        cases.push(c);
        let mut c = test_config();
        c.program_wasm_hash = "AB".repeat(32);
        cases.push(c);
        let mut c = test_config();
        c.secrets_ref.account_id = acc("someone.test.near");
        cases.push(c);
        for (i, c) in cases.into_iter().enumerate() {
            let res = std::panic::catch_unwind(move || {
                setup(acc("deployer.test.near"), 10 * NEAR);
                Contract::new(c)
            });
            let err = res.err().unwrap_or_else(|| panic!("case {i} accepted"));
            let text = err.downcast_ref::<String>().cloned().unwrap_or_default();
            assert!(text.contains("Arrow: E15 bad config"), "case {i}: {text}");
        }
    }

    #[cfg(not(feature = "testnet"))]
    #[test]
    #[should_panic(expected = "Arrow: E15 bad config: testnet_caps")]
    fn mainnet_build_rejects_testnet_caps() {
        setup(self_id(), 10 * NEAR);
        let mut c = test_config();
        c.testnet_caps = Some(TestnetCaps { per_account_per_day: 1, global_per_day: 1, exempt: vec![] });
        Contract::new(c);
    }

    #[cfg(feature = "testnet")]
    #[test]
    #[should_panic(expected = "Arrow: E15 bad config: testnet_caps")]
    fn testnet_build_requires_caps() {
        setup(self_id(), 10 * NEAR);
        let mut c = test_config();
        c.testnet_caps = None;
        Contract::new(c);
    }

    #[test]
    fn fund_tank_accepts_deposit() {
        setup_with_deposit(acc("donor.test.near"), 10 * NEAR, NEAR);
        let mut c = contract();
        c.fund_tank();
        assert!(near_sdk::test_utils::get_logs().iter().any(|l| l.starts_with("arrow: tank funded")));
    }
}
