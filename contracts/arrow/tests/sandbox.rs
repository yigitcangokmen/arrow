//! Sandbox suite (K1, DEC H-20): real promise chains, NEP-141 / intents refund shapes, yield
//! timeout, gas, storage and in-flight state that unit tests cannot see.
//!
//!   bash scripts/build-contracts.sh --sandbox
//!   cargo test -p arrow --test sandbox -- --test-threads=4
//!
//! Every test opens its own sandbox. Mock modes come from `?mock=<mode>` in the listing's
//! blob_url (both eval and release of that listing use it).

mod common;

use common::*;
use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

async fn matrix(net: Net, mode: &str, bits: u64) -> R<()> {
    let e = setup(net, Path::Notify).await?;
    let seller = e.id(Who::Seller);
    let buyer = e.id(Who::Buyer);
    let treasury = e.treasury_id();
    let (s0, t0, b0) = (e.usdc_of(&seller).await?, e.usdc_of(&treasury).await?, e.usdc_of(&buyer).await?);

    let id = e.list(mode, None, 50).await?;
    assert_eq!(e.usdc_of(&treasury).await? - t0, BOND, "bond goes to the treasury");
    let s1 = e.usdc_of(&seller).await?;

    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(unused(&out, &e.arrow), Some(0));
    let ev = e.get_eval(1).await?;
    assert_eq!((ev["status"].as_str(), ev["h"].as_str()), (Some("done"), Some(blob_sha().as_str())));
    assert_eq!(b64_len(ev["sealed_result"].as_str().unwrap_or("")), 98);

    let out = e.buy(Who::Buyer, id, PRICE).await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(unused(&out, &e.arrow), Some(0));
    let p = e.get_purchase(1).await?;
    assert_eq!((p["status"].as_str(), p["h"].as_str()), (Some("done"), Some(blob_sha().as_str())));
    assert_eq!(b64_len(p["sealed_k_buyer"].as_str().unwrap_or("")), 129);

    let lb = e.leak(id).await?;
    assert_eq!((lb["bits_per_eval_milli"].as_u64(), lb["evals_used"].as_u64()), (Some(bits), Some(1)));
    assert_eq!((lb["budget_milli"].as_u64(), lb["spent_milli"].as_u64()), (Some(50 * bits), Some(bits)));

    // 90/10 of 50000 and 98/2 of 2_000_000.
    assert_eq!(e.usdc_of(&seller).await? - s1, 45_000 + 1_960_000);
    assert_eq!(e.usdc_of(&treasury).await? - t0, BOND + 5_000 + 40_000);
    if net == Net::Testnet {
        assert_eq!(s0 - s1, BOND);
        assert_eq!(b0 - e.usdc_of(&buyer).await?, EVAL_FEE + PRICE);
        assert_eq!(e.ft_balance(e.arrow.id().as_str()).await?, 0, "arrow keeps nothing");
    }
    Ok(())
}

#[tokio::test]
async fn matrix_mainnet_scored() -> R<()> {
    matrix(Net::Mainnet, "scored", BITS_SCORED).await
}

#[tokio::test]
async fn matrix_mainnet_verdict() -> R<()> {
    matrix(Net::Mainnet, "verdict", BITS_VERDICT).await
}

#[tokio::test]
async fn matrix_testnet_scored() -> R<()> {
    matrix(Net::Testnet, "scored", BITS_SCORED).await
}

#[tokio::test]
async fn matrix_testnet_verdict() -> R<()> {
    matrix(Net::Testnet, "verdict", BITS_VERDICT).await
}

// ---------------------------------------------------------------- refunds

/// The eval was refunded for `reason` and the callback returned `amount` as unused.
async fn assert_eval_refunded(e: &Env, out: &near_workspaces::result::ExecutionFinalResult, eval_id: u64, reason: &str, amount: u128) -> R<()> {
    assert_eq!(refund_reason(out).as_deref(), Some(reason), "{out:?}");
    assert_eq!(unused(out, &e.arrow), Some(amount));
    let ev = e.get_eval(eval_id).await?;
    assert_eq!((ev["status"].as_str(), ev["refund_reason"].as_str()), (Some("refunded"), Some(reason)));
    Ok(())
}

async fn assert_buy_refunded(e: &Env, out: &near_workspaces::result::ExecutionFinalResult, purchase_id: u64, reason: &str, amount: u128) -> R<()> {
    assert_eq!(refund_reason(out).as_deref(), Some(reason), "{out:?}");
    assert_eq!(unused(out, &e.arrow), Some(amount));
    let p = e.get_purchase(purchase_id).await?;
    assert_eq!((p["status"].as_str(), p["refund_reason"].as_str()), (Some("refunded"), Some(reason)));
    assert!(p["sealed_k_buyer"].is_null());
    Ok(())
}

async fn refund_on_null(net: Net) -> R<()> {
    let e = setup(net, Path::Notify).await?;
    let id = e.list("scored", Some("null"), 10).await?;
    let (seller, buyer, treasury) = (e.id(Who::Seller), e.id(Who::Buyer), e.treasury_id());
    let (s0, b0, t0) = (e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?, e.usdc_of(&treasury).await?);
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eval_refunded(&e, &out, 1, "null", EVAL_REFUND).await?;
    if net == Net::Mainnet {
        assert_eq!(out.json::<Vec<String>>()?, vec![EVAL_REFUND.to_string()], "intents resolver refunds this");
    }
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(1), "budget is never given back");
    // ARW-C2: no seller payout; the treasury keeps its share, the buyer gets the rest back.
    assert_eq!(e.usdc_of(&treasury).await? - t0, EVAL_FAIL_KEEP, "treasury share of a failed eval");
    let b1 = if net == Net::Testnet { b0 - EVAL_FAIL_KEEP } else { b0 };
    assert_eq!((e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?), (s0, b1), "no payout, buyer short only the treasury share");
    Ok(())
}

#[tokio::test]
async fn refund_on_null_result() -> R<()> {
    refund_on_null(Net::Mainnet).await
}

#[tokio::test]
async fn refund_on_null_result_ft() -> R<()> {
    refund_on_null(Net::Testnet).await
}

#[tokio::test]
async fn refund_on_yield_timeout() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("never"), 10).await?;
    let status = e.pay(Who::Buyer, EVAL_FEE, &eval_msg(id)).transact_async().await?;
    let out = e.time_out(status).await?;
    assert_eval_refunded(&e, &out, 1, "null", EVAL_REFUND).await?;
    assert_eq!(out.json::<Vec<String>>()?, vec![EVAL_REFUND.to_string()]);
    assert_eq!(e.pending().await?, 0, "yield callback did not run");
    Ok(())
}

