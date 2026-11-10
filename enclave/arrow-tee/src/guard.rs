//! Environment guard (DEC I-02, I-03) and the I-10 time guard. OutLayer sets the NEAR_* variables
//! to "" in HTTPS mode, so a missing variable and an empty one are treated the same.

use std::time::Duration;

use arrow_core::ArrowErr;

use crate::consts::{ALLOW_MAINNET, ALLOW_TESTNET};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EnvSnap {
    pub exec_type: String,
    pub network: String,
    pub predecessor: String,
    /// NEAR_BLOCK_TIMESTAMP in ns; None if missing, empty or not a decimal number.
    pub block_ts_ns: Option<u128>,
    pub master: Option<String>,
    pub nearai_key: Option<String>,
}

/// Parses NEAR_BLOCK_TIMESTAMP (decimal ns).
pub fn parse_block_ts(s: &str) -> Option<u128> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// `OUTLAYER_EXECUTION_TYPE == "NEAR"` and the predecessor is in the allowlist of its own network.
pub fn check_env(e: &EnvSnap) -> Result<Network, ArrowErr> {
    if e.exec_type != "NEAR" {
        return Err(ArrowErr::Guard);
    }
    let (net, allow) = match e.network.as_str() {
        "mainnet" => (Network::Mainnet, ALLOW_MAINNET),
        "testnet" => (Network::Testnet, ALLOW_TESTNET),
        _ => return Err(ArrowErr::Guard),
    };
    if !allow.contains(&e.predecessor.as_str()) {
        return Err(ArrowErr::Guard);
    }
    Ok(net)
}

/// now − block timestamp; a negative difference counts as 0. No block timestamp is `Late`.
pub fn elapsed_since_block(e: &EnvSnap, now_ns: Option<u128>) -> Result<Duration, ArrowErr> {
    let block = e.block_ts_ns.ok_or(ArrowErr::Late)?;
    let now = now_ns.ok_or(ArrowErr::Late)?;
    let ns = u64::try_from(now.saturating_sub(block)).unwrap_or(u64::MAX);
    Ok(Duration::from_nanos(ns))
}

pub fn now_wall_ns() -> Option<u128> {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_nanos())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(t: &str, net: &str, pred: &str) -> EnvSnap {
        EnvSnap { exec_type: t.into(), network: net.into(), predecessor: pred.into(), ..EnvSnap::default() }
    }

    #[test]
    fn guard_rejects_https_mode() {
        assert_eq!(check_env(&snap("HTTPS", "testnet", "arrow.arrowhq.testnet")), Err(ArrowErr::Guard));
        assert_eq!(check_env(&snap("", "", "")), Err(ArrowErr::Guard));
    }

    #[test]
    fn guard_rejects_unknown_network() {
        assert_eq!(check_env(&snap("NEAR", "betanet", "arrow.arrowhq.testnet")), Err(ArrowErr::Guard));
    }

    #[test]
    fn guard_rejects_cross_network_predecessor() {
        assert_eq!(check_env(&snap("NEAR", "mainnet", "arrow.arrowhq.testnet")), Err(ArrowErr::Guard));
        assert_eq!(check_env(&snap("NEAR", "testnet", "arrow-market.near")), Err(ArrowErr::Guard));
        assert_eq!(check_env(&snap("NEAR", "testnet", "attacker.arrowhq.testnet")), Err(ArrowErr::Guard));
    }

    #[test]
    fn guard_accepts_all_four_allowlisted() {
        for p in ALLOW_MAINNET {
            assert_eq!(check_env(&snap("NEAR", "mainnet", p)), Ok(Network::Mainnet));
        }
        for p in ALLOW_TESTNET {
            assert_eq!(check_env(&snap("NEAR", "testnet", p)), Ok(Network::Testnet));
        }
    }

    #[test]
    fn allowlists_match_dec_i03() {
        assert_eq!(ALLOW_MAINNET, ["arrow-market.near", "arrow-market-v2.near"]);
        assert_eq!(ALLOW_TESTNET, ["arrow.arrowhq.testnet", "arrow-v2.arrowhq.testnet"]);
    }

    #[test]
    fn block_ts_and_elapsed() {
        assert_eq!(parse_block_ts("1762760000000000000"), Some(1_762_760_000_000_000_000));
        assert_eq!(parse_block_ts(""), None);
        assert_eq!(parse_block_ts("-5"), None);
        assert_eq!(parse_block_ts("1.5"), None);
        let e = EnvSnap { block_ts_ns: Some(10_000_000_000), ..EnvSnap::default() };
        assert_eq!(elapsed_since_block(&e, Some(15_000_000_000)), Ok(Duration::from_secs(5)));
        assert_eq!(elapsed_since_block(&e, Some(1)), Ok(Duration::ZERO));
        assert_eq!(elapsed_since_block(&EnvSnap::default(), Some(1)), Err(ArrowErr::Late));
        assert_eq!(elapsed_since_block(&e, None), Err(ArrowErr::Late));
    }
}
