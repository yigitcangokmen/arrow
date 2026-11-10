//! Testnet daily eval caps (per account and global). No effect on the mainnet build,
//! where `new`/`set_config` keep `testnet_caps` at None.

use near_sdk::{env, AccountId};

use crate::types::DAY_NS;
use crate::Contract;

impl Contract {
    /// E11 / E12, then counts the eval. Exempt accounts are neither checked nor counted.
    /// Direct sub-accounts of an exempt account (the sponsor's `j….arrow-judge.arrowhq.testnet` judge
    /// accounts) keep their per-account cap but skip the global one, so free accounts that use up
    /// the global pool cannot lock judges out for the day (STATE-11).
    pub(crate) fn charge_eval_cap(&mut self, who: &AccountId) {
        if !cfg!(feature = "testnet") {
            return;
        }
        let caps = match &self.cfg.testnet_caps {
            Some(c) => c.clone(),
            None => return,
        };
        if caps.exempt.contains(who) {
            return;
        }
        let day = env::block_timestamp() / DAY_NS;
        if self.cap_day != day {
            self.cap_day = day;
            self.cap_global_used = 0;
        }
        let used = match self.cap_by_account.get(who) {
            Some(&(d, n)) if d == day => n,
            _ => 0,
        };
        if used >= caps.per_account_per_day {
            env::panic_str("Arrow: E11 daily eval cap reached for account");
        }
        // Exactly one label before the exempt id: a judge account holds a full-access key and could
        // otherwise mint x1.j…, x2.j… without limit, each with a fresh per-account cap (R2-1).
        let sponsored = caps.exempt.iter().any(|e| {
            who.as_str()
                .strip_suffix(e.as_str())
                .and_then(|p| p.strip_suffix('.'))
                .is_some_and(|l| !l.is_empty() && !l.contains('.'))
        });
        if !sponsored && self.cap_global_used >= caps.global_per_day {
            env::panic_str("Arrow: E12 daily global eval cap reached");
        }
        self.cap_by_account.insert(who.clone(), (day, used + 1));
        if !sponsored {
            self.cap_global_used += 1;
        }
    }
}
