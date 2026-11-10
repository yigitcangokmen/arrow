//! Sandbox setup for `tests/sandbox.rs`. The contracts are loaded from prebuilt wasm
//! (`bash scripts/build-contracts.sh --sandbox`), because near-workspaces cannot pass
//! features or env to its own compile step.
//!
//! Accounts: `outlayer.test.near` (mock-outlayer), `intents.test.near` (mock-outlayer as an
//! `mt_transfer` recorder, mainnet only), `usd.test.near` (arrow-usd, testnet only),
//! `arrow.test.near` (the variant under test, 30 NEAR), `seller`, `buyer`, `buyer2`,
//! `treasury`, `stranger`, `bench` (10 NEAR each).
//! On the mainnet rail the payers are eth-implicit ids (`0x1111…` seller, `0x2222…` buyer):
//! `intents.test.near` calls `arrow.mt_on_transfer` directly and the test reads its return.
//! On the testnet rail the payers sign `usd.ft_transfer_call` themselves.

#![allow(dead_code)]

use std::future::IntoFuture;
use std::time::{Duration, Instant};

use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_workspaces::network::Sandbox;
use near_workspaces::operations::{CallTransaction, TransactionStatus};
use near_workspaces::result::{ExecutionFinalResult, ExecutionOutcome, ValueOrReceiptId};
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

pub type R<T> = Result<T, Box<dyn std::error::Error>>;

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const USDC_MAINNET: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
pub const BOND: u128 = 100_000;
pub const EVAL_FEE: u128 = 50_000;
pub const PRICE: u128 = 2_000_000;
/// What a failed eval costs the buyer: the treasury's `fee_bps_eval` (init template: 1000) share of the fee (ARW-C2).
pub const EVAL_FAIL_KEEP: u128 = EVAL_FEE * 1000 / 10_000;
/// What a failed eval of `EVAL_FEE` gives back.
pub const EVAL_REFUND: u128 = EVAL_FEE - EVAL_FAIL_KEEP;
pub const MINT: u128 = 10_000_000; // arrow-usd per-call cap
pub const BITS_SCORED: u64 = 5673;
pub const BITS_VERDICT: u64 = 1585;

pub fn blob_sha() -> String {
    "cd".repeat(32)
}

pub fn buyer_pk() -> String {
    format!("04{}", "33".repeat(64))
}

pub fn b64_len(s: &str) -> usize {
    STANDARD.decode(s).map(|v| v.len()).unwrap_or(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    Mainnet,
    Testnet,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    Notify,
    Escrow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Who {
    Seller,
    Buyer,
    Buyer2,
    Bench,
}

pub fn variant(net: Net, path: Path) -> &'static str {
    match (net, path) {
        (Net::Mainnet, Path::Notify) => "arrow-mainnet",
        (Net::Mainnet, Path::Escrow) => "arrow-mainnet-escrow",
        (Net::Testnet, Path::Notify) => "arrow-testnet",
        (Net::Testnet, Path::Escrow) => "arrow-testnet-escrow",
    }
}

pub fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../../target/wasm/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing target/wasm/{name}.wasm — run: bash scripts/build-contracts.sh --sandbox"))
}

/// `scripts/deploy/init-<net>.json` with the sandbox accounts patched in.
pub fn init_cfg(net: Net, arrow: &str, root: &str) -> Value {
    let file = match net {
        Net::Mainnet => "init-mainnet.json",
        Net::Testnet => "init-testnet.json",
    };
    let raw = std::fs::read_to_string(format!("{}/../../scripts/deploy/{file}", env!("CARGO_MANIFEST_DIR"))).expect("init template");
    let mut cfg: Value = serde_json::from_str(&raw).expect("init template json");
    cfg["outlayer"] = json!(format!("outlayer.{root}"));
    cfg["treasury"] = json!(format!("treasury.{root}"));
    cfg["secrets_ref"]["account_id"] = json!(arrow);
    cfg["program_wasm_url"] = json!("https://example.test/arrow-tee.wasm");
    cfg["program_wasm_hash"] = json!("ab".repeat(32));
    match net {
        Net::Mainnet => {
            cfg["intents"] = json!(format!("intents.{root}"));
            cfg["usdc_token_id"] = json!(USDC_MAINNET);
        }
        Net::Testnet => {
            cfg["usdc_token_id"] = json!(format!("usd.{root}"));
            cfg["testnet_caps"]["exempt"] = json!([format!("bench.{root}")]);
        }
    }
    cfg
}