#[tokio::test]
async fn refund_on_late_guard() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("late"), 10).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eval_refunded(&e, &out, 1, "not_ok", EVAL_REFUND).await?;
    let out = e.buy(Who::Buyer, id, PRICE).await?;
    assert_buy_refunded(&e, &out, 1, "not_ok", PRICE).await?;
    Ok(())
}

#[tokio::test]
async fn hash_mismatch_refunds() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Notify).await?;
        let id = e.list("scored", Some("badhash"), 10).await?;
        let (seller, buyer) = (e.id(Who::Seller), e.id(Who::Buyer));
        let (s0, b0) = (e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?);
        let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
        assert_eval_refunded(&e, &out, 1, "hash_mismatch", EVAL_REFUND).await?;
        assert!(e.get_eval(1).await?["sealed_result"].is_null());
        let b1 = if net == Net::Testnet { b0 - EVAL_FAIL_KEEP } else { b0 };
        assert_eq!((e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?), (s0, b1), "{net:?}: seller paid or buyer short");
    }
    Ok(())
}

#[tokio::test]
async fn hash_mismatch_refunds_on_release() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Notify).await?;
        let id = e.list("scored", Some("badhash"), 10).await?;
        let (seller, buyer) = (e.id(Who::Seller), e.id(Who::Buyer));
        let (s0, b0) = (e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?);
        let out = e.buy(Who::Buyer, id, PRICE).await?;
        assert_buy_refunded(&e, &out, 1, "hash_mismatch", PRICE).await?;
        assert_eq!((e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?), (s0, b0), "{net:?}: seller paid or buyer short");
    }
    Ok(())
}

#[tokio::test]
async fn bad_output_refunds() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    for (i, mode) in ["garbage", "wrongv", "shortr"].into_iter().enumerate() {
        let id = e.list("scored", Some(mode), 10).await?;
        let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
        assert_eval_refunded(&e, &out, i as u64 + 1, "bad_output", EVAL_REFUND).await?;
    }
    Ok(())
}

#[tokio::test]
async fn refund_on_outlayer_call_failure() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("panic"), 10).await?;
    let requests: u64 = e.mock.view("requests_count").await?.json()?;
    let t0 = e.tank().await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eval_refunded(&e, &out, 1, "null", EVAL_REFUND).await?;
    let t1 = e.tank().await?;
    // The 0.02 NEAR deposit comes back with the failed receipt; only the eval record's storage is spent.
    assert!(t0.saturating_sub(t1) < NEAR / 100, "tank dropped by {}", t0.saturating_sub(t1));
    assert_eq!(e.mock.view("requests_count").await?.json::<u64>()?, requests, "failed request rolled back");
    Ok(())
}

// ---------------------------------------------------------------- G1 leak budget

#[tokio::test]
async fn budget_counts_in_flight() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("never"), 1).await?;
    let first = e.pay(Who::Buyer, EVAL_FEE, &eval_msg(id)).transact_async().await?;
    e.wait_pending(1).await?;
    let second = e.eval(Who::Buyer2, id, EVAL_FEE).await?;
    assert!(second.is_failure());
    assert_panicked(&second, "E09");
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(1));
    let out = e.time_out(first).await?;
    assert_eval_refunded(&e, &out, 1, "null", EVAL_REFUND).await?;
    let lb = e.leak(id).await?;
    assert_eq!((lb["evals_used"].as_u64(), lb["left_milli"].as_u64()), (Some(1), Some(0)), "refund gave budget back");
    let third = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_panicked(&third, "E09");
    Ok(())
}

/// ARW-C2: a listing holds at most 5 unsettled evals; the 6th panics with E21 before it counts
/// against the budget or reaches OutLayer, and a settled eval frees its slot.
#[tokio::test]
async fn eval_in_flight_cap() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("never"), 20).await?;
    let mut held = Vec::new();
    for n in 1..=5 {
        held.push(e.pay(Who::Buyer, EVAL_FEE, &eval_msg(id)).transact_async().await?);
        e.wait_pending(n).await?;
    }
    let requests: u64 = e.mock.view("requests_count").await?.json()?;
    let out = e.eval(Who::Buyer2, id, EVAL_FEE).await?;
    assert_panicked(&out, "E21 too many evals in flight");
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(5), "a refused eval used budget");
    assert_eq!(e.mock.view("requests_count").await?.json::<u64>()?, requests, "a refused eval reached OutLayer");
    e.worker.fast_forward(210).await?;
    for status in held {
        let out = tokio::time::timeout(std::time::Duration::from_secs(60), std::future::IntoFuture::into_future(status)).await??;
        assert_eq!(refund_reason(&out).as_deref(), Some("null"));
    }
    let next = e.pay(Who::Buyer2, EVAL_FEE, &eval_msg(id)).transact_async().await?;
    e.wait_pending(1).await?;
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(6), "slots were not freed");
    drop(next);
    Ok(())
}

/// ARW-C3: the worker publishes a release output after the 200-block yield window. The callback has
/// already refunded with `null`, and the late output reaches no callback: the refund is final and the
/// seller is not paid. (The late output's tx args are still public; the trust table says so.)
#[tokio::test]
async fn late_publication_after_yield_timeout_is_refused() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("never"), 10).await?;
    let seller = e.id(Who::Seller);
    let k = json!({"v": 1, "ok": true, "k": STANDARD.encode([2u8; 129]), "h": blob_sha()}).to_string();
    let resume = |out: String| e.stranger.call(e.mock.id(), "resume_last").args_json(json!({"output": out})).gas(near_workspaces::types::Gas::from_tgas(50)).transact();

    // Control: published inside the window, the same output settles the purchase.
    let status = e.pay(Who::Buyer, PRICE, &buy_msg(id)).transact_async().await?;
    e.wait_pending(1).await?;
    assert!(resume(k.clone()).await?.json::<bool>()?, "an in-window output did not resume the yield");
    let out = tokio::time::timeout(std::time::Duration::from_secs(60), std::future::IntoFuture::into_future(status)).await??;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(e.get_purchase(1).await?["status"].as_str(), Some("done"));
    e.worker.fast_forward(5).await?;
    let s0 = e.usdc_of(&seller).await?;
    assert_eq!(s0, PRICE * 98 / 100, "the control sale paid the seller 98 %");

    // Late: the yield times out first, then the worker publishes. (Another payer: the same payer
    // and key again would be E22, since the control purchase is done.)
    let status = e.pay(Who::Buyer2, PRICE, &buy_msg(id)).transact_async().await?;
    let out = e.time_out(status).await?;
    assert_buy_refunded(&e, &out, 2, "null", PRICE).await?;
    assert!(!resume(k).await?.json::<bool>()?, "a late output resumed the yield");
    e.worker.fast_forward(5).await?;
    let p = e.get_purchase(2).await?;
    assert_eq!((p["status"].as_str(), p["refund_reason"].as_str()), (Some("refunded"), Some("null")));
    assert!(p["sealed_k_buyer"].is_null() && p["h"].is_null());
    assert_eq!(e.usdc_of(&seller).await?, s0, "seller paid for a refunded purchase");
    Ok(())
}

