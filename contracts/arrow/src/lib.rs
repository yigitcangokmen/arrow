//! Arrow market contract: mt_on_transfer (Intents) -> OutLayer request_execution -> on_eval / on_release.

pub mod msg;
pub mod paths;
pub mod types;
pub mod validate;

#[cfg(test)]
mod testkit;

use near_sdk::{near, PanicOnDefault};

/// Filled in WS2-T05.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {}

#[near]
impl Contract {}