pub fn list_msg(mode: &str, mock: Option<&str>, max_evals: u32) -> Value {
    let q = mock.map(|m| format!("?mock={m}")).unwrap_or_default();
    json!({
        "op": "list",
        "title": "Sandbox listing (synthetic)",
        "public_desc": "Synthetic rows for the sandbox suite.",
        "columns": ["date", "sku", "units"],
        "rows_claimed": 1000,
        "blob_url": format!("https://b.test/{}.bin{q}", blob_sha()),
        "blob_sha256": blob_sha(),
        "sealed_k": STANDARD.encode([7u8; 193]),
        "price": PRICE.to_string(),
        "eval_fee": EVAL_FEE.to_string(),
        "max_evals": max_evals,
        "mode": mode,
    })
}

pub fn eval_msg(listing_id: u64) -> Value {
    json!({"op": "eval", "listing_id": listing_id, "sealed_criteria": STANDARD.encode([9u8; 200]), "buyer_pk": buyer_pk()})
}

pub fn buy_msg(listing_id: u64) -> Value {
    json!({"op": "buy", "listing_id": listing_id, "buyer_pk": buyer_pk()})
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub net: Net,
    pub path: Path,
    pub root: Account,
    pub arrow: Contract,
    pub mock: Contract,
    pub intents: Option<Contract>,
    pub usd: Option<Contract>,
    pub seller: Account,
    pub buyer: Account,
    pub buyer2: Account,
    pub bench: Account,
    pub treasury: Account,
    pub stranger: Account,
}

pub async fn sub(root: &Account, name: &str, near: u128) -> R<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

pub async fn deploy(acc: &Account, code: &[u8], args: Value) -> R<Contract> {
    let c = acc.deploy(code).await?.into_result()?;
    c.call("new").args_json(args).transact().await?.into_result()?;
    Ok(c)
}

/// Deploys `variant` on `<name>.<root>` with the `net` init template; does not derive the program key.
pub async fn deploy_arrow(root: &Account, name: &str, variant: &str, net: Net) -> R<Contract> {
    let acc = sub(root, name, 30).await?;
    let cfg = init_cfg(net, acc.id().as_str(), root.id().as_str());
    deploy(&acc, &wasm(variant), json!({ "cfg": cfg })).await
}

pub async fn setup(net: Net, path: Path) -> R<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mock_wasm = wasm("mock-outlayer");
    let mock = deploy(&sub(&root, "outlayer", 10).await?, &mock_wasm, json!({})).await?;
    let intents = match net {
        Net::Mainnet => Some(deploy(&sub(&root, "intents", 10).await?, &mock_wasm, json!({})).await?),
        Net::Testnet => None,
    };
    let usd = match net {
        Net::Testnet => Some(deploy(&sub(&root, "usd", 10).await?, &wasm("arrow-usd"), json!({})).await?),
        Net::Mainnet => None,
    };
    let arrow = deploy_arrow(&root, "arrow", variant(net, path), net).await?;
    let seller = sub(&root, "seller", 10).await?;
    let buyer = sub(&root, "buyer", 10).await?;
    let buyer2 = sub(&root, "buyer2", 10).await?;
    let bench = sub(&root, "bench", 10).await?;
    let treasury = sub(&root, "treasury", 10).await?;
    let stranger = sub(&root, "stranger", 10).await?;
    let e = Env { worker, net, path, root, arrow, mock, intents, usd, seller, buyer, buyer2, bench, treasury, stranger };
    if net == Net::Testnet {
        for who in [Who::Seller, Who::Buyer, Who::Buyer2, Who::Bench] {
            e.mint(who, MINT).await?;
        }
    }
    let out = e.init_program_key().await?;
    assert!(out.is_success(), "init_program_key: {out:?}");
    let pk: Option<String> = e.view("program_pubkey", json!({})).await?;
    assert_eq!(pk.map(|p| p.len()), Some(130), "program key not set");
    Ok(e)
}

impl Env {
    pub fn usd(&self) -> &Contract {
        self.usd.as_ref().expect("testnet env")
    }

    pub fn intents(&self) -> &Contract {
        self.intents.as_ref().expect("mainnet env")
    }

    pub fn account(&self, who: Who) -> &Account {
        match who {
            Who::Seller => &self.seller,
            Who::Buyer => &self.buyer,
            Who::Buyer2 => &self.buyer2,
            Who::Bench => &self.bench,
        }
    }