#[tokio::test]
async fn budget_exhausted_eval_panics_buy_ok() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 1).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eq!(unused(&out, &e.arrow), Some(0));
    let out = e.eval(Who::Buyer2, id, EVAL_FEE).await?;
    assert_panicked(&out, "E09");
    let out = e.buy(Who::Buyer2, id, PRICE).await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(e.get_purchase(1).await?["status"].as_str(), Some("done"));
    Ok(())
}

#[tokio::test]
async fn max_evals() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    for bad in [0, 501] {
        let out = e.pay(Who::Seller, BOND, &list_msg("scored", None, bad)).transact().await?;
        assert_panicked(&out, "E04 bad msg: max_evals");
    }
    let id = e.list("scored", None, 500).await?;
    let lb = e.leak(id).await?;
    assert_eq!((lb["max_evals"].as_u64(), lb["budget_milli"].as_u64()), (Some(500), Some(500 * BITS_SCORED)));
    Ok(())
}

// ---------------------------------------------------------------- entry checks

/// CRY-2 / C-03 / TN-1 / N3: E19 is retired. A squatter who lists the seller's blob_sha256 first,
/// with a junk sealed_k, no longer blocks the seller; a copy is useless because the enclave binds
/// sealed_k to the seller (arrow-tee clone_with_other_seller_is_err refuses it).
#[tokio::test]
async fn squatter_cannot_block_seller() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Notify).await?;
        let mut squat = list_msg("scored", None, 10);
        squat["sealed_k"] = json!(STANDARD.encode([0xEEu8; 193]));
        let out = e.pay(Who::Buyer2, BOND, &squat).transact().await?;
        assert!(out.receipt_failures().is_empty(), "{net:?}: squat failed: {out:?}");
        let id = e.list("scored", None, 10).await?;
        assert_eq!(id, 2, "{net:?}");
        let (a, b): (Value, Value) = (e.view("get_listing", json!({"listing_id": 1})).await?, e.view("get_listing", json!({"listing_id": 2})).await?);
        assert_eq!((a["blob_sha256"].clone(), a["seller"].as_str()), (json!(blob_sha()), Some(e.id(Who::Buyer2).as_str())), "{net:?}");
        assert_eq!((b["blob_sha256"].clone(), b["seller"].as_str()), (json!(blob_sha()), Some(e.id(Who::Seller).as_str())), "{net:?}");
    }
    Ok(())
}

/// X12F-2 / C-04: a refused payout is not lost. on_payout records it as owed with an
/// arrow_payout_failed event, and anyone's retry_payout delivers it once intents accepts again.
#[tokio::test]
async fn refused_payout_is_owed_then_retried() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let seller = e.id(Who::Seller);
    let id = e.list("scored", None, 10).await?;
    e.intents().call("set_reject").args_json(json!({"receiver_id": seller})).transact().await?.into_result()?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("done"));
    let failed: Vec<Value> = events(&out).into_iter().filter(|v| v["event"] == "arrow_payout_failed").collect();
    assert_eq!(failed.len(), 1, "{:?}", out.logs());
    assert_eq!((failed[0]["data"]["to"].as_str(), failed[0]["data"]["amount"].as_str(), failed[0]["data"]["memo"].as_str()), (Some(seller.as_str()), Some("45000"), Some("arrow:eval:1")));
    let out = e.buy(Who::Buyer, id, PRICE).await?;
    assert_eq!(e.get_purchase(1).await?["status"].as_str(), Some("done"), "{out:?}");
    let owed: String = e.view("get_owed", json!({"account_id": seller, "rail": "mt"})).await?;
    assert_eq!(owed, (45_000 + 1_960_000).to_string());
    assert_eq!(e.usdc_of(&seller).await?, 0);
    assert_eq!(e.usdc_of(&e.treasury_id()).await?, BOND + 5_000 + 40_000, "the treasury shares still landed");

    e.intents().call("set_reject").args_json(json!({"receiver_id": null})).transact().await?.into_result()?;
    let out = e.stranger.call(e.arrow.id(), "retry_payout").args_json(json!({"account_id": seller})).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(e.usdc_of(&seller).await?, 45_000 + 1_960_000);
    let owed: String = e.view("get_owed", json!({"account_id": seller, "rail": "mt"})).await?;
    assert_eq!(owed, "0");
    let out = e.stranger.call(e.arrow.id(), "retry_payout").args_json(json!({"account_id": seller})).transact().await?;
    assert_panicked(&out, "E24 nothing owed");
    Ok(())
}

/// X12-2 (tabs) / TN-6: a second buy of the same listing by the same payer to the same key is
/// refused (E22) and its payment returned in full; the first purchase can be found again.
#[tokio::test]
async fn second_buy_same_key_refunded() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Notify).await?;
        let id = e.list("scored", None, 10).await?;
        assert!(e.buy(Who::Buyer, id, PRICE).await?.receipt_failures().is_empty(), "{net:?}");
        let seller_before = e.usdc_of(&e.id(Who::Seller)).await?;
        let buyer_before = if net == Net::Testnet { e.ft_balance(&e.id(Who::Buyer)).await? } else { 0 };
        let out = e.buy(Who::Buyer, id, PRICE).await?;
        assert_panicked(&out, "E22 already bought");
        assert_eq!(e.usdc_of(&e.id(Who::Seller)).await?, seller_before, "{net:?}: seller paid twice");
        if net == Net::Testnet {
            assert_eq!(e.ft_balance(&e.id(Who::Buyer)).await?, buyer_before, "the second payment was kept");
        }
        let p: Value = e.view("get_purchase_by_buyer", json!({"listing_id": id, "buyer": e.id(Who::Buyer), "buyer_pk": buyer_pk()})).await?;
        assert_eq!((p["id"].as_u64(), p["status"].as_str()), (Some(1), Some("done")), "{net:?}");
    }
    Ok(())
}

