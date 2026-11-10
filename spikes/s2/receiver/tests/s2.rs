//! S2 gate, sandbox part: (3) OutLayer `null` -> refund + arrow_refund, (4) yield timeout -> refund,
//! plus the plain NEP-141 refund_all / keep behaviour. Uses prebuilt wasm files:
//!   cargo near build non-reproducible-wasm --manifest-path contracts/arrow-usd/Cargo.toml --no-abi --locked --out-dir target/near/variants/arrow-usd
//!   cargo near build non-reproducible-wasm --manifest-path contracts/mock-outlayer/Cargo.toml --no-abi --locked --out-dir target/near/variants/mock-outlayer
//!   cargo near build non-reproducible-wasm --manifest-path spikes/s2/receiver/Cargo.toml --no-abi --out-dir spikes/s2/receiver/target/near/s2-receiver

use std::future::IntoFuture;
use std::time::{Duration, Instant};

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

type R<T> = Result<T, Box<dyn std::error::Error>>;

const AMOUNT: &str = "100000";

fn wasm(rel: &str, build: &str) -> Vec<u8> {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}; build it first: {build}"))
}

struct Env {
    worker: Worker<Sandbox>,
    usd: Contract,
    mock: Contract,
    recv: Contract,
    buyer: Account,
    intents: Account,
}

async fn sub(root: &Account, name: &str, near: u128) -> R<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

async fn deploy(acc: &Account, code: &[u8], args: serde_json::Value) -> R<Contract> {
    let c = acc.deploy(code).await?.into_result()?;
    c.call("new").args_json(args).transact().await?.into_result()?;
    Ok(c)
}

async fn setup() -> R<Env> {
    let usd_wasm = wasm("../../../target/near/variants/arrow-usd/arrow_usd.wasm", "cargo near build ... contracts/arrow-usd (see file header)");
    let mock_wasm = wasm("../../../target/near/variants/mock-outlayer/mock_outlayer.wasm", "cargo near build ... contracts/mock-outlayer (see file header)");
    let recv_wasm = wasm("target/near/s2-receiver/s2_receiver.wasm", "cargo near build ... spikes/s2/receiver (see file header)");
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let usd = deploy(&sub(&root, "usd", 10).await?, &usd_wasm, json!({})).await?;
    let mock = deploy(&sub(&root, "outlayer", 10).await?, &mock_wasm, json!({})).await?;
    let recv = deploy(&sub(&root, "s2", 10).await?, &recv_wasm, json!({"outlayer": mock.id()})).await?;
    let buyer = sub(&root, "buyer", 10).await?;
    let intents = sub(&root, "intents", 10).await?;
    buyer
        .call(usd.id(), "mint")
        .args_json(json!({"receiver_id": buyer.id(), "amount": "10000000"}))
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, usd, mock, recv, buyer, intents })
}

async fn balance(e: &Env, who: &Account) -> R<u128> {
    let s: String = e.usd.view("ft_balance_of").args_json(json!({"account_id": who.id()})).await?.json()?;
    Ok(s.parse()?)
}

async fn recv_balance(e: &Env) -> R<u128> {
    let s: String = e.usd.view("ft_balance_of").args_json(json!({"account_id": e.recv.id()})).await?.json()?;
    Ok(s.parse()?)
}

fn ft_call(e: &Env, msg: &str) -> near_workspaces::operations::CallTransaction {
    e.buyer
        .call(e.usd.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": e.recv.id(), "amount": AMOUNT, "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(300))
}

fn mt_call(e: &Env, msg: &str) -> near_workspaces::operations::CallTransaction {
    e.intents
        .call(e.recv.id(), "mt_on_transfer")
        .args_json(json!({
            "sender_id": e.buyer.id(),
            "previous_owner_ids": [e.buyer.id()],
            "token_ids": ["nep141:usdc.test.near"],
            "amounts": [AMOUNT],
            "msg": msg,
        }))
        .gas(Gas::from_tgas(300))
}

fn assert_refund_event(out: &ExecutionFinalResult) {
    let logs = out.logs();
    assert!(
        logs.iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains(r#""event":"arrow_refund""#) && l.contains(r#""reason":"null""#)),
        "no arrow_refund{{reason:null}} in {logs:?}"
    );
}

/// Waits for the mock to hold the yield, then skips past the 200-block window.
async fn time_out(e: &Env, status: near_workspaces::operations::TransactionStatus) -> R<ExecutionFinalResult> {
    let start = Instant::now();
    loop {
        let pending: u32 = e.mock.view("pending").await?.json()?;
        if pending >= 1 {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(20), "request never reached the mock");
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    e.worker.fast_forward(210).await?;
    let out = tokio::time::timeout(Duration::from_secs(60), status.into_future()).await??;
    let pending: u32 = e.mock.view("pending").await?.json()?;
    assert_eq!(pending, 0, "yield callback did not run");
    Ok(out)
}

#[tokio::test]
async fn s2_ft_refund_all() -> R<()> {
    let e = setup().await?;
    let b0 = balance(&e, &e.buyer).await?;
    let out = ft_call(&e, "refund_all").transact().await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(balance(&e, &e.buyer).await?, b0);
    assert_eq!(recv_balance(&e).await?, 0);
    Ok(())
}

#[tokio::test]
async fn s2_ft_keep() -> R<()> {
    let e = setup().await?;
    let b0 = balance(&e, &e.buyer).await?;
    let out = ft_call(&e, "keep").transact().await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(balance(&e, &e.buyer).await?, b0 - 100_000);
    assert_eq!(recv_balance(&e).await?, 100_000);
    Ok(())
}

#[tokio::test]
async fn s2_ft_refund_on_null() -> R<()> {
    let e = setup().await?;
    let b0 = balance(&e, &e.buyer).await?;
    let out = ft_call(&e, "outlayer:https://b.test/x.bin?mock=null").transact().await?;
    assert!(out.is_success(), "{out:?}");
    assert_refund_event(&out);
    assert_eq!(balance(&e, &e.buyer).await?, b0);
    assert_eq!(recv_balance(&e).await?, 0);
    Ok(())
}

#[tokio::test]
async fn s2_ft_refund_on_yield_timeout() -> R<()> {
    let e = setup().await?;
    let b0 = balance(&e, &e.buyer).await?;
    let status = ft_call(&e, "outlayer:https://b.test/x.bin?mock=never").transact_async().await?;
    let out = time_out(&e, status).await?;
    assert!(out.is_success(), "{out:?}");
    assert_refund_event(&out);
    assert_eq!(balance(&e, &e.buyer).await?, b0);
    assert_eq!(recv_balance(&e).await?, 0);
    Ok(())
}

#[tokio::test]
async fn s2_mt_refund_on_null() -> R<()> {
    let e = setup().await?;
    let out = mt_call(&e, "outlayer:https://b.test/x.bin?mock=null").transact().await?;
    assert_refund_event(&out);
    assert_eq!(out.json::<Vec<String>>()?, vec![AMOUNT.to_string()]);
    Ok(())
}

#[tokio::test]
async fn s2_mt_refund_on_yield_timeout() -> R<()> {
    let e = setup().await?;
    let status = mt_call(&e, "outlayer:https://b.test/x.bin?mock=never").transact_async().await?;
    let out = time_out(&e, status).await?;
    assert_refund_event(&out);
    assert_eq!(out.json::<Vec<String>>()?, vec![AMOUNT.to_string()]);
    Ok(())
}