    /// The payer's id as the contract sees it: eth-implicit on the mainnet rail, the account on testnet.
    pub fn id(&self, who: Who) -> String {
        match self.net {
            Net::Mainnet => {
                let digit = match who {
                    Who::Seller => '1',
                    Who::Buyer => '2',
                    Who::Buyer2 => '3',
                    Who::Bench => '4',
                };
                format!("0x{}", std::iter::repeat_n(digit, 40).collect::<String>())
            }
            Net::Testnet => self.account(who).id().to_string(),
        }
    }

    pub fn treasury_id(&self) -> String {
        self.treasury.id().to_string()
    }

    pub async fn mint(&self, who: Who, amount: u128) -> R<()> {
        let acc = self.account(who);
        acc.call(self.usd().id(), "mint")
            .args_json(json!({"receiver_id": acc.id(), "amount": amount.to_string()}))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// A payment carrying `msg`: `intents → arrow.mt_on_transfer` (mainnet) or `ft_transfer_call` (testnet).
    pub fn pay(&self, who: Who, amount: u128, msg: &Value) -> CallTransaction {
        match self.net {
            Net::Mainnet => self.mt_call(&self.id(who), USDC_MAINNET, amount, msg),
            Net::Testnet => self
                .account(who)
                .call(self.usd().id(), "ft_transfer_call")
                .args_json(json!({"receiver_id": self.arrow.id(), "amount": amount.to_string(), "msg": msg.to_string()}))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(300)),
        }
    }

    pub fn mt_call(&self, sender: &str, token: &str, amount: u128, msg: &Value) -> CallTransaction {
        self.intents()
            .as_account()
            .call(self.arrow.id(), "mt_on_transfer")
            .args_json(json!({
                "sender_id": sender,
                "previous_owner_ids": [sender],
                "token_ids": [token],
                "amounts": [amount.to_string()],
                "msg": msg.to_string(),
            }))
            .gas(Gas::from_tgas(300))
    }

    /// Lists with a bond of exactly `BOND` and returns the new listing id.
    pub async fn list(&self, mode: &str, mock: Option<&str>, max_evals: u32) -> R<u64> {
        let out = self.pay(Who::Seller, BOND, &list_msg(mode, mock, max_evals)).transact().await?;
        assert!(out.receipt_failures().is_empty(), "list failed: {out:?}");
        assert_eq!(unused(&out, &self.arrow), Some(0), "list returned an unused amount");
        let ev = events(&out).into_iter().find(|e| e["event"] == "arrow_listed").expect("arrow_listed");
        Ok(ev["data"]["listing_id"].as_u64().expect("listing_id"))
    }

    pub async fn eval(&self, who: Who, listing_id: u64, amount: u128) -> R<ExecutionFinalResult> {
        Ok(self.pay(who, amount, &eval_msg(listing_id)).transact().await?)
    }

    pub async fn buy(&self, who: Who, listing_id: u64, amount: u128) -> R<ExecutionFinalResult> {
        Ok(self.pay(who, amount, &buy_msg(listing_id)).transact().await?)
    }

    pub async fn self_call(&self, method: &str, args: Value) -> R<ExecutionFinalResult> {
        Ok(self.arrow.as_account().call(self.arrow.id(), method).args_json(args).gas(Gas::from_tgas(300)).transact().await?)
    }