/// X12-3: the seller moves the blob to a new host; the sha stays and the payment comes back.
#[tokio::test]
async fn seller_rehosts_blob() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let url = format!("https://mirror.test/{}.bin", blob_sha());
    let out = e.pay(Who::Seller, 1, &json!({"op": "rehost", "listing_id": id, "blob_url": url})).transact().await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(unused(&out, &e.arrow), Some(1));
    let l: Value = e.view("get_listing", json!({"listing_id": id})).await?;
    assert_eq!((l["blob_url"].as_str(), l["blob_sha256"].clone()), (Some(url.as_str()), json!(blob_sha())));
    let out = e.pay(Who::Buyer, 1, &json!({"op": "rehost", "listing_id": id, "blob_url": "https://evil.test/x.bin"})).transact().await?;
    assert_panicked(&out, "E23");
    assert!(e.eval(Who::Buyer, id, EVAL_FEE).await?.receipt_failures().is_empty());
    assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("done"));
    Ok(())
}

/// C-02 / STATE-3: listings of the largest allowed size stop at the tank reserve (E10, bond back)
/// and an honest eval still runs afterwards.
#[tokio::test]
async fn max_listings_cannot_starve_evals() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    // Free balance: tank_min 0.05 + 10 eval deposits 0.2 + 0.1 NEAR (about two maximal listings).
    e.worker
        .patch(e.arrow.id())
        .account_from_current(|cur| {
            let bal = u128::from(cur.storage_usage) * 10u128.pow(19) + 35 * NEAR / 100;
            near_workspaces::types::AccountDetailsPatch::from(cur).balance(near_workspaces::types::NearToken::from_yoctonear(bal))
        })
        .transact()
        .await?;
    let mut big = list_msg("scored", None, 10);
    big["title"] = json!("\u{1F600}".repeat(60));
    big["public_desc"] = json!("\u{1F600}".repeat(210));
    big["columns"] = json!(vec!["\u{1F600}".repeat(10); 64]);
    let (mut listed, mut refused) = (0, 0);
    for _ in 0..6 {
        let out = e.pay(Who::Buyer2, BOND, &big).transact().await?;
        if out.receipt_failures().is_empty() {
            listed += 1;
        } else {
            assert_panicked(&out, "E10 gas tank low");
            refused += 1;
        }
    }
    println!("max_listings_cannot_starve_evals: {listed} listed, {refused} refused, tank {}", e.tank().await?);
    assert!(listed >= 1 && refused >= 1, "{listed} listed, {refused} refused");
    assert!(e.tank().await? >= 25 * NEAR / 100, "listings went below the eval reserve");
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert!(out.receipt_failures().is_empty(), "{out:?}");
    assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("done"));
    Ok(())
}

/// STATE-1 / X12-6 (storage): redeploying this build over the code that runs on
/// arrow-v2.arrowhq.testnet (main bfae9c3, testnet build) keeps the state readable and usable.
/// Needs that wasm: build it from bfae9c3 and run with
/// `ARROW_PREV_WASM=<path> cargo test -p arrow --test sandbox upgrade_keeps_state -- --ignored`.
#[tokio::test]
#[ignore]
async fn upgrade_keeps_state() -> R<()> {
    let prev = std::fs::read(std::env::var("ARROW_PREV_WASM")?)?;
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let usd = deploy(&sub(&root, "usd", 10).await?, &wasm("arrow-usd"), json!({})).await?;
    let _mock = deploy(&sub(&root, "outlayer", 10).await?, &wasm("mock-outlayer"), json!({})).await?;
    let acc = sub(&root, "arrow", 30).await?;
    let mut cfg = init_cfg(Net::Testnet, acc.id().as_str(), root.id().as_str());
    cfg["testnet_caps"]["exempt"] = json!([]);
    let arrow = deploy(&acc, &prev, json!({ "cfg": cfg })).await?;
    let seller = sub(&root, "seller", 10).await?;
    let buyer = sub(&root, "buyer", 10).await?;
    for a in [&seller, &buyer] {
        a.call(usd.id(), "mint").args_json(json!({"receiver_id": a.id(), "amount": MINT.to_string()})).transact().await?.into_result()?;
    }
    acc.call(acc.id(), "init_program_key").deposit(NearToken::from_millinear(50)).gas(near_workspaces::types::Gas::from_tgas(300)).transact().await?.into_result()?;
    let ft = |who: &Account, amount: u128, msg: Value| {
        who.call(usd.id(), "ft_transfer_call")
            .args_json(json!({"receiver_id": arrow.id(), "amount": amount.to_string(), "msg": msg.to_string()}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(near_workspaces::types::Gas::from_tgas(300))
    };
    assert!(ft(&seller, BOND, list_msg("scored", None, 10)).transact().await?.receipt_failures().is_empty());
    assert!(ft(&buyer, EVAL_FEE, eval_msg(1)).transact().await?.receipt_failures().is_empty());

    acc.deploy(&wasm("arrow-testnet")).await?.into_result()?; // code only, state kept (testnet.sh)
    let cfg_view: Value = arrow.view("get_config").await?.json()?;
    assert_eq!(cfg_view["build"].as_str(), Some("testnet"));
    let l: Value = arrow.view("get_listing").args_json(json!({"listing_id": 1})).await?.json()?;
    assert_eq!(l["evals_used"].as_u64(), Some(1));
    let ev: Value = arrow.view("get_eval").args_json(json!({"eval_id": 1})).await?.json()?;
    assert_eq!(ev["status"].as_str(), Some("done"));
    assert!(ft(&seller, BOND, list_msg("verdict", None, 10)).transact().await?.receipt_failures().is_empty());
    assert!(ft(&buyer, EVAL_FEE, eval_msg(1)).transact().await?.receipt_failures().is_empty());
    assert!(ft(&buyer, PRICE, buy_msg(1)).transact().await?.receipt_failures().is_empty());
    let p: Value = arrow.view("get_purchase").args_json(json!({"purchase_id": 1})).await?.json()?;
    assert_eq!(p["status"].as_str(), Some("done"));
    Ok(())
}

#[tokio::test]
async fn wrong_token_or_predecessor_refunds() -> R<()> {
    // Mainnet rail: only intents may notify, with exactly one USDC token.
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let buyer = e.id(Who::Buyer);
    let msg = eval_msg(id).to_string();
    let out = e
        .stranger
        .call(e.arrow.id(), "mt_on_transfer")
        .args_json(json!({"sender_id": buyer, "previous_owner_ids": [buyer], "token_ids": [USDC_MAINNET], "amounts": [EVAL_FEE.to_string()], "msg": msg}))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?;
    assert_panicked(&out, "E01");
    let out = e.mt_call(&buyer, "nep141:other.test.near", EVAL_FEE, &eval_msg(id)).transact().await?;
    assert_panicked(&out, "E02");
    let out = e
        .intents()
        .as_account()
        .call(e.arrow.id(), "mt_on_transfer")
        .args_json(json!({"sender_id": buyer, "previous_owner_ids": [buyer, buyer], "token_ids": [USDC_MAINNET, USDC_MAINNET], "amounts": ["25000", "25000"], "msg": msg}))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?;
    assert_panicked(&out, "E03");
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(0));

    // Testnet rail: a second arrow-usd is not the configured token; NEP-141 gives the buyer everything back.
    let e = setup(Net::Testnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let fake = deploy(&sub(&e.root, "fake", 10).await?, &wasm("arrow-usd"), json!({})).await?;
    e.buyer.call(fake.id(), "mint").args_json(json!({"receiver_id": e.buyer.id(), "amount": "1000000"})).transact().await?.into_result()?;
    let out = e
        .buyer
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": e.arrow.id(), "amount": EVAL_FEE.to_string(), "msg": eval_msg(id).to_string()}))
        .deposit(near_workspaces::types::NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?;
    assert_panicked(&out, "E02");
    let bal: String = fake.view("ft_balance_of").args_json(json!({"account_id": e.buyer.id()})).await?.json()?;
    assert_eq!(bal, "1000000", "fake token not refunded");
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(0));
    Ok(())
}

#[tokio::test]
async fn empty_tank_refunds() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let transfers = e.transfers().await?.len();
    // Free balance 0.04 NEAR < tank_min 0.05 + eval deposit 0.02 (storage staking kept intact).
    e.worker
        .patch(e.arrow.id())
        .account_from_current(|cur| {
            let bal = u128::from(cur.storage_usage) * 10u128.pow(19) + 4 * NEAR / 100;
            near_workspaces::types::AccountDetailsPatch::from(cur).balance(near_workspaces::types::NearToken::from_yoctonear(bal))
        })
        .transact()
        .await?;
    let t0 = e.tank().await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_panicked(&out, "E10");
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(0));
    assert_eq!(e.transfers().await?.len(), transfers, "nothing paid out");
    let t1 = e.tank().await?;
    assert!(t1 + NEAR / 1000 >= t0, "tank spent on a rejected eval: {t0} -> {t1}");
    Ok(())
}

