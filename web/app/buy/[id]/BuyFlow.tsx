"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowViews } from "@arrow/sdk/contract";
import { decryptFile, sha256Hex } from "@arrow/sdk/crypto";
import { decodeEvalResult, MAX_BLOB_BYTES, openRelease, prepareBuy } from "@arrow/sdk/flows";
import type { State } from "@arrow/sdk/state";
import { deriveViewingKeyEoa, type ViewingKey } from "@arrow/sdk/viewingKey";
import { CriteriaForm } from "./CriteriaForm.tsx";
import { Badge } from "../../../components/Badge.tsx";
import { BitCounter } from "../../../components/BitCounter.tsx";
import { Countdown } from "../../../components/Countdown.tsx";
import { CopyEvidence } from "../../../components/CopyEvidence.tsx";
import { ErrorBox } from "../../../components/ErrorBox.tsx";
import { HashTriple } from "../../../components/HashTriple.tsx";
import { StepList, type Step } from "../../../components/StepList.tsx";
import { TopUp } from "../../../components/TopUp.tsx";
import { TxLink } from "../../../components/TxLink.tsx";
import { WalletButton } from "../../../components/WalletButton.tsx";
import form from "../../../components/form.module.css";
import { buildEvalMsg, criteriaFromForm, downloadName, EMPTY_CRITERIA, type CriteriaFormState } from "../../../lib/buy.ts";
import { CONTRACTS, SITE_DOMAIN, type Network } from "../../../lib/config.ts";
import { describeError, type Described } from "../../../lib/errors.ts";
import { formatBits, formatUsdc, REFUND_LINE, stateLine } from "../../../lib/format.ts";
import { payWithIntent, type PaidTx } from "../../../lib/pay.ts";
import type { ListingView } from "../../../lib/server/listingsCache.ts";
import { findEvent, SettleTimeout, waitForRecord } from "../../../lib/settle.ts";
import { suggestTopUp } from "../../../lib/topup.ts";
import type { Eoa } from "../../../lib/wallet.ts";
import styles from "./buy.module.css";

type Outcome =
  | { kind: "verdict"; state: State; evalId: number; h: string | null }
  | { kind: "refunded"; evalId: number; reason: string | null };

interface Delivery {
  purchaseId: number;
  releaseH: string | null;
  downloaded: string | null;
  saveUrl: string | null;
  saveName: string;
}

const STEP_LABELS = ["Wallet and viewing key", "Balance", "Your criteria", "Inspect", "Result", "Buy", "Download and verify"] as const;

