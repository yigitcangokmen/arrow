//! Payment rails: Mt = intents.near NEP-245 (`mt_transfer`), Ft = arrow-usd NEP-141 (testnet).

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId, Gas, NearToken};

use crate::types::{Config, Rail};

const TRANSFER_GAS: Gas = Gas::from_tgas(15);

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

/// Fire-and-forget transfer of `amount` USDC units; 0 is skipped (both standards panic on 0).
pub fn pay_out(cfg: &Config, rail: Rail, to: AccountId, amount: u128, memo: String) {
    if amount == 0 {
        return;
    }
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
                .detach();
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
                .detach();
        }
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

    #[test]
    fn refund_value_shapes() {
        assert_eq!(refund_value(Rail::Mt, 5), json!(["5"]));
        assert_eq!(refund_value(Rail::Ft, 5), json!("5"));
    }
}
