//! Self-owned admin [DEC H-01]: only the contract's own account may call these, so deleting its
//! access keys (the lock) closes them forever. The program key is derived inside the enclave
//! (`action=derive`) and stored on chain; sellers seal `K || blob_sha256` to it [DEC J-01].

use near_sdk::serde_json;
use near_sdk::{env, log, near, Gas, Promise, PromiseError};

use crate::outlayer::{derive_input, request};
use crate::types::{ArrowOut, ConfigPatch, MAX_OUTPUT_BYTES, OUTPUT_LIMIT_BYTES};
use crate::validate::{is_lower_hex, validate_config, validate_program};
use crate::{Contract, ContractExt};

const ON_PROGRAM_KEY_GAS: Gas = Gas::from_tgas(20);

fn assert_self() {
    if env::predecessor_account_id() != env::current_account_id() {
        env::panic_str("Arrow: E14 self-only method");
    }
}

/// Accepts only `{"v":1,"ok":true,"pk":"04" + 128 lowercase hex}` (uncompressed secp256k1).
pub fn classify_pk(res: Result<Vec<u8>, PromiseError>) -> Result<String, &'static str> {
    let bytes = match res {
        Ok(b) => b,
        Err(PromiseError::Failed) => return Err("null"),
        Err(_) => return Err("bad_output"),
    };
    if bytes.len() > OUTPUT_LIMIT_BYTES {
        return Err("bad_output");
    }
    let out: ArrowOut = match serde_json::from_slice::<Option<ArrowOut>>(&bytes) {
        Ok(Some(o)) => o,
        Ok(None) => return Err("null"),
        Err(_) => return Err("bad_output"),
    };
    if out.v != 1 {
        return Err("bad_output");
    }
    if !out.ok {
        return Err("not_ok");
    }
    match out.pk {
        Some(pk) if out.r.is_none() && out.k.is_none() && out.h.is_none() && pk.starts_with("04") && is_lower_hex(&pk, 130) => Ok(pk),
        _ => Err("bad_output"),
    }
}

#[near]
impl Contract {
    /// Asks the enclave for the program public key. The whole attached deposit goes to OutLayer;
    /// OutLayer refunds the unused part to the payer (self), i.e. into the gas tank.
    #[payable]
    pub fn init_program_key(&mut self) -> Promise {
        assert_self();
        let attached = env::attached_deposit().as_yoctonear();
        if attached < self.cfg.outlayer_deposit_release.0 {
            env::panic_str("Arrow: E08 amount below required");
        }
        request(&self.cfg, derive_input(), attached, &self.cfg.limits_release).then(
            Self::ext(env::current_account_id())
                .with_static_gas(ON_PROGRAM_KEY_GAS)
                .with_unused_gas_weight(1)
                .on_program_key(),
        )
    }

    /// Never panics: a bad answer leaves the key unchanged and is logged.
    #[private]
    pub fn on_program_key(&mut self) {
        match classify_pk(env::promise_result_checked(0, MAX_OUTPUT_BYTES)) {
            Ok(pk) => {
                self.program_pubkey = Some(pk);
                log!("arrow: program key set");
            }
            Err(reason) => log!("arrow: program key derive failed: {}", reason),
        }
    }

    /// New wasm means a new secret slot and so a new key: the stored key is cleared until
    /// `init_program_key` runs again, and listings sealed to the old program get E13.
    pub fn set_program(&mut self, url: String, hash: String) {
        assert_self();
        if let Err(field) = validate_program(&url, &hash) {
            env::panic_str(&format!("Arrow: E15 bad config: {field}"));
        }
        self.cfg.program_wasm_url = url;
        self.cfg.program_wasm_hash = hash;
        self.program_pubkey = None;
        log!("arrow: program set {}", self.cfg.program_wasm_hash);
    }