// ---------------------------------------------------------------- admin

#[tokio::test]
async fn self_only_methods() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let calls: [(&str, Value, u128); 4] = [
        ("init_program_key", json!({}), NEAR / 20),
        ("set_program", json!({"url": "https://example.test/x.wasm", "hash": "ef".repeat(32)}), 0),
        ("set_config", json!({"patch": {"fee_bps_eval": 0}}), 0),
        ("set_paused", json!({"paused": true}), 0),
    ];
    for (method, args, deposit) in calls {
        let out = e
            .stranger
            .call(e.arrow.id(), method)
            .args_json(args)
            .deposit(near_workspaces::types::NearToken::from_yoctonear(deposit))
            .gas(near_workspaces::types::Gas::from_tgas(300))
            .transact()
            .await?;
        assert_panicked(&out, "E14");
    }
    assert!(e.self_call("set_paused", json!({"paused": true})).await?.is_success());
    let out = e.pay(Who::Seller, BOND, &list_msg("scored", None, 10)).transact().await?;
    assert_panicked(&out, "E05");
    assert!(e.self_call("set_paused", json!({"paused": false})).await?.is_success());
    e.list("scored", None, 10).await?;
    let cfg: Value = e.view("get_config", json!({})).await?;
    assert_eq!(cfg["config"]["fee_bps_eval"].as_u64(), Some(1000), "stranger changed config");
    Ok(())
}

#[tokio::test]
async fn paused_settles_in_flight() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", Some("never"), 10).await?;
    let status = e.pay(Who::Buyer, EVAL_FEE, &eval_msg(id)).transact_async().await?;
    e.wait_pending(1).await?;
    assert!(e.self_call("set_paused", json!({"paused": true})).await?.is_success());
    let out = e.time_out(status).await?;
    assert_eval_refunded(&e, &out, 1, "null", EVAL_REFUND).await?;
    let cfg: Value = e.view("get_config", json!({})).await?;
    assert_eq!(cfg["paused"].as_bool(), Some(true));
    Ok(())
}

#[tokio::test]
async fn program_key_lifecycle() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let old = e.list("scored", None, 10).await?;
    let new_hash = "ef".repeat(32);
    let out = e.self_call("set_program", json!({"url": "https://example.test/arrow-tee-v2.wasm", "hash": new_hash})).await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(e.view::<Option<String>>("program_pubkey", json!({})).await?, None);
    let out = e.pay(Who::Seller, BOND, &list_msg("scored", None, 10)).transact().await?;
    assert_panicked(&out, "E06");
    assert!(e.init_program_key().await?.is_success());
    assert_eq!(e.view::<Option<String>>("program_pubkey", json!({})).await?.map(|p| p.len()), Some(130));
    let out = e.eval(Who::Buyer, old, EVAL_FEE).await?;
    assert_panicked(&out, "E13");
    let fresh = e.list("scored", None, 10).await?;
    let l: Value = e.view("get_listing", json!({"listing_id": fresh})).await?;
    assert_eq!(l["program_hash_at_list"].as_str(), Some(new_hash.as_str()));
    Ok(())
}

// ---------------------------------------------------------------- payments and OutLayer call

async fn overpay(net: Net) -> R<()> {
    const OVER: u128 = 30_000;
    let e = setup(net, Path::Notify).await?;
    let (seller, buyer) = (e.id(Who::Seller), e.id(Who::Buyer));
    let (s0, b0) = (e.usdc_of(&seller).await?, e.usdc_of(&buyer).await?);
    let out = e.pay(Who::Seller, BOND + OVER, &list_msg("scored", None, 10)).transact().await?;
    assert_eq!(unused(&out, &e.arrow), Some(OVER));
    let id = events(&out).iter().find(|ev| ev["event"] == "arrow_listed").and_then(|ev| ev["data"]["listing_id"].as_u64()).expect("listed");
    let out = e.eval(Who::Buyer, id, EVAL_FEE + OVER).await?;
    assert_eq!(unused(&out, &e.arrow), Some(OVER));
    let out = e.buy(Who::Buyer, id, PRICE + OVER).await?;
    assert_eq!(unused(&out, &e.arrow), Some(OVER));
    if net == Net::Mainnet {
        assert_eq!(out.json::<Vec<String>>()?, vec![OVER.to_string()]);
    } else {
        assert_eq!(e.usdc_of(&seller).await? + BOND, s0 + 45_000 + 1_960_000, "seller paid more than the bond");
        assert_eq!(b0 - e.usdc_of(&buyer).await?, EVAL_FEE + PRICE, "buyer paid more than fee + price");
    }
    Ok(())
}

#[tokio::test]
async fn overpay_refunds_difference() -> R<()> {
    overpay(Net::Mainnet).await?;
    overpay(Net::Testnet).await
}