    pub async fn init_program_key(&self) -> R<ExecutionFinalResult> {
        Ok(self
            .arrow
            .as_account()
            .call(self.arrow.id(), "init_program_key")
            .deposit(NearToken::from_millinear(50))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    /// Escrow relayer role: any account may call `request_eval` / `request_release`.
    pub async fn relay(&self, method: &str, id_field: &str, id: u64) -> R<ExecutionFinalResult> {
        Ok(self
            .stranger
            .call(self.arrow.id(), method)
            .args_json(json!({ id_field: id }))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    pub async fn view<T: near_sdk::serde::de::DeserializeOwned>(&self, method: &str, args: Value) -> R<T> {
        Ok(self.arrow.view(method).args_json(args).await?.json()?)
    }

    pub async fn get_eval(&self, id: u64) -> R<Value> {
        self.view("get_eval", json!({"eval_id": id})).await
    }

    pub async fn get_purchase(&self, id: u64) -> R<Value> {
        self.view("get_purchase", json!({"purchase_id": id})).await
    }

    pub async fn leak(&self, listing_id: u64) -> R<Value> {
        self.view("leak_budget", json!({"listing_id": listing_id})).await
    }

    pub async fn tank(&self) -> R<u128> {
        let c: Value = self.view("get_config", json!({})).await?;
        Ok(c["tank_available"].as_str().expect("tank_available").parse()?)
    }

    pub async fn ft_balance(&self, account: &str) -> R<u128> {
        let s: String = self.usd().view("ft_balance_of").args_json(json!({"account_id": account})).await?.json()?;
        Ok(s.parse()?)
    }

    /// Mainnet rail: every `mt_transfer` the contract sent to the intents mock.
    pub async fn transfers(&self) -> R<Vec<Value>> {
        Ok(self.intents().view("transfers").await?.json()?)
    }

    /// USDC units `account` received from the contract: intents transfers (mainnet) or the
    /// arrow-usd balance (testnet; compare against a snapshot taken before).
    pub async fn usdc_of(&self, account: &str) -> R<u128> {
        match self.net {
            Net::Mainnet => Ok(self
                .transfers()
                .await?
                .iter()
                .filter(|t| t["receiver_id"] == account)
                .map(|t| t["amount"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0))
                .sum()),
            Net::Testnet => self.ft_balance(account).await,
        }
    }

    pub async fn pending(&self) -> R<u32> {
        Ok(self.mock.view("pending").await?.json()?)
    }

    /// Waits until the mock holds `n` yields (the request is on chain).
    pub async fn wait_pending(&self, n: u32) -> R<()> {
        let start = Instant::now();
        while self.pending().await? < n {
            assert!(start.elapsed() < Duration::from_secs(30), "request never reached the mock");
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        Ok(())
    }

    /// Waits until the mock holds the yield, then skips past the 200-block window (trap 10).
    pub async fn time_out(&self, status: TransactionStatus) -> R<ExecutionFinalResult> {
        self.wait_pending(1).await?;
        self.worker.fast_forward(210).await?;
        let out = tokio::time::timeout(Duration::from_secs(60), status.into_future()).await??;
        Ok(out)
    }
}

/// Every NEP-297 event in the transaction, parsed.
pub fn events(out: &ExecutionFinalResult) -> Vec<Value> {
    out.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).expect("event json"))
        .collect()
}

pub fn refund_reason(out: &ExecutionFinalResult) -> Option<String> {
    events(out)
        .into_iter()
        .find(|e| e["event"] == "arrow_refund")
        .and_then(|e| e["data"]["reason"].as_str().map(str::to_string))
}

fn value_of(o: &ExecutionOutcome) -> Option<Vec<u8>> {
    match o.clone().into_result() {
        Ok(ValueOrReceiptId::Value(v)) => v.raw_bytes().ok().filter(|b| !b.is_empty()),
        _ => None,
    }
}

/// The last non-empty value an arrow receipt returned: the notification itself (list, escrow)
/// or the `on_eval` / `on_release` callback. Plain NEAR refunds to arrow return nothing.
pub fn arrow_return(out: &ExecutionFinalResult, arrow: &Contract) -> Option<Value> {
    out.receipt_outcomes()
        .iter()
        .filter(|o| &o.executor_id == arrow.id())
        .rev()
        .find_map(value_of)
        .map(|b| serde_json::from_slice(&b).expect("arrow returned json"))
}

/// The unused amount in either resolver shape (`["n"]` or `"n"`); None for `null` / nothing.
pub fn unused(out: &ExecutionFinalResult, arrow: &Contract) -> Option<u128> {
    match arrow_return(out, arrow)? {
        Value::Array(a) if a.len() == 1 => a[0].as_str().and_then(|s| s.parse().ok()),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Some receipt panicked with `Arrow: <code>` (the whole tx fails on the mainnet rail; on the
/// testnet rail NEP-141 refunds and the tx itself succeeds).
pub fn assert_panicked(out: &ExecutionFinalResult, code: &str) {
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains(&format!("Arrow: {code}")), "expected Arrow: {code}, got {failures}");
}

/// Gas burnt by the arrow receipt whose logs contain `needle`, in TGas.
pub fn arrow_gas(out: &ExecutionFinalResult, arrow: &Contract, needle: &str) -> Option<f64> {
    out.receipt_outcomes()
        .iter()
        .filter(|o| &o.executor_id == arrow.id())
        .find(|o| o.logs.iter().any(|l| l.contains(needle)))
        .map(|o| o.gas_burnt.as_gas() as f64 / 1e12)
}