    pub fn set_config(&mut self, patch: ConfigPatch) {
        assert_self();
        let mut cfg = self.cfg.clone();
        let ConfigPatch {
            treasury,
            fee_bps_eval,
            fee_bps_sale,
            min_eval_fee,
            min_price,
            listing_bond,
            max_evals_cap,
            outlayer_deposit_eval,
            outlayer_deposit_release,
            tank_min,
            limits_eval,
            limits_release,
            testnet_caps,
        } = patch;
        if let Some(v) = treasury {
            cfg.treasury = v;
        }
        if let Some(v) = fee_bps_eval {
            cfg.fee_bps_eval = v;
        }
        if let Some(v) = fee_bps_sale {
            cfg.fee_bps_sale = v;
        }
        if let Some(v) = min_eval_fee {
            cfg.min_eval_fee = v;
        }
        if let Some(v) = min_price {
            cfg.min_price = v;
        }
        if let Some(v) = listing_bond {
            cfg.listing_bond = v;
        }
        if let Some(v) = max_evals_cap {
            cfg.max_evals_cap = v;
        }
        if let Some(v) = outlayer_deposit_eval {
            cfg.outlayer_deposit_eval = v;
        }
        if let Some(v) = outlayer_deposit_release {
            cfg.outlayer_deposit_release = v;
        }
        if let Some(v) = tank_min {
            cfg.tank_min = v;
        }
        if let Some(v) = limits_eval {
            cfg.limits_eval = v;
        }
        if let Some(v) = limits_release {
            cfg.limits_release = v;
        }
        if let Some(v) = testnet_caps {
            cfg.testnet_caps = Some(v);
        }
        if let Err(field) = validate_config(&cfg) {
            env::panic_str(&format!("Arrow: E15 bad config: {field}"));
        }
        self.cfg = cfg;
        log!("arrow: config updated");
    }