#[tokio::test]
async fn outlayer_request_args() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let arrow = e.arrow.id().to_string();
    let check = |r: &Value, deposit: &str, limits: Value, action: &str| {
        let source = json!({"WasmUrl": {"url": "https://example.test/arrow-tee.wasm", "hash": "ab".repeat(32), "build_target": "wasm32-wasip2"}});
        assert_eq!(r["source"], source);
        assert_eq!(r["resource_limits"], limits);
        assert_eq!(r["secrets_ref"], json!({"profile": "arrow", "account_id": arrow}));
        assert_eq!(r["response_format"], json!("Json"));
        assert_eq!(r["payer_account_id"], json!(arrow));
        assert_eq!(r["predecessor"], json!(arrow));
        assert!(r["params"].is_null(), "params must be null");
        assert_eq!(r["deposit"], json!(deposit));
        let input: Value = serde_json::from_str(r["input_data"].as_str().expect("input_data")).expect("input json");
        assert_eq!((input["v"].as_u64(), input["action"].as_str()), (Some(1), Some(action)));
        assert_eq!(input["listing"]["blob_sha256"], json!(blob_sha()));
        assert_eq!(input["listing"]["seller"], json!(e.id(Who::Seller)), "the enclave checks it against sealed_k");
    };
    assert!(e.eval(Who::Buyer, id, EVAL_FEE).await?.receipt_failures().is_empty());
    let r: Value = e.mock.view("last_request").await?.json()?;
    check(&r, "20000000000000000000000", json!({"max_instructions": 20_000_000_000u64, "max_memory_mb": 512, "max_execution_seconds": 100}), "eval");
    assert!(e.buy(Who::Buyer, id, PRICE).await?.receipt_failures().is_empty());
    let r: Value = e.mock.view("last_request").await?.json()?;
    check(&r, "10000000000000000000000", json!({"max_instructions": 2_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 30}), "release");
    Ok(())
}

#[tokio::test]
async fn tank_refilled_by_outlayer_refund() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let (t0, st0) = (e.tank().await?, e.worker.view_account(e.arrow.id()).await?.storage_usage);
    assert!(e.eval(Who::Buyer, id, EVAL_FEE).await?.receipt_failures().is_empty());
    let (t1, st1) = (e.tank().await?, e.worker.view_account(e.arrow.id()).await?.storage_usage);
    let drop = t0.saturating_sub(t1);
    let storage = u128::from(st1.saturating_sub(st0)) * 10u128.pow(19);
    println!("tank_refilled_by_outlayer_refund: drop {drop} yocto, storage {storage} yocto ({} bytes)", st1 - st0);
    // Deposit 0.02 NEAR out, everything but OutLayer's 0.001 NEAR base fee back to the payer (self).
    // The only other cost is the 1 yoctoNEAR attached to each of the two mt_transfer payouts.
    assert!(drop <= NEAR / 1000 + storage + 2, "drop {drop} > base fee + storage {storage} + 2 yocto");
    assert!(drop < NEAR / 100);
    Ok(())
}

#[tokio::test]
async fn success_return_shape_mt() -> R<()> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eq!(out.raw_bytes()?, br#"["0"]"#.to_vec());
    let out = e.buy(Who::Buyer, id, PRICE).await?;
    assert_eq!(out.raw_bytes()?, br#"["0"]"#.to_vec());
    Ok(())
}

#[tokio::test]
async fn success_return_shape_ft() -> R<()> {
    let e = setup(Net::Testnet, Path::Notify).await?;
    let id = e.list("scored", None, 10).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eq!(arrow_return(&out, &e.arrow), Some(json!("0")));
    // ft_resolve_transfer then reports the whole amount as used.
    assert_eq!(out.json::<String>()?, EVAL_FEE.to_string());
    let out = e.buy(Who::Buyer, id, PRICE).await?;
    assert_eq!(arrow_return(&out, &e.arrow), Some(json!("0")));
    assert_eq!(out.json::<String>()?, PRICE.to_string());
    Ok(())
}

// ---------------------------------------------------------------- testnet caps

#[tokio::test]
async fn testnet_cap_per_account() -> R<()> {
    let e = setup(Net::Testnet, Path::Notify).await?;
    let id = e.list("scored", None, 20).await?;
    for i in 0..10 {
        let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
        assert!(out.receipt_failures().is_empty(), "eval {i}: {out:?}");
    }
    let b0 = e.ft_balance(e.buyer.id().as_str()).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_panicked(&out, "E11");
    assert_eq!(e.ft_balance(e.buyer.id().as_str()).await?, b0, "capped eval was charged");
    assert!(e.eval(Who::Buyer2, id, EVAL_FEE).await?.receipt_failures().is_empty(), "cap is per account");
    Ok(())
}

#[tokio::test]
async fn testnet_cap_global() -> R<()> {
    let e = setup(Net::Testnet, Path::Notify).await?;
    let caps = json!({"per_account_per_day": 10, "global_per_day": 3, "exempt": [e.bench.id()]});
    assert!(e.self_call("set_config", json!({"patch": {"testnet_caps": caps}})).await?.is_success());
    let id = e.list("scored", None, 20).await?;
    for who in [Who::Buyer, Who::Buyer, Who::Buyer2] {
        assert!(e.eval(who, id, EVAL_FEE).await?.receipt_failures().is_empty());
    }
    let out = e.eval(Who::Buyer2, id, EVAL_FEE).await?;
    assert_panicked(&out, "E12");
    Ok(())
}

#[tokio::test]
async fn testnet_cap_exempt() -> R<()> {
    let e = setup(Net::Testnet, Path::Notify).await?;
    let id = e.list("scored", None, 20).await?;
    for i in 0..12 {
        let out = e.eval(Who::Bench, id, EVAL_FEE).await?;
        assert!(out.receipt_failures().is_empty(), "exempt eval {i}: {out:?}");
    }
    assert_eq!(e.leak(id).await?["evals_used"].as_u64(), Some(12));
    Ok(())
}

// ---------------------------------------------------------------- escrow path

async fn escrow_listing(net: Net, mock: Option<&str>) -> R<(Env, u64)> {
    let e = setup(net, Path::Escrow).await?;
    let id = e.list("scored", mock, 10).await?;
    let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
    assert_eq!(unused(&out, &e.arrow), Some(0), "escrow holds exactly the fee");
    assert!(events(&out).iter().any(|ev| ev["event"] == "arrow_eval" && ev["data"]["phase"] == "accepted" && ev["data"]["eval_id"] == 1));
    let ev = e.get_eval(1).await?;
    assert_eq!(ev["status"].as_str(), Some("escrowed"));
    assert!(ev.get("sealed_criteria").is_none(), "sealed_criteria leaked in a view");
    Ok((e, id))
}

#[tokio::test]
async fn escrow_eval_happy() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let (e, _) = escrow_listing(net, None).await?;
        let (seller, treasury) = (e.id(Who::Seller), e.treasury_id());
        let (s0, t0) = (e.usdc_of(&seller).await?, e.usdc_of(&treasury).await?);
        let out = e.relay("request_eval", "eval_id", 1).await?;
        assert!(out.receipt_failures().is_empty(), "{net:?}: {out:?}");
        assert_eq!(arrow_return(&out, &e.arrow), Some(Value::Null), "escrow callbacks return null");
        assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("done"));
        assert_eq!((e.usdc_of(&seller).await? - s0, e.usdc_of(&treasury).await? - t0), (45_000, 5_000), "{net:?}");
        if net == Net::Testnet {
            assert_eq!(e.ft_balance(e.arrow.id().as_str()).await?, 0, "arrow keeps nothing");
        }
    }
    Ok(())
}