export function BuyFlow({ network, listing, programPk, readOnly }: { network: Network; listing: ListingView; programPk: string | null; readOnly: boolean }) {
  const evalFee = BigInt(listing.eval_fee);
  const price = BigInt(listing.price);
  const budgetMilli = listing.max_evals * listing.bits_per_eval_milli;
  const listingId = Number(listing.id);
  const views = useRef(new ArrowViews(network, CONTRACTS[network]));

  const [host, setHost] = useState<string | null>(null);
  const [eoa, setEoa] = useState<Eoa | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [vk, setVk] = useState<ViewingKey | null>(null);
  const [mayBuy, setMayBuy] = useState(true);
  const [criteria, setCriteria] = useState<CriteriaFormState>(EMPTY_CRITERIA);
  const [spentMilli, setSpentMilli] = useState(listing.evals_used * listing.bits_per_eval_milli);
  const [busy, setBusy] = useState<null | "key" | "eval" | "buy" | "download">(null);
  const [error, setError] = useState<Described | null>(null);
  const [slow, setSlow] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [evalTx, setEvalTx] = useState<PaidTx | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  const [buyTx, setBuyTx] = useState<PaidTx | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [needManual, setNeedManual] = useState(false);
  const [refund, setRefund] = useState<string | null>(null);
  const abort = useRef(new AbortController());
  const keyRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setHost(window.location.host);
    const ac = (abort.current = new AbortController()); // a fresh one per mount: strict mode runs effects twice in dev
    return () => {
      ac.abort();
      keyRef.current?.fill(0);
    };
  }, []);

  const wrongDomain = network === "mainnet" && host !== null && (SITE_DOMAIN === "" || host !== SITE_DOMAIN);
  const needed = evalFee + (mayBuy ? price : 0n);
  const lowBalance = eoa !== null && balance !== null && balance < needed;
  const exhausted = spentMilli >= budgetMilli;
  const locked = readOnly || programPk === null;

  const steps: Step[] = [
    { label: STEP_LABELS[0], state: vk ? "done" : busy === "key" ? "doing" : "todo" },
    { label: STEP_LABELS[1], state: balance === null ? "todo" : lowBalance ? "doing" : "done", detail: balance === null ? undefined : `${formatUsdc(balance)} USDC` },
    { label: STEP_LABELS[2], state: criteria.text.trim() ? "done" : "todo" },
    { label: STEP_LABELS[3], state: outcome || evalTx ? "done" : busy === "eval" ? "doing" : "todo" },
    { label: STEP_LABELS[4], state: outcome ? (outcome.kind === "verdict" ? "done" : "failed") : evalTx ? "doing" : "todo" },
    { label: STEP_LABELS[5], state: buyTx ? "done" : busy === "buy" ? "doing" : "todo" },
    { label: STEP_LABELS[6], state: delivery?.saveUrl ? "done" : busy === "download" ? "doing" : "todo" },
  ];

  async function deriveKey() {
    if (!eoa) return;
    setError(null);
    setBusy("key");
    try {
      setVk(await deriveViewingKeyEoa(eoa, network === "mainnet" ? SITE_DOMAIN : SITE_DOMAIN || window.location.host));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  /** Waits for a record; a slow answer is not a failure: show the hint and keep waiting for up to 10 more minutes. */
  async function settle<T extends { status: string }>(what: string, read: () => Promise<T | null>): Promise<T> {
    try {
      return await waitForRecord(what, read, { everyMs: 4_000, timeoutMs: 180_000, signal: abort.current.signal });
    } catch (e) {
      if (!(e instanceof SettleTimeout)) throw e;
      setSlow(true);
      return waitForRecord(what, read, { everyMs: 5_000, timeoutMs: 600_000, signal: abort.current.signal });
    }
  }

  async function inspect() {
    if (!eoa || !vk || !programPk) return;
    setError(null);
    setOutcome(null);
    setSlow(false);
    let msg: string;
    try {
      msg = buildEvalMsg({ listingId, criteria: criteriaFromForm(criteria, listing.columns), buyerPk: vk.buyerPk, programPk });
    } catch (e) {
      setError(describeError(e));
      return;
    }
    setBusy("eval");
    try {
      const paid = await payWithIntent(eoa, { amount: evalFee, msg });
      setEvalTx(paid);
      setWaitingSince(Date.now());
      const ev = await findEvent(network, paid, "arrow_eval", { phase: "accepted", idField: "eval_id", signal: abort.current.signal });
      const evalId = Number(ev.eval_id);
      if (typeof ev.left_milli === "number") setSpentMilli(budgetMilli - ev.left_milli);
      const rec = await settle("The inspection", () => views.current.eval(evalId));
      setWaitingSince(null);
      if (rec.status === "refunded") {
        setOutcome({ kind: "refunded", evalId, reason: rec.refund_reason ?? null });
        return;
      }
      if (!rec.sealed_result) throw new Error("The contract marked the inspection done without a result.");
      let state: State;
      try {
        state = decodeEvalResult(rec.sealed_result, vk.scalarHex, listing.mode);
      } catch {
        throw new Error("Malformed result: it did not decrypt to one verdict byte with your viewing key. Do not buy on this result.");
      }
      setOutcome({ kind: "verdict", state, evalId, h: rec.h ?? null });
    } catch (e) {
      setWaitingSince(null);
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    if (!eoa || !vk) return;
    setError(null);
    setConfirmPass(false);
    setBusy("buy");
    try {
      const paid = await payWithIntent(eoa, { amount: price, msg: prepareBuy({ listingId, buyerPk: vk.buyerPk }) });
      setBuyTx(paid);
      setWaitingSince(Date.now());
      const ev = await findEvent(network, paid, "arrow_purchase", { phase: "accepted", idField: "purchase_id", signal: abort.current.signal });
      const purchaseId = Number(ev.purchase_id);
      const rec = await settle("The purchase", () => views.current.purchase(purchaseId));
      setWaitingSince(null);
      if (rec.status === "refunded") {
        setRefund(rec.refund_reason ?? "unknown");
        return;
      }
      if (!rec.sealed_k_buyer) throw new Error("The contract marked the purchase done without a key.");
      const k = openRelease(rec.sealed_k_buyer, vk.scalarHex);
      keyRef.current = k;
      setDelivery({ purchaseId, releaseH: rec.h ?? null, downloaded: null, saveUrl: null, saveName: "" });
      await verifyBlob(null, rec.h ?? null, purchaseId);
    } catch (e) {
      setWaitingSince(null);
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  /** Downloads the ciphertext (or takes the file the user picked), hashes it, and decrypts it only if the hashes agree. */
  async function verifyBlob(manual: Uint8Array | null, releaseH: string | null, purchaseId: number) {
    setBusy("download");
    setNeedManual(false);
    try {
      let bytes = manual;
      if (!bytes) {
        try {
          const res = await fetch(listing.blob_url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch {
          setNeedManual(true);
          return;
        }
      }
      if (bytes.length > MAX_BLOB_BYTES) throw new Error(`The file is ${bytes.length} bytes; the limit is ${MAX_BLOB_BYTES}.`);
      const downloaded = sha256Hex(bytes);
      const ok = downloaded === listing.blob_sha256 && releaseH === listing.blob_sha256 && (outcome?.kind !== "verdict" || outcome.h === null || outcome.h === listing.blob_sha256);
      let saveUrl: string | null = null;
      let saveName = "";
      const k = keyRef.current;
      if (ok && k) {
        const plain = decryptFile(bytes, k);
        saveName = downloadName(listingId, plain);
        saveUrl = URL.createObjectURL(new Blob([plain as BlobPart], { type: "application/octet-stream" }));
        k.fill(0);
        keyRef.current = null;
      }
      setDelivery({ purchaseId, releaseH, downloaded, saveUrl, saveName });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  const verdictClass = outcome?.kind === "verdict" ? (outcome.state.verdict === "BUY" ? styles.buy : styles.pass) : "";
  const canInspect = !locked && !wrongDomain && vk !== null && !lowBalance && !exhausted && criteria.text.trim() !== "" && busy === null && !evalTx;
  const evalH = outcome?.kind === "verdict" ? outcome.h : undefined;
  const hasEvalH = outcome?.kind === "verdict";

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <section className={form.panel} aria-labelledby="listing-title">
        <div className={styles.head}>
          <h1 id="listing-title" style={{ margin: 0 }}>{listing.displayTitle}</h1>
          <Badge kind={listing.label} />
        </div>
        {listing.public_desc ? <p>{listing.public_desc}</p> : null}
        <p className={styles.facts}>
          {listing.columns.length} columns: <span className="mono">{listing.columns.join(", ")}</span>
          <br />~{String(listing.rows_claimed)} rows claimed by the seller · {listing.mode} mode · Inspect ${formatUsdc(evalFee)} · Buy ${formatUsdc(price)}
        </p>
        <div title="Counts every eval, including refunded ones.">
          <BitCounter spentBits={spentMilli / 1000} budgetBits={budgetMilli / 1000} />
        </div>
        {exhausted ? <p className={form.error}>Inspection budget used up: buy-only.</p> : null}
        {programPk === null && !readOnly ? <p className={form.error}>The enclave key is not published yet, so inspections are closed.</p> : null}
      </section>

      <div className={styles.steps}>
        <StepList steps={steps} />
      </div>

      <section className={form.panel} aria-labelledby="b1">
        <h2 id="b1">1. Wallet and viewing key</h2>
        <WalletButton eoa={eoa} balance={balance} onConnect={setEoa} onBalance={setBalance} />
        {wrongDomain ? <p className={form.error} role="alert">Viewing keys are bound to {SITE_DOMAIN || "the site domain, which is not set"}. Open Arrow there.</p> : null}
        <p className={styles.sign}>
          Signature 1 of 2 (a message, no money moves): derives your private viewing key. The result is decrypted with it, and it is not stored; reloading asks again.
        </p>
        <button type="button" disabled={!eoa || vk !== null || busy !== null || wrongDomain || locked} onClick={() => void deriveKey()}>
          {vk ? "Viewing key ready" : busy === "key" ? "Waiting for your wallet…" : "Sign to derive my viewing key"}
        </button>
        <p className={form.hint}>EOA required; smart-contract wallets (EIP-1271) are not supported.</p>
      </section>

      <section className={form.panel} aria-labelledby="b2">
        <h2 id="b2">2. Balance</h2>
        <label>
          <input type="checkbox" checked={mayBuy} onChange={(e) => setMayBuy(e.target.checked)} /> I may buy after inspecting (plan for ${formatUsdc(price)} more)
        </label>
        {lowBalance && eoa ? (
          <TopUp eoa={eoa} defaultAmount={suggestTopUp(needed, balance ?? 0n)} onSuccess={() => setBalance(null)} />
        ) : (
          <p className={form.hint}>Needs ${formatUsdc(needed)} on your NEAR Intents balance.</p>
        )}
      </section>

      <section className={form.panel} aria-labelledby="b3">
        <h2 id="b3">3. Your criteria</h2>
        <CriteriaForm columns={listing.columns} value={criteria} onChange={setCriteria} />
      </section>

      <section className={form.panel} aria-labelledby="b4">
        <h2 id="b4">4. Inspect for ${formatUsdc(evalFee)}</h2>
        <p className={styles.sign}>
          Signature 2 of 2: this signs a payment of ${formatUsdc(evalFee)} USDC from your Intents balance to {CONTRACTS[network]}. Your wallet shows the intent as JSON.
        </p>
        <button type="button" className={form.primary} disabled={!canInspect} onClick={() => void inspect()}>
          {busy === "eval" ? "Inspecting…" : `Inspect · $${formatUsdc(evalFee)}`}
        </button>
        {waitingSince !== null && busy === "eval" ? (
          <p role="status">
            Your AI is reading the data inside the enclave (about 45 to 120 s). <Countdown startedAt={waitingSince} label="waiting" />
            {slow ? " Still waiting. If OutLayer does not answer within its window, your fee is refunded to your NEAR Intents balance." : ""}
          </p>
        ) : null}
        {evalTx ? <p>Payment <TxLink chain="near" network={network} hash={evalTx.txHash} /></p> : null}
      </section>

      {outcome ? (
        <section className={form.panel} aria-labelledby="b5" aria-live="polite">
          <h2 id="b5">5. Result</h2>
          {outcome.kind === "verdict" ? (
            <>
              <p className={`${styles.verdict} ${verdictClass}`}>{stateLine(outcome.state, listing.mode)}</p>
              <p className="mono">out: {formatBits(listing.bits_per_eval_milli)} bits / budget {formatBits(budgetMilli)} bits</p>
              <p className={form.hint}>The LLM cannot produce BUY unless the structural gates pass.</p>
              {evalTx ? (
                <CopyEvidence
                  run={{
                    kind: "eval", tx: evalTx.txHash, chain: "near", listing_id: listingId, eval_id: outcome.evalId,
                    expect: "eval op accepted and answered with one capped verdict",
                    observed: `${stateLine(outcome.state, listing.mode)} for eval ${outcome.evalId} of listing ${listingId}`,
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              <p className={form.error}>The inspection failed on chain{outcome.reason ? ` (${outcome.reason})` : ""}. {REFUND_LINE}</p>
              <p className={form.hint}>The counter still counts this inspection: refunds never give budget back.</p>
              {evalTx ? (
                <CopyEvidence
                  run={{
                    kind: "refund", tx: evalTx.txHash, chain: "near", listing_id: listingId, eval_id: outcome.evalId,
                    expect: "failed eval refunded to the Intents balance",
                    observed: `eval ${outcome.evalId} refunded, reason ${outcome.reason ?? "none"}`,
                  }}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {outcome?.kind === "verdict" && !buyTx ? (
        <section className={form.panel} aria-labelledby="b6">
          <h2 id="b6">6. Buy for ${formatUsdc(price)}</h2>
          {confirmPass ? (
            <p>
              Your inspection said PASS. Buy anyway?{" "}
              <button type="button" className={form.primary} disabled={busy !== null} onClick={() => void buy()}>Buy anyway</button>{" "}
              <button type="button" onClick={() => setConfirmPass(false)}>Cancel</button>
            </p>
          ) : (
            <>
              <p className={styles.sign}>This signs a payment of ${formatUsdc(price)} USDC from your Intents balance to {CONTRACTS[network]}.</p>
              <button
                type="button"
                className={form.primary}
                disabled={busy !== null || lowBalance}
                onClick={() => (outcome.state.verdict === "BUY" ? void buy() : setConfirmPass(true))}
              >
                {busy === "buy" ? "Buying…" : `Buy · $${formatUsdc(price)}`}
              </button>
            </>
          )}
        </section>
      ) : null}

      {buyTx ? (
        <section className={form.panel} aria-labelledby="b7" aria-live="polite">
          <h2 id="b7">7. Download and verify</h2>
          <p>Payment <TxLink chain="near" network={network} hash={buyTx.txHash} />{waitingSince !== null && busy === "buy" ? <> · <Countdown startedAt={waitingSince} label="waiting for the key" /></> : null}</p>
          {refund ? <p className={form.error}>The purchase failed on chain ({refund}). {REFUND_LINE}</p> : null}
          {needManual ? (
            <div>
              <p className={form.error}>Your browser could not download the file from its host. <a href={listing.blob_url} target="_blank" rel="noopener noreferrer">Open the link</a>, save the file, and choose it here.</p>
              <input
                type="file"
                aria-label="The encrypted file you saved"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f && delivery) await verifyBlob(new Uint8Array(await f.arrayBuffer()), delivery.releaseH, delivery.purchaseId);
                }}
              />
            </div>
          ) : null}
          {delivery ? (
            <>
              <HashTriple onChain={listing.blob_sha256} enclave={hasEvalH ? evalH : undefined} release={delivery.releaseH} downloaded={delivery.downloaded} />
              {delivery.saveUrl ? (
                <p>
                  <a className={form.primary} style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, textDecoration: "none" }} href={delivery.saveUrl} download={delivery.saveName}>Save {delivery.saveName}</a>
                </p>
              ) : null}
              <CopyEvidence
                run={{
                  kind: "buy", tx: buyTx.txHash, chain: "near", listing_id: listingId, purchase_id: delivery.purchaseId,
                  expect: "buy op released K and sha256(downloaded) == listing.blob_sha256 == eval h == release h",
                  observed: delivery.downloaded === listing.blob_sha256 ? "hash chain matched" : "hash chain not matched",
                }}
              />
            </>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <ErrorBox title="That step did not finish" fallback={error.fallback}>
          <p>{error.message}</p>
        </ErrorBox>
      ) : null}
    </fieldset>
  );
}