    pub fn set_paused(&mut self, paused: bool) {
        assert_self();
        self.paused = paused;
        log!("arrow: paused {}", paused);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use near_sdk::json_types::U128;
    use near_sdk::serde_json::json;
    use near_sdk::test_utils::get_logs;
    use near_sdk::PromiseResult;

    fn panic_text(e: Box<dyn std::any::Any + Send>) -> String {
        e.downcast_ref::<String>().cloned().unwrap_or_default()
    }

    fn try_admin(c: &mut crate::Contract, who: near_sdk::AccountId, deposit: u128, i: usize) -> Result<(), String> {
        setup_with_deposit(who, 10 * NEAR, deposit);
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match i {
            0 => {
                let _ = c.init_program_key();
            }
            1 => c.set_program("https://example.test/v2.wasm".into(), "ef".repeat(32)),
            2 => c.set_config(ConfigPatch { fee_bps_sale: Some(300), ..Default::default() }),
            _ => c.set_paused(true),
        }))
        .map_err(panic_text)
    }

    #[test]
    fn self_only_methods_reject_others() {
        for i in 0..4 {
            setup(self_id(), 10 * NEAR);
            let mut c = contract();
            let err = try_admin(&mut c, acc("stranger.test.near"), NEAR / 20, i).unwrap_err();
            assert!(err.contains("Arrow: E14 self-only method"), "method {i}: {err}");
            // the outlayer and intents contracts are not the owner either
            let err = try_admin(&mut c, intents(), NEAR / 20, i).unwrap_err();
            assert!(err.contains("E14"), "method {i}: {err}");
        }
    }

    #[test]
    fn self_only_methods_accept_self() {
        for i in 0..4 {
            setup(self_id(), 10 * NEAR);
            let mut c = contract();
            assert_eq!(try_admin(&mut c, self_id(), NEAR / 20, i), Ok(()), "method {i}");
        }
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        c.set_paused(true);
        assert!(c.paused);
        c.set_config(ConfigPatch { fee_bps_sale: Some(300), listing_bond: Some(U128(1)), ..Default::default() });
        assert_eq!((c.cfg.fee_bps_sale, c.cfg.listing_bond.0, c.cfg.fee_bps_eval), (300, 1, 1000));
    }

    #[test]
    fn init_program_key_forwards_whole_deposit() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        setup_with_deposit(self_id(), 10 * NEAR, NEAR / 20);
        let _ = c.init_program_key();
        let all = calls();
        let (to, _, args, dep) = all.iter().find(|(_, m, _, _)| m == "request_execution").expect("request_execution receipt");
        assert_eq!((to.as_str(), *dep), ("outlayer.test.near", NEAR / 20));
        assert_eq!(args["input_data"], json!(r#"{"v":1,"action":"derive"}"#));
        assert_eq!(args["resource_limits"], json!({"max_instructions":2_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":30}));
        assert!(all.iter().any(|(to, m, _, _)| to == "arrow.test.near" && m == "on_program_key"));
    }

    #[test]
    #[should_panic(expected = "Arrow: E08 amount below required")]
    fn init_program_key_needs_release_deposit() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        setup_with_deposit(self_id(), 10 * NEAR, NEAR / 100 - 1);
        let _ = c.init_program_key();
    }

    #[test]
    fn on_program_key_sets_valid_pk() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        c.program_pubkey = None;
        let pk = format!("04{}", "ab".repeat(64));
        callback_env(PromiseResult::Successful(json!({"v":1,"ok":true,"pk":pk}).to_string().into_bytes()));
        c.on_program_key();
        assert_eq!(c.program_pubkey, Some(pk));
        assert!(get_logs().contains(&"arrow: program key set".to_string()));
    }

    #[test]
    fn on_program_key_rejects_bad_pk() {
        let cases: Vec<(PromiseResult, &str)> = vec![
            (PromiseResult::Successful(json!({"v":1,"ok":true,"pk":format!("05{}", "ab".repeat(64))}).to_string().into_bytes()), "bad_output"),
            (PromiseResult::Successful(json!({"v":1,"ok":true,"pk":"ab".repeat(64)}).to_string().into_bytes()), "bad_output"),
            (PromiseResult::Successful(json!({"v":1,"ok":true,"pk":format!("04{}", "AB".repeat(64))}).to_string().into_bytes()), "bad_output"),
            (PromiseResult::Successful(b"null".to_vec()), "null"),
            (PromiseResult::Failed, "null"),
            (PromiseResult::Successful(br#"{"v":1,"ok":false}"#.to_vec()), "not_ok"),
        ];
        for (result, reason) in cases {
            setup(self_id(), 10 * NEAR);
            let mut c = contract();
            let before = c.program_pubkey.clone();
            callback_env(result);
            c.on_program_key();
            assert_eq!(c.program_pubkey, before, "{reason}");
            assert!(get_logs().contains(&format!("arrow: program key derive failed: {reason}")), "{reason}");
        }
    }

    #[test]
    fn set_program_clears_pubkey() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        assert!(c.program_pubkey.is_some());
        c.set_program("https://example.test/v2.wasm".into(), "ef".repeat(32));
        assert_eq!((c.program_pubkey.clone(), c.cfg.program_wasm_hash.clone()), (None, "ef".repeat(32)));
        for (url, hash, field) in [("http://x.test/a.wasm", "ef".repeat(32), "program_wasm_url"), ("https://x.test/a.wasm", "EF".repeat(32), "program_wasm_hash")] {
            let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_program(url.into(), hash.clone()))).map_err(panic_text).unwrap_err();
            assert!(err.contains(&format!("Arrow: E15 bad config: {field}")), "{err}");
        }
    }

    #[test]
    fn set_config_validates() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        let before = c.cfg.clone();
        for (patch, field) in [
            (ConfigPatch { fee_bps_eval: Some(10_001), ..Default::default() }, "fee_bps"),
            (ConfigPatch { max_evals_cap: Some(501), ..Default::default() }, "max_evals_cap"),
            (ConfigPatch { min_price: Some(U128(0)), ..Default::default() }, "min_amounts"),
        ] {
            let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_config(patch))).map_err(panic_text).unwrap_err();
            assert!(err.contains(&format!("Arrow: E15 bad config: {field}")), "{err}");
        }
        assert_eq!(c.cfg, before);
    }

    #[test]
    fn set_config_rejects_network_fields() {
        let patch = r#"{"outlayer":"evil.test.near"}"#;
        assert!(serde_json::from_str::<ConfigPatch>(patch).is_err());
    }

    #[cfg(not(feature = "testnet"))]
    #[test]
    #[should_panic(expected = "Arrow: E15 bad config: testnet_caps")]
    fn set_config_cannot_add_caps_on_mainnet() {
        setup(self_id(), 10 * NEAR);
        let mut c = contract();
        c.set_config(ConfigPatch { testnet_caps: Some(crate::types::TestnetCaps { per_account_per_day: 1, global_per_day: 1, exempt: vec![] }), ..Default::default() });
    }
}