#[tokio::test]
async fn escrow_refund_on_null_transfers_back() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Escrow).await?;
        let id = e.list("scored", Some("null"), 10).await?;
        let buyer = e.id(Who::Buyer);
        let b0 = e.usdc_of(&buyer).await?;
        assert_eq!(unused(&e.eval(Who::Buyer, id, EVAL_FEE).await?, &e.arrow), Some(0));
        let out = e.relay("request_eval", "eval_id", 1).await?;
        assert_eq!(refund_reason(&out).as_deref(), Some("null"), "{net:?}: {out:?}");
        assert_eq!(arrow_return(&out, &e.arrow), Some(Value::Null));
        assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("refunded"));
        match net {
            Net::Mainnet => assert_eq!(e.usdc_of(&buyer).await? - b0, EVAL_REFUND, "mt_transfer back to the buyer"),
            Net::Testnet => assert_eq!(e.usdc_of(&buyer).await?, b0 - EVAL_FAIL_KEEP, "ft_transfer back to the buyer"),
        }
    }
    Ok(())
}

#[tokio::test]
async fn escrow_request_eval_idempotent() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let (e, id) = escrow_listing(net, None).await?;
        assert!(e.relay("request_eval", "eval_id", 1).await?.receipt_failures().is_empty());
        assert_panicked(&e.relay("request_eval", "eval_id", 1).await?, "E17");
        // Same for a purchase.
        assert_eq!(unused(&e.buy(Who::Buyer, id, PRICE).await?, &e.arrow), Some(0));
        assert_eq!(e.get_purchase(1).await?["status"].as_str(), Some("escrowed"));
        assert!(e.relay("request_release", "purchase_id", 1).await?.receipt_failures().is_empty());
        assert_eq!(e.get_purchase(1).await?["status"].as_str(), Some("done"));
        assert_panicked(&e.relay("request_release", "purchase_id", 1).await?, "E17");
    }
    Ok(())
}

#[tokio::test]
async fn escrow_refund_stale_too_early() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let (e, _) = escrow_listing(net, None).await?;
        let out = e
            .stranger
            .call(e.arrow.id(), "refund_stale")
            .args_json(json!({"kind": "eval", "id": 1}))
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact()
            .await?;
        assert_panicked(&out, "E18");
        assert_eq!(e.get_eval(1).await?["status"].as_str(), Some("escrowed"), "{net:?}");
    }
    Ok(())
}

// ---------------------------------------------------------------- builds, events, interface, gas

#[tokio::test]
async fn variants_report_their_build() -> R<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let default = match arrow::paths::DEFAULT_PAYMENT_PATH {
        arrow::paths::PaymentPath::Notify => "notify",
        arrow::paths::PaymentPath::Escrow => "escrow",
    };
    let cases = [
        ("am", Net::Mainnet, Path::Notify, "mainnet", default),
        ("ame", Net::Mainnet, Path::Escrow, "mainnet", "escrow"),
        ("at", Net::Testnet, Path::Notify, "testnet", default),
        ("ate", Net::Testnet, Path::Escrow, "testnet", "escrow"),
    ];
    for (name, net, path, build, payment) in cases {
        let c = deploy_arrow(&root, name, variant(net, path), net).await?;
        let v: Value = c.view("version").await?.json()?;
        assert_eq!((v["name"].as_str(), v["build"].as_str(), v["payment_path"].as_str()), (Some("arrow"), Some(build), Some(payment)), "{name}");
        assert_eq!(v["result_path"].as_str(), Some("chain"));
    }
    // A mainnet wasm refuses the testnet config (testnet_caps) and the other way round.
    for (name, wasm_net, cfg_net) in [("xm", Net::Mainnet, Net::Testnet), ("xt", Net::Testnet, Net::Mainnet)] {
        let acc = sub(&root, name, 30).await?;
        let c = acc.deploy(&wasm(variant(wasm_net, Path::Notify))).await?.into_result()?;
        let out = c.call("new").args_json(json!({"cfg": init_cfg(cfg_net, acc.id().as_str(), root.id().as_str())})).transact().await?;
        assert_panicked(&out, "E15 bad config: testnet_caps");
    }
    Ok(())
}

/// One listing of each kind of outcome: list, eval (done), buy (done), eval refund (null).
async fn event_run() -> R<(Env, Vec<Value>)> {
    let e = setup(Net::Mainnet, Path::Notify).await?;
    let mut all = Vec::new();
    let out = e.pay(Who::Seller, BOND, &list_msg("scored", None, 10)).transact().await?;
    all.extend(events(&out));
    all.extend(events(&e.eval(Who::Buyer, 1, EVAL_FEE).await?));
    all.extend(events(&e.buy(Who::Buyer, 1, PRICE).await?));
    let out = e.pay(Who::Seller, BOND, &list_msg("verdict", Some("null"), 10)).transact().await?;
    all.extend(events(&out));
    all.extend(events(&e.eval(Who::Buyer2, 2, EVAL_FEE).await?));
    Ok((e, all))
}

fn keys(v: &Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().expect("data is an object").keys().cloned().collect();
    k.sort();
    k
}

fn sorted(fields: &[&str]) -> Vec<String> {
    let mut k: Vec<String> = fields.iter().map(|s| s.to_string()).collect();
    k.sort();
    k
}

