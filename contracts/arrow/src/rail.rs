//! Payment rails: Mt = intents.near NEP-245 (`mt_transfer`), Ft = arrow-usd NEP-141 (testnet).

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseError};

use crate::events::ArrowEvent;
use crate::types::{Config, Rail};
use crate::{Contract, ContractExt, StorageKey};

const TRANSFER_GAS: Gas = Gas::from_tgas(15);
const ON_PAYOUT_GAS: Gas = Gas::from_tgas(5);

#[near_sdk::ext_contract(ext_intents)]
#[allow(dead_code)]
pub trait Intents {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
}

#[near_sdk::ext_contract(ext_ft)]
#[allow(dead_code)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// Transfer of `amount` USDC units with an `on_payout` check; 0 is skipped (both standards panic
/// on 0). A refused transfer leaves the USDC with the contract and is recorded as owed (X12F-2, C-04).
pub fn pay_out(cfg: &Config, rail: Rail, to: AccountId, amount: u128, memo: String) {
    if amount == 0 {
        return;
    }
    let callback = Contract::ext(env::current_account_id())
        .with_static_gas(ON_PAYOUT_GAS)
        .with_unused_gas_weight(0)
        .on_payout(rail, to.clone(), U128(amount), memo.clone());
    transfer(cfg, rail, to, amount, memo).then(callback).detach();
}

fn transfer(cfg: &Config, rail: Rail, to: AccountId, amount: u128, memo: String) -> Promise {
    let one_yocto = NearToken::from_yoctonear(1);
    match rail {
        Rail::Mt => {
            let intents = match &cfg.intents {
                Some(i) => i.clone(),
                None => env::panic_str("Arrow: E20 intents disabled on this build"),
            };
            ext_intents::ext(intents)
                .with_attached_deposit(one_yocto)
                .with_static_gas(TRANSFER_GAS)
                .with_unused_gas_weight(0)
                .mt_transfer(to, cfg.usdc_token_id.clone(), U128(amount), None, Some(memo))
        }
        Rail::Ft => {
            let token: AccountId = match cfg.usdc_token_id.parse() {
                Ok(t) => t,
                Err(_) => env::panic_str("Arrow: E15 bad config: usdc_token_id"),
            };
            ext_ft::ext(token)
                .with_attached_deposit(one_yocto)
                .with_static_gas(TRANSFER_GAS)
                .with_unused_gas_weight(0)
                .ft_transfer(to, U128(amount), Some(memo))
        }
    }
}

/// USDC units owed per (rail, receiver) after a failed payout. Opened on demand, not a state field.
fn owed_map() -> LookupMap<(Rail, AccountId), u128> {
    LookupMap::new(StorageKey::Owed)
}

#[near]
impl Contract {
    /// Callback of every payout. A failed transfer adds the amount to what `to` is owed.
    #[private]
    pub fn on_payout(&mut self, rail: Rail, to: AccountId, amount: U128, memo: String) {
        if let Err(PromiseError::Failed) = env::promise_result_checked(0, 64) {
            let mut owed = owed_map();
            let key = (rail, to.clone());
            let total = owed.get(&key).copied().unwrap_or(0) + amount.0;
            owed.insert(key, total);
            ArrowEvent::ArrowPayoutFailed { to, amount, memo }.emit();
        }
    }

    /// Anyone, also after the lock: re-sends everything owed to `account_id` (memo `arrow:retry`).
    /// The entry is cleared first; if the transfer fails again, `on_payout` records it again.
    pub fn retry_payout(&mut self, account_id: AccountId) {
        let mut owed = owed_map();
        let mut sent = false;
        for rail in [Rail::Mt, Rail::Ft] {
            if let Some(amount) = owed.remove(&(rail, account_id.clone())) {
                pay_out(&self.cfg, rail, account_id.clone(), amount, "arrow:retry".into());
                sent = true;
            }
        }
        if !sent {
            env::panic_str("Arrow: E24 nothing owed");
        }
    }

    /// USDC units owed to `account_id` on `rail` after failed payouts (0 if none).
    pub fn get_owed(&self, account_id: AccountId, rail: Rail) -> U128 {
        U128(owed_map().get(&(rail, account_id)).copied().unwrap_or(0))
    }
}

/// The value `mt_on_transfer` / `ft_on_transfer` (or their callbacks) return as "unused":
/// `["<n>"]` for intents' resolver, `"<n>"` for the NEP-141 resolver [W2-D5].
pub fn refund_value(rail: Rail, refund: u128) -> Value {
    match rail {
        Rail::Mt => json!([U128(refund)]),
        Rail::Ft => json!(U128(refund)),
    }
}

/// (seller, treasury); the treasury share rounds down.
pub fn split(amount: u128, fee_bps: u16) -> (u128, u128) {
    let treasury = amount * u128::from(fee_bps) / 10_000;
    (amount - treasury, treasury)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_rounding() {
        assert_eq!(split(50_000, 1000), (45_000, 5_000));
        assert_eq!(split(250_000, 1000), (225_000, 25_000));
        assert_eq!(split(1, 1000), (1, 0));
        assert_eq!(split(2_000_000, 200), (1_960_000, 40_000));
    }

    /// X12F-2 / C-04: a refused payout is recorded as owed with an arrow_payout_failed event, and
    /// anyone can re-send it with retry_payout; a successful one records nothing.
    #[test]
    fn failed_payout_is_owed_and_retried() {
        use crate::testkit::*;
        use near_sdk::test_utils::get_logs;
        use near_sdk::PromiseResult;
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        let s = seller();
        callback_env(PromiseResult::Successful(vec![]));
        c.on_payout(Rail::Mt, s.clone(), U128(45_000), "arrow:eval:1".into());
        assert_eq!(c.get_owed(s.clone(), Rail::Mt).0, 0);
        callback_env(PromiseResult::Failed);
        c.on_payout(Rail::Mt, s.clone(), U128(45_000), "arrow:eval:1".into());
        c.on_payout(Rail::Mt, s.clone(), U128(1_960_000), "arrow:sale:1".into());
        assert_eq!((c.get_owed(s.clone(), Rail::Mt).0, c.get_owed(s.clone(), Rail::Ft).0), (2_005_000, 0));
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains(r#""event":"arrow_payout_failed""#) && l.contains(r#""amount":"1960000""#) && l.contains("arrow:sale:1")), "{logs:?}");

        setup(acc("anyone.test.near"), 10 * NEAR);
        c.retry_payout(s.clone());
        assert_eq!(c.get_owed(s.clone(), Rail::Mt).0, 0);
        let sent: Vec<_> = calls().into_iter().filter(|(_, m, _, _)| m == "mt_transfer").map(|(_, _, a, _)| (a["receiver_id"].clone(), a["amount"].clone(), a["memo"].clone())).collect();
        assert_eq!(sent, vec![(json!(s.as_str()), json!("2005000"), json!("arrow:retry"))]);
        assert!(calls().iter().any(|(_, m, a, _)| m == "on_payout" && a["amount"] == "2005000"));

        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.retry_payout(s.clone()))).err().unwrap();
        assert!(err.downcast_ref::<String>().cloned().unwrap_or_default().contains("Arrow: E24 nothing owed"));
    }

    #[test]
    fn refund_value_shapes() {
        assert_eq!(refund_value(Rail::Mt, 5), json!(["5"]));
        assert_eq!(refund_value(Rail::Ft, 5), json!("5"));
    }
}
