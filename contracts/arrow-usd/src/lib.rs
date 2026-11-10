//! Testnet-only NEP-141 (`aUSD`, 6 decimals) with a public mint capped per call.
//! Never deployed on mainnet. Accounts are registered automatically on mint and on
//! transfer; the contract pays that storage from its own balance (testnet, on purpose).

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

/// 10 USDC (6 decimals).
pub const MINT_CAP_PER_CALL: u128 = 10_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ArrowUsd {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl ArrowUsd {
    #[init]
    pub fn new() -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Arrow test USD (testnet only)".to_string(),
            symbol: "aUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        }
    }

    /// Public mint, at most `MINT_CAP_PER_CALL` per call.
    pub fn mint(&mut self, receiver_id: AccountId, amount: U128) {
        if amount.0 == 0 || amount.0 > MINT_CAP_PER_CALL {
            env::panic_str("Arrow-USD: mint cap is 10 USDC per call");
        }
        self.register_if_needed(&receiver_id);
        self.token.internal_deposit(&receiver_id, amount.0);
        FtMint { owner_id: &receiver_id, amount, memo: Some("arrow-usd public testnet mint") }.emit();
    }
}

impl ArrowUsd {
    fn register_if_needed(&mut self, account_id: &AccountId) {
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for ArrowUsd {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.register_if_needed(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.register_if_needed(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for ArrowUsd {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for ArrowUsd {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Refused: the token pays every registration itself (mint and transfers), so the standard
    /// unregister would refund that storage NEAR to the caller, and a mint + unregister loop would
    /// drain the token until no account can be registered (X12-6).
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        env::panic_str("Arrow-USD: storage_unregister is not supported (the token paid for the registration)")
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for ArrowUsd {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        match self.metadata.get() {
            Some(m) => m,
            None => env::panic_str("metadata missing"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("arrow-usd.test.near".parse().unwrap())
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }

    #[test]
    fn mint_within_cap_registers_and_credits() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(2), U128(MINT_CAP_PER_CALL));
        assert_eq!(c.ft_balance_of(accounts(2)).0, 10_000_000);
        assert_eq!(c.ft_total_supply().0, 10_000_000);
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON") && l.contains(r#""event":"ft_mint""#)), "{logs:?}");
    }

    /// X12-6: mint registers the receiver at the token's cost; unregistering would hand that
    /// storage NEAR to the caller, so a mint + unregister loop drained the token. It is refused.
    #[test]
    fn storage_unregister_after_mint_pays_nothing() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(1), U128(1));
        ctx(accounts(1), 1);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.storage_unregister(Some(true))));
        let text = res.err().and_then(|e| e.downcast_ref::<String>().cloned()).unwrap_or_default();
        assert!(text.contains("storage_unregister is not supported"), "unregister ran: {text}");
        assert!(near_sdk::test_utils::get_created_receipts().is_empty(), "storage NEAR was sent back");
    }

    #[test]
    #[should_panic(expected = "Arrow-USD: mint cap is 10 USDC per call")]
    fn mint_over_cap_panics() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(2), U128(MINT_CAP_PER_CALL + 1));
    }

    #[test]
    #[should_panic(expected = "Arrow-USD: mint cap is 10 USDC per call")]
    fn mint_zero_panics() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(2), U128(0));
    }

    #[test]
    fn transfer_autoregisters_receiver() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(1), U128(1_000));
        ctx(accounts(1), 1);
        c.ft_transfer(accounts(3), U128(400), None);
        assert_eq!((c.ft_balance_of(accounts(1)).0, c.ft_balance_of(accounts(3)).0), (600, 400));
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_requires_one_yocto() {
        ctx(accounts(1), 0);
        let mut c = ArrowUsd::new();
        c.mint(accounts(1), U128(1_000));
        c.ft_transfer(accounts(3), U128(400), None);
    }

    #[test]
    #[allow(non_snake_case)]
    fn metadata_is_aUSD_6() {
        ctx(accounts(1), 0);
        let c = ArrowUsd::new();
        let m = c.ft_metadata();
        assert_eq!((m.symbol.as_str(), m.decimals), ("aUSD", 6));
        assert!(m.name.contains("testnet only"));
    }
}