#[tokio::test]
async fn events_are_nep297() -> R<()> {
    let (_e, all) = event_run().await?;
    let mut seen = Vec::new();
    for ev in &all {
        assert_eq!((ev["standard"].as_str(), ev["version"].as_str()), (Some("arrow"), Some("1.0.0")), "{ev}");
        let d = &ev["data"];
        let name = ev["event"].as_str().expect("event name");
        let phase = d["phase"].as_str().unwrap_or("");
        let want: &[&str] = match (name, phase) {
            ("arrow_listed", _) => &["listing_id", "seller", "payout", "title", "mode", "price", "eval_fee", "max_evals", "bits_per_eval_milli", "budget_milli", "blob_sha256", "program_wasm_hash"],
            ("arrow_eval", "accepted") => &["phase", "listing_id", "eval_id", "buyer", "fee", "spent_milli", "left_milli"],
            ("arrow_eval", "done") => &["phase", "listing_id", "eval_id", "buyer", "fee", "spent_milli", "left_milli", "h"],
            ("arrow_purchase", "accepted") => &["phase", "listing_id", "purchase_id", "buyer", "price"],
            ("arrow_purchase", "done") => &["phase", "listing_id", "purchase_id", "buyer", "price", "h"],
            ("arrow_refund", _) => &["kind", "listing_id", "id", "reason", "amount"],
            other => panic!("unexpected event {other:?}"),
        };
        assert_eq!(keys(d), sorted(want), "{name}/{phase}");
        for (k, v) in d.as_object().expect("object") {
            let ok = match k.as_str() {
                "listing_id" | "eval_id" | "purchase_id" | "id" | "max_evals" | "bits_per_eval_milli" | "budget_milli" | "spent_milli" | "left_milli" => v.is_u64(),
                _ => v.is_string(),
            };
            assert!(ok, "{name}.{k} has the wrong JSON type: {v}");
        }
        seen.push(format!("{name}/{phase}"));
    }
    for want in ["arrow_listed/", "arrow_eval/accepted", "arrow_eval/done", "arrow_purchase/accepted", "arrow_purchase/done", "arrow_refund/"] {
        assert!(seen.iter().any(|s| s == want), "no {want} event in {seen:?}");
    }
    Ok(())
}

/// Replaces values that change between runs, keeping their JSON type.
fn scrub(v: &mut Value, volatile: &[&str]) {
    match v {
        Value::Object(map) => {
            for (k, x) in map.iter_mut() {
                if volatile.contains(&k.as_str()) {
                    *x = match x {
                        Value::Number(_) => json!(0),
                        Value::Null => Value::Null,
                        _ => json!("<varies>"),
                    };
                } else {
                    scrub(x, volatile);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| scrub(x, volatile)),
        _ => {}
    }
}

/// Compares with `tests/snapshots/<name>.json`; writes it when missing or with UPDATE_SNAPSHOTS=1.
fn snapshot(name: &str, v: &Value) {
    let path = format!("{}/tests/snapshots/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let text = serde_json::to_string_pretty(v).expect("json") + "\n";
    let update = std::env::var("UPDATE_SNAPSHOTS").as_deref() == Ok("1");
    match std::fs::read_to_string(&path) {
        Ok(old) if old == text => {}
        Ok(_) if !update => panic!("{path} differs from the contract's output; rerun with UPDATE_SNAPSHOTS=1 if the interface change is intended"),
        _ => {
            std::fs::create_dir_all(format!("{}/tests/snapshots", env!("CARGO_MANIFEST_DIR"))).expect("mkdir");
            std::fs::write(&path, text).expect("write snapshot");
        }
    }
}

#[tokio::test]
async fn interface_snapshots() -> R<()> {
    let (e, all) = event_run().await?;
    let volatile = ["tank_available", "created_at_ns", "settled_at_ns", "seed"];
    let mut views = json!({
        "_note": "Generated by contracts/arrow/tests/sandbox.rs interface_snapshots (mainnet build, notify path). Values that change per run are replaced: strings by \"<varies>\", numbers by 0.",
        "get_config": e.view::<Value>("get_config", json!({})).await?,
        "program_pubkey": e.view::<Value>("program_pubkey", json!({})).await?,
        "get_listing": e.view::<Value>("get_listing", json!({"listing_id": 1})).await?,
        "get_listings": e.view::<Value>("get_listings", json!({"from_index": 0, "limit": 1})).await?,
        "get_eval": e.view::<Value>("get_eval", json!({"eval_id": 1})).await?,
        "get_eval_refunded": e.view::<Value>("get_eval", json!({"eval_id": 2})).await?,
        "get_evals_by_listing": e.view::<Value>("get_evals_by_listing", json!({"listing_id": 1, "from_index": 0, "limit": 50})).await?,
        "get_purchase": e.view::<Value>("get_purchase", json!({"purchase_id": 1})).await?,
        "leak_budget": e.view::<Value>("leak_budget", json!({"listing_id": 1})).await?,
        "version": e.view::<Value>("version", json!({})).await?,
    });
    scrub(&mut views, &volatile);
    snapshot("views", &views);

    let mut evs = serde_json::Map::new();
    evs.insert("_note".into(), json!("Generated by interface_snapshots: one example of each event and phase, as logged after the EVENT_JSON: prefix."));
    for ev in all {
        let key = match ev["data"]["phase"].as_str() {
            Some(p) => format!("{}.{p}", ev["event"].as_str().unwrap_or("")),
            None => ev["event"].as_str().unwrap_or("").to_string(),
        };
        evs.entry(key).or_insert(ev);
    }
    snapshot("events", &Value::Object(evs));
    Ok(())
}

#[tokio::test]
async fn gas_profile() -> R<()> {
    for net in [Net::Mainnet, Net::Testnet] {
        let e = setup(net, Path::Notify).await?;
        let id = e.list("scored", None, 10).await?;
        let out = e.eval(Who::Buyer, id, EVAL_FEE).await?;
        let notify = arrow_gas(&out, &e.arrow, r#""phase":"accepted""#).expect("notification receipt");
        let on_eval = arrow_gas(&out, &e.arrow, r#""phase":"done""#).expect("on_eval receipt");
        let out = e.buy(Who::Buyer, id, PRICE).await?;
        let notify_buy = arrow_gas(&out, &e.arrow, r#""phase":"accepted""#).expect("notification receipt");
        let on_release = arrow_gas(&out, &e.arrow, r#""phase":"done""#).expect("on_release receipt");
        let entry = if net == Net::Mainnet { "mt_on_transfer" } else { "ft_on_transfer" };
        println!("gas_profile {net:?}: eval {entry} {notify:.2} TGas, on_eval {on_eval:.2} TGas; buy {entry} {notify_buy:.2} TGas, on_release {on_release:.2} TGas");
        assert!(notify < 40.0 && on_eval < 40.0, "{net:?} eval: {notify} / {on_eval} TGas");
        assert!(notify_buy < 40.0 && on_release < 40.0, "{net:?} buy: {notify_buy} / {on_release} TGas");
    }
    Ok(())
}
