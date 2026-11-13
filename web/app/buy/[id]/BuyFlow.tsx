"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowViews } from "@arrow/sdk/contract";
import { decryptFile, sha256Hex } from "@arrow/sdk/crypto";
import { decodeEvalResult, MAX_BLOB_BYTES, openRelease, prepareBuy } from "@arrow/sdk/flows";
import type { State } from "@arrow/sdk/state";
import { deriveViewingKeyEoa, type ViewingKey } from "@arrow/sdk/viewingKey";
import { CriteriaForm } from "./CriteriaForm.tsx";
import { Announcer } from "../../../components/Announcer.tsx";
import { Badge } from "../../../components/Badge.tsx";
import { BitCounter } from "../../../components/BitCounter.tsx";
import { Countdown } from "../../../components/Countdown.tsx";
import { CopyEvidence } from "../../../components/CopyEvidence.tsx";
import { ErrorBox } from "../../../components/ErrorBox.tsx";
import { HashTriple } from "../../../components/HashTriple.tsx";
import { MeaningTiles } from "../../../components/MeaningTiles.tsx";
import type { Step } from "../../../components/StepList.tsx";
import { TopUp } from "../../../components/TopUp.tsx";
import { TxLink } from "../../../components/TxLink.tsx";
import { WalletButton } from "../../../components/WalletButton.tsx";
import form from "../../../components/form.module.css";
import { buildEvalMsg, criteriaFromForm, downloadCiphertext, downloadName, EMPTY_CRITERIA, type CriteriaFormState } from "../../../lib/buy.ts";
import { announceText, buyGate, neededFor, showBuy, whyNotInspect } from "../../../lib/buyState.ts";
import { CONTRACTS, SITE_DOMAIN, type Network } from "../../../lib/config.ts";
import { describeError, type Described } from "../../../lib/errors.ts";
import { formatBits, formatUsdc, REFUND_LINE, stateLine } from "../../../lib/format.ts";
import { addressUrl, listingLinks } from "../../../lib/links.ts";
import { locateLatest } from "../../../lib/locate.ts";
import { checkPayment, paidHistory, payWithIntent, pendingPayment, PaymentPending, PaymentUnclear, setPaidResult, type PaidTx } from "../../../lib/pay.ts";
import type { PaidRecord, PendingPayment } from "../../../lib/pending.ts";
import type { ListingView } from "../../../lib/server/listingsCache.ts";
import { findEvent, PaymentRefused, SettleTimeout, waitForRecord } from "../../../lib/settle.ts";
import { suggestTopUp } from "../../../lib/topup.ts";
import type { Eoa } from "../../../lib/wallet.ts";
import styles from "./buy.module.css";

type Outcome =
  | { kind: "verdict"; state: State; evalId: number; h: string | null; hadList: boolean | undefined }
  | { kind: "refunded"; evalId: number; reason: string | null };

interface Delivery {
  purchaseId: number;
  releaseH: string | null;
  downloaded: string | null;
  saveUrl: string | null;
  saveName: string;
}

const STEP_LABELS = ["Wallet and viewing key", "Balance", "Your criteria", "Inspect", "Result", "Buy", "Download and verify"] as const;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function BuyFlow({ network, listing, programPk, readOnly, blockers, team = false }: {
  network: Network;
  listing: ListingView;
  programPk: string | null;
  readOnly: boolean;
  /** Why the contract would refuse an inspection or a purchase right now (paused, stale program, low tank), read on the server. */
  blockers: { inspect: string[]; buy: string[] };
  /** The seller is a team account: the summary names the team instead of a shortened account id. */
  team?: boolean;
}) {
  const evalFee = BigInt(listing.eval_fee);
  const price = BigInt(listing.price);
  const budgetMilli = listing.max_evals * listing.bits_per_eval_milli;
  const listingId = Number(listing.id);
  const views = useRef(new ArrowViews(network, CONTRACTS[network]));

  const [host, setHost] = useState<string | null>(null);
  const [eoa, setEoa] = useState<Eoa | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceKey, setBalanceKey] = useState(0);
  const [vk, setVk] = useState<ViewingKey | null>(null);
  const [mayBuy, setMayBuy] = useState(true);
  const [criteria, setCriteria] = useState<CriteriaFormState>(EMPTY_CRITERIA);
  const [spentMilli, setSpentMilli] = useState(listing.evals_used * listing.bits_per_eval_milli);
  const [busy, setBusy] = useState<null | "key" | "eval" | "buy" | "download" | "check">(null);
  const [error, setError] = useState<Described | null>(null);
  const [slow, setSlow] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [evalTx, setEvalTx] = useState<PaidTx | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmBuy, setConfirmBuy] = useState<null | "pass" | "unverified">(null);
  const [buyTx, setBuyTx] = useState<PaidTx | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [needManual, setNeedManual] = useState(false);
  const [refund, setRefund] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);
  const [history, setHistory] = useState<PaidRecord[]>([]);
  const abort = useRef(new AbortController());
  const keyRef = useRef<Uint8Array | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const deliveryHeading = useRef<HTMLHeadingElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const buyButton = useRef<HTMLButtonElement>(null);
  const refocusBuy = useRef(false);

  useEffect(() => {
    setHost(window.location.host);
    const ac = (abort.current = new AbortController()); // a fresh one per mount: strict mode runs effects twice in dev
    return () => {
      ac.abort();
      keyRef.current?.fill(0);
    };
  }, []);

  // A reload during the 60-120 s wait must not lose a paid inspection or purchase, nor sign a second payment (RELAY-3).
  const reloadStores = useCallback(() => {
    if (!eoa) {
      setPending(null);
      setHistory([]);
      return;
    }
    setPending(pendingPayment(eoa));
    setHistory(paidHistory(eoa, listingId).filter((r) => r.kind !== "list").slice(-5));
  }, [eoa, listingId]);
  useEffect(reloadStores, [reloadStores]);

  useEffect(() => {
    if (busy === null || busy === "check") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    if (outcome) resultHeading.current?.focus();
  }, [outcome]);
  useEffect(() => {
    if (delivery?.saveUrl || buyTx) deliveryHeading.current?.focus(); // the Buy button that had focus is gone
  }, [delivery?.saveUrl, buyTx]);
  useEffect(() => {
    if (confirmBuy) cancelButton.current?.focus();
    else if (refocusBuy.current) {
      refocusBuy.current = false;
      buyButton.current?.focus(); // Cancel removed itself; the Buy button is back after this render
    }
  }, [confirmBuy]);

  const resetWallet = useCallback(() => {
    setEoa(null);
    setBalance(null);
    setVk(null);
    keyRef.current?.fill(0);
    keyRef.current = null;
  }, []);

  const wrongDomain = network === "mainnet" && host !== null && (SITE_DOMAIN === "" || host !== SITE_DOMAIN);
  const verdictIn = outcome?.kind === "verdict";
  const exhausted = spentMilli >= budgetMilli;
  const bought = buyTx !== null || delivery !== null;
  const needed = neededFor({ evalFee, price, mayBuy, verdictIn, exhausted, bought });
  const lowBalance = eoa !== null && balance !== null && balance < needed;
  const locked = readOnly || programPk === null;

  const steps: Step[] = [
    { label: STEP_LABELS[0], state: vk ? "done" : busy === "key" ? "doing" : "todo" },
    { label: STEP_LABELS[1], state: balance === null ? "todo" : lowBalance ? "doing" : "done", detail: balance === null ? undefined : `${formatUsdc(balance)} USDC` },
    { label: STEP_LABELS[2], state: criteria.text.trim() ? "done" : "todo" },
    { label: STEP_LABELS[3], state: outcome || evalTx ? "done" : busy === "eval" ? "doing" : "todo" },
    { label: STEP_LABELS[4], state: outcome ? (outcome.kind === "verdict" ? "done" : "failed") : evalTx ? "doing" : "todo" },
    { label: STEP_LABELS[5], state: buyTx || delivery ? "done" : busy === "buy" ? "doing" : "todo" },
    { label: STEP_LABELS[6], state: delivery?.saveUrl ? "done" : busy === "download" ? "doing" : "todo" },
  ];

  // The step cards: done = a check in the corner, the first open step = accent outline, later ones = muted (presentation only).
  // The number lives in each heading ("1. Wallet and viewing key"), so the card does not repeat it.
  const current = steps.findIndex((s) => s.state !== "done");
  const stepClass = (i: number) =>
    `${form.panel} ${styles.step} ${steps[i]!.state === "done" ? styles.done : i === current && !locked ? styles.now : steps[i]!.state === "failed" ? styles.failed : styles.later}`;
  const mark = (i: number) => (
    steps[i]!.state === "done" ? <span className={styles.num} aria-hidden="true">✓</span> : null
  );
  /** A step whose section is not shown yet: its number, its name and what it will do. */
  const upcoming = (i: number, sub: string) => (
    <div className={`${form.panel} ${styles.step} ${styles.later}`}>
      {mark(i)}
      <p className={styles.upTitle}>{i + 1}. {STEP_LABELS[i]}</p>
      <p className={styles.sub}>{sub}</p>
    </div>
  );

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

  /** What a failed pay step leaves behind: an unconfirmed payment is kept and shown, never silently dropped. */
  function failure(e: unknown) {
    setWaitingSince(null);
    if (e instanceof PaymentRefused) setEvalTx(null);
    if (e instanceof PaymentUnclear || e instanceof PaymentPending) {
      setPending(e.pending);
      setError(describeError(e));
      return;
    }
    setError(describeError(e));
  }

  /** The id the contract gave a paid action: from the stored answer, from the transaction, or by looking for it on chain. */
  async function resultIdOf(r: PaidRecord): Promise<number> {
    if (r.resultId !== null) return r.resultId;
    if (!vk) throw new Error("Sign for your viewing key first.");
    let id: number;
    if (r.tx) {
      const name = r.kind === "eval" ? "arrow_eval" : "arrow_purchase";
      const field = r.kind === "eval" ? "eval_id" : "purchase_id";
      id = Number((await findEvent(network, r.tx, name, { phase: "accepted", idField: field, signal: abort.current.signal }))[field]);
    } else {
      // The relay lost the transaction hash but the payment happened: it is the newest record with our key on this listing.
      const since = r.at - 60_000;
      const read = (n: number) => (r.kind === "eval" ? views.current.eval(n) : views.current.purchase(n));
      const known = new Set(history.map((h) => h.resultId));
      const found = await locateLatest(read, (rec) => Number(rec.listing_id) === listingId && rec.buyer_pk === vk.buyerPk && !known.has(Number(rec.id)) && Number(rec.created_at_ns ?? 0) / 1e6 >= since);
      if (!found) throw new Error("The payment went through, but its record could not be found yet. Try again in a minute.");
      id = Number(found.id);
    }
    if (eoa) setPaidResult(eoa, r.at, id);
    reloadStores();
    return id;
  }

  async function showEval(evalId: number, hadList: boolean | undefined) {
    if (!vk) return;
    const rec = await settle("The inspection", () => views.current.eval(evalId));
    setWaitingSince(null);
    if (rec.buyer_pk !== vk.buyerPk) throw new Error("That inspection was made with another viewing key, so this one cannot read it.");
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
    setOutcome({ kind: "verdict", state, evalId, h: rec.h ?? null, hadList });
  }

  async function showPurchase(purchaseId: number) {
    if (!vk) return;
    const rec = await settle("The purchase", () => views.current.purchase(purchaseId));
    setWaitingSince(null);
    if (rec.buyer_pk !== vk.buyerPk) throw new Error("That purchase was made with another viewing key, so this one cannot open it.");
    if (rec.status === "refunded") {
      setRefund(rec.refund_reason ?? "unknown");
      return;
    }
    if (!rec.sealed_k_buyer) throw new Error("The contract marked the purchase done without a key.");
    keyRef.current?.fill(0);
    keyRef.current = openRelease(rec.sealed_k_buyer, vk.scalarHex);
    setDelivery({ purchaseId, releaseH: rec.h ?? null, downloaded: null, saveUrl: null, saveName: "" });
    await verifyBlob(null, rec.h ?? null, purchaseId);
  }

  async function inspect() {
    if (!eoa || !vk || !programPk) return;
    setError(null);
    setOutcome(null);
    setSlow(false);
    let msg: string;
    let hadList: boolean;
    try {
      const c = criteriaFromForm(criteria, listing.columns);
      hadList = c.minhash !== undefined && c.minhash !== "";
      msg = buildEvalMsg({ listingId, criteria: c, buyerPk: vk.buyerPk, programPk });
    } catch (e) {
      setError(describeError(e));
      return;
    }
    setBusy("eval");
    try {
      const paid = await payWithIntent(eoa, { kind: "eval", listingId, amount: evalFee, msg, meta: { hadList } });
      setEvalTx(paid);
      reloadStores();
      setWaitingSince(Date.now());
      const ev = await findEvent(network, paid, "arrow_eval", { phase: "accepted", idField: "eval_id", signal: abort.current.signal });
      const evalId = Number(ev.eval_id);
      setPaidResult(eoa, paid.at, evalId);
      if (typeof ev.left_milli === "number") setSpentMilli(budgetMilli - ev.left_milli);
      await showEval(evalId, hadList);
    } catch (e) {
      failure(e);
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    if (!eoa || !vk) return;
    setError(null);
    setConfirmBuy(null);
    setBusy("buy");
    try {
      const paid = await payWithIntent(eoa, { kind: "buy", listingId, amount: price, msg: prepareBuy({ listingId, buyerPk: vk.buyerPk }) });
      setBuyTx(paid);
      reloadStores();
      setWaitingSince(Date.now());
      const ev = await findEvent(network, paid, "arrow_purchase", { phase: "accepted", idField: "purchase_id", signal: abort.current.signal });
      const purchaseId = Number(ev.purchase_id);
      setPaidResult(eoa, paid.at, purchaseId);
      await showPurchase(purchaseId);
    } catch (e) {
      failure(e);
    } finally {
      setBusy(null);
    }
  }

  /** "Show result" / "Get the file" for a payment made earlier (this tab, a reload, or a lost relay answer). */
  async function resume(r: PaidRecord) {
    if (!vk) return;
    setError(null);
    setSlow(false);
    setBusy(r.kind === "buy" ? "buy" : "eval");
    try {
      const id = await resultIdOf(r);
      if (r.kind === "buy") {
        if (r.tx) setBuyTx(r.tx);
        setWaitingSince(Date.now());
        await showPurchase(id);
      } else {
        if (r.tx) setEvalTx(r.tx);
        setOutcome(null);
        setWaitingSince(Date.now());
        await showEval(id, r.meta?.hadList);
      }
    } catch (e) {
      failure(e);
    } finally {
      setBusy(null);
    }
  }

  /** "Check payment": sends the stored signed payment again; it never asks the wallet to sign. */
  async function checkPay() {
    if (!eoa) return;
    setError(null);
    setBusy("check");
    try {
      const r = await checkPayment(eoa);
      reloadStores();
      if (r.state === "paid") setPayNote("The payment went through. Use Show result or Get the file below.");
      else if (r.state === "paid-no-tx") setPayNote("The payment went through, but the relay lost its transaction link. Use Show result or Get the file below; the page will find it on chain.");
      else if (r.state === "released") setPayNote("That signed payment expired without being paid. You can pay again.");
      else if (r.state === "waiting") setPayNote(`Still not confirmed. The signed payment expires at ${new Date(r.until).toLocaleTimeString()}; until then do not pay again, and check again in a minute.`);
    } catch (e) {
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
      let downloaded: string | null = null;
      if (!bytes) {
        const got = await downloadCiphertext(listing.blob_url, listing.blob_sha256);
        if (got.kind === "manual") {
          setNeedManual(true);
          setDelivery((d) => d ?? { purchaseId, releaseH, downloaded: null, saveUrl: null, saveName: "" });
          return;
        }
        if (got.kind === "too-large") throw new Error(`The host sent more than ${MAX_BLOB_BYTES} bytes. The download was stopped.`);
        if (got.kind === "mismatch") downloaded = got.actual;
        else bytes = got.bytes;
      }
      if (bytes) {
        if (bytes.length > MAX_BLOB_BYTES) throw new Error(`The file is ${bytes.length} bytes; the limit is ${MAX_BLOB_BYTES}.`);
        downloaded = sha256Hex(bytes);
      }
      const ok = bytes !== null && downloaded === listing.blob_sha256 && releaseH === listing.blob_sha256 && (outcome?.kind !== "verdict" || outcome.h === null || outcome.h === listing.blob_sha256);
      let saveUrl: string | null = null;
      let saveName = "";
      const k = keyRef.current;
      if (ok && k && bytes) {
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
  const inspectWhy = whyNotInspect({
    readOnly,
    programKeyMissing: programPk === null,
    wrongDomain,
    vk: vk !== null,
    lowBalance,
    exhausted,
    criteriaEmpty: criteria.text.trim() === "",
    busy: busy !== null,
    verdictIn,
    paymentPending: pending !== null,
    blockers: blockers.inspect,
  });
  const canInspect = inspectWhy.length === 0;
  const buyVisible = showBuy({ vk: vk !== null, bought, readOnly, wrongDomain, locked });
  const buyBlocked = busy !== null || lowBalance || pending !== null || blockers.buy.length > 0;
  const gate = buyGate(outcome?.kind === "verdict" ? outcome.state : null);
  const evalH = outcome?.kind === "verdict" ? outcome.h : undefined;
  const hasEvalH = outcome?.kind === "verdict";
  const lineOf = (o: Extract<Outcome, { kind: "verdict" }>) => stateLine(o.state, listing.mode, { hadList: o.hadList });
  const announce = announceText({
    waiting: waitingSince !== null && busy === "eval" ? "inspect" : waitingSince !== null && busy === "buy" ? "buy" : null,
    slow,
    outcome: outcome ? (outcome.kind === "verdict" ? { kind: "verdict", line: lineOf(outcome) } : { kind: "refunded" }) : null,
    purchaseRefund: refund !== null,
    saved: delivery?.saveUrl != null,
    error: error?.message ?? null,
  });

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Announcer text={announce} />
      <div className={styles.layout}>
      <aside className={styles.aside}>
        <section className={styles.summary} aria-labelledby="listing-title">
          <div className={styles.top}>
            <Badge kind={listing.label} />
            <span className="mono">listing #{listingId}</span>
          </div>
          <h1 id="listing-title" className={styles.title}><bdi>{listing.displayTitle}</bdi></h1>
          <p className={form.hint}>
            Seller{" "}
            {team ? (
              <a href={addressUrl(listing.seller, network)} target="_blank" rel="noopener noreferrer" title={listing.seller}>the Arrow team<span className="sr-only"> (account {listing.seller}, opens in a new tab)</span></a>
            ) : (
              <a href={addressUrl(listing.seller, network)} target="_blank" rel="noopener noreferrer" className="mono" title={listing.seller}>{short(listing.seller)}</a>
            )}
          </p>
          {listing.public_desc ? <p className={styles.desc}><bdi>{listing.public_desc}</bdi></p> : null}
          <div className={styles.prices}>
            <div><span>Inspect</span><b>${formatUsdc(evalFee)} <small>USDC</small></b></div>
            <div><span>Buy</span><b>${formatUsdc(price)} <small>USDC</small></b></div>
          </div>
          <p className={styles.facts}>
            ~{Number(listing.rows_claimed).toLocaleString("en-US")} rows claimed by the seller · {listing.columns.length} columns · {listing.mode} mode
          </p>
          {exhausted ? <p className={form.error}>No inspection is possible any more: you would be buying blind.</p> : null}
          {programPk === null && !readOnly ? <p className={form.error}>The enclave key is not published yet, so inspections are closed.</p> : null}
          {[...new Set([...blockers.inspect, ...blockers.buy])].map((b) => (
            <p key={b} className={form.error}>{b}</p>
          ))}
        </section>
        <details className={styles.disc}>
          <summary>Columns in this file ({listing.columns.length})</summary>
          <p className="mono"><bdi>{listing.columns.join(", ")}</bdi></p>
        </details>
        <details className={styles.disc}>
          <summary>What one inspection can reveal</summary>
          <p>
            One inspection answers with one of a fixed set of verdicts: at most {formatBits(listing.bits_per_eval_milli)} bits, and {formatBits(budgetMilli)} bits over
            all {listing.max_evals} inspections of this listing.
          </p>
          <div title="Counts every eval, including refunded ones." className={styles.counter}>
            <BitCounter spentBits={spentMilli / 1000} budgetBits={budgetMilli / 1000} />
          </div>
          <p>The AI reads a 40-row sample. Run time and instruction count are public too and are not counted here.</p>
        </details>
        <details className={styles.disc} id="agents">
          <summary>For agents: 402 endpoint</summary>
          <p>
            <a className="mono" href={listingLinks(listing.id, network).x402}>{listingLinks(listing.id, network).x402}</a> answers HTTP 402 with this listing&apos;s
            id; payment goes through NEAR Intents. CLI: <span className="mono">npm run arrow -- eval --help</span>
          </p>
        </details>
        <div className={styles.who}>
          <p className={styles.whoTitle}>Who sees what on this page</p>
          <ul>
            <li>Your criteria: the enclave and the AI, not the seller. This page&apos;s JavaScript, served by Arrow, handles them too, and the group that governs OutLayer&apos;s keystore could unseal them.</li>
            <li>Your viewing key: the step 1 signature makes it, and anyone who gets that same signature can make it too. Sign it only on this site.</li>
            <li>Your 0x address and what you paid: public on chain.</li>
            <li>The rows: the AI, in its own sealed hardware, reads a 40-row sample; you see none until you buy.</li>
          </ul>
          <a href="/#trust-table">Full trust table →</a>
        </div>
      </aside>

      <div className={styles.steps}>
      {pending ? (
        <section className={form.panel} aria-labelledby="pend">
          <h2 id="pend">A payment is waiting for confirmation</h2>
          <p>
            You signed a payment of ${formatUsdc(BigInt(pending.amount))} USDC ({pending.kind === "eval" ? "an inspection" : pending.kind === "buy" ? "a purchase" : "a listing bond"}
            {pending.listingId !== null ? ` on listing #${pending.listingId}` : ""}) and the relay could not say whether it went through. Do not pay again. This
            page sends the same signed payment again and signs nothing new.
          </p>
          <button type="button" className={form.primary} disabled={busy !== null || !eoa} onClick={() => void checkPay()}>
            {busy === "check" ? "Checking…" : "Check payment"}
          </button>
          {payNote ? <p role="status" className={form.hint}>{payNote}</p> : null}
        </section>
      ) : payNote ? (
        <p role="status" className={form.band}>{payNote}</p>
      ) : null}

      <section className={stepClass(0)} aria-labelledby="b1">
        {mark(0)}
        <h2 id="b1">1. Wallet and viewing key</h2>
        <p className={styles.sub}>Connect an Ethereum-style wallet such as MetaMask (it pays with USDC from Base; no NEAR account needed), then sign once. The signature makes your private viewing key, the key that opens your verdicts; no money moves.</p>
        <WalletButton eoa={eoa} balance={balance} onConnect={setEoa} onBalance={setBalance} onReset={resetWallet} refreshKey={balanceKey} />
        {wrongDomain ? <p className={form.error} role="alert">Viewing keys are bound to {SITE_DOMAIN || "the site domain, which is not set"}. Open Arrow there.</p> : null}
        <p className={styles.sign}>
          Signature 1 of 2 (a message, no money moves): derives your private viewing key. The result is decrypted with it, and it is not stored; reloading asks again.
        </p>
        <button type="button" disabled={!eoa || vk !== null || busy !== null || wrongDomain || locked} onClick={() => void deriveKey()}>
          {vk ? "Viewing key ready" : busy === "key" ? "Waiting for your wallet…" : "Sign to derive my viewing key"}
        </button>
        <p className={form.hint}>A regular wallet account is needed; smart-contract wallets (EIP-1271) are not supported. The same signature always makes the same key, so sign it only on this site.</p>
      </section>

      <section className={stepClass(1)} aria-labelledby="b2">
        {mark(1)}
        <h2 id="b2">2. Balance</h2>
        <p className={styles.sub}>What you can spend from your NEAR Intents balance, a USDC balance held for your wallet on NEAR. Top it up from Base USDC if needed.{balance !== null ? <> Now: <span className="mono">{formatUsdc(balance)} USDC</span>.</> : null}</p>
        <label className={styles.check}>
          <input type="checkbox" checked={mayBuy} onChange={(e) => setMayBuy(e.target.checked)} /> I may buy after inspecting (plan for ${formatUsdc(price)} more)
        </label>
        {lowBalance && eoa ? (
          <TopUp eoa={eoa} defaultAmount={suggestTopUp(needed, balance ?? 0n)} onSuccess={() => setBalanceKey((k) => k + 1)} />
        ) : (
          <p className={form.hint}>Needs ${formatUsdc(needed)} on your NEAR Intents balance.</p>
        )}
      </section>

      <section className={stepClass(2)} aria-labelledby="b3">
        {mark(2)}
        <h2 id="b3">3. Your criteria</h2>
        <p className={styles.sub}>Say what you need in one or two sentences. The seller cannot read it.</p>
        <CriteriaForm columns={listing.columns} value={criteria} onChange={setCriteria} />
      </section>

      <section className={stepClass(3)} aria-labelledby="b4">
        {mark(3)}
        <h2 id="b4">4. Inspect for ${formatUsdc(evalFee)}</h2>
        <p className={styles.sub}>In sealed hardware, Arrow&apos;s program opens the file and sends a 40-row sample to an AI, in its own sealed hardware, that judges it against your criteria. 45 to 120 seconds.</p>
        <p className={styles.sign} id="b4-sign">
          Signature 2 of 2: this signs a payment of ${formatUsdc(evalFee)} USDC from your Intents balance to {CONTRACTS[network]}. Your wallet shows the payment as a JSON message: check the receiver and the amount.
        </p>
        <button
          type="button"
          className={form.primary}
          aria-disabled={!canInspect}
          aria-describedby={canInspect ? "b4-sign" : "b4-sign b4-why"}
          onClick={() => {
            if (canInspect) void inspect();
          }}
        >
          {busy === "eval" ? "Inspecting…" : `Inspect · $${formatUsdc(evalFee)}`}
        </button>
        {!canInspect ? (
          <ul id="b4-why" className={`${form.hint} ${form.why}`}>
            {inspectWhy.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {waitingSince !== null && busy === "eval" ? (
          <p>
            The enclave and NEAR AI are evaluating the listing (about 45 to 120 s). <Countdown startedAt={waitingSince} label="waiting" />
            {slow ? " Still waiting. If OutLayer does not answer within its window, your payment is refunded to your NEAR Intents balance, less the treasury's 10% share of an inspection fee." : ""}
          </p>
        ) : null}
        {evalTx ? <p>Payment <TxLink chain="near" network={network} hash={evalTx.txHash} /></p> : null}
      </section>

      {history.length > 0 && eoa ? (
        <section className={form.panel} aria-labelledby="hist">
          <h2 id="hist">Your earlier payments on this listing</h2>
          <p className={form.hint}>Kept in this browser. They let you get a result back after a reload. {vk ? "" : "Sign for your viewing key (step 1) to open them."}</p>
          <ul>
            {history.map((r) => (
              <li key={r.at}>
                {r.kind === "eval" ? "Inspection" : "Purchase"} · {new Date(r.at).toLocaleString()}
                {r.tx ? <> · <TxLink chain="near" network={network} hash={r.tx.txHash} /></> : null}
                {r.resultId !== null ? ` · #${r.resultId}` : ""}{" "}
                <button type="button" aria-disabled={vk === null || busy !== null} onClick={() => { if (vk && busy === null) void resume(r); }}>
                  {r.kind === "eval" ? "Show result" : "Get the file"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outcome ? (
        <section className={stepClass(4)} aria-labelledby="b5">
          {mark(4)}
          <h2 id="b5" tabIndex={-1} ref={resultHeading}>5. Result</h2>
          {outcome.kind === "verdict" ? (
            <>
              <p className={`${styles.verdict} ${verdictClass}`}>{lineOf(outcome)}</p>
              <p className="mono">out: {formatBits(listing.bits_per_eval_milli)} bits / budget {formatBits(budgetMilli)} bits</p>
              <MeaningTiles />
              <p className={form.hint}>A PASS means walk away: you spent the fee and nothing else. The LLM cannot produce BUY unless the structural gates pass.</p>
              {evalTx ? (
                <CopyEvidence
                  run={{
                    kind: "eval", tx: evalTx.txHash, chain: "near", listing_id: listingId, eval_id: outcome.evalId,
                    expect: "eval op accepted and answered with one capped verdict",
                    observed: `${lineOf(outcome)} for eval ${outcome.evalId} of listing ${listingId}`,
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

      {outcome ? null : upcoming(4, "BUY or PASS, with fit and novelty from 1 to 5 if the seller allows scores, decrypted here with your viewing key.")}

      {buyVisible ? (
        <section className={stepClass(5)} aria-labelledby="b6">
          {mark(5)}
          <h2 id="b6">6. Buy for ${formatUsdc(price)}</h2>
          <p className={styles.sub}>The program checks the file is the one it inspected, then seals its key to you.</p>
          {confirmBuy ? (
            <div role="group" aria-labelledby="b6-confirm">
              <p id="b6-confirm">
                {confirmBuy === "pass"
                  ? "Your inspection said PASS. Buy anyway?"
                  : "You have no verdict from this page for this listing (the budget may be used up, or the inspection was refunded or made earlier). Buy without one?"}
              </p>
              <button type="button" ref={cancelButton} onClick={() => { refocusBuy.current = true; setConfirmBuy(null); }}>Cancel</button>{" "}
              <button type="button" className={form.primary} disabled={buyBlocked} onClick={() => void buy()}>Buy anyway</button>
            </div>
          ) : (
            <>
              <p className={styles.sign}>This signs a payment of ${formatUsdc(price)} USDC from your Intents balance to {CONTRACTS[network]}.</p>
              <button
                type="button"
                ref={buyButton}
                className={form.primary}
                aria-disabled={buyBlocked}
                onClick={() => {
                  if (buyBlocked) return;
                  if (gate === "direct") void buy();
                  else setConfirmBuy(gate === "pass" ? "pass" : "unverified");
                }}
              >
                {busy === "buy" ? "Buying…" : `Buy · $${formatUsdc(price)}`}
              </button>
              {lowBalance ? <p className={form.hint}>Your Intents balance is below the price: add USDC in step 2.</p> : null}
              {pending ? <p className={form.hint}>An earlier payment is not confirmed yet: check it first.</p> : null}
            </>
          )}
        </section>
      ) : null}

      {buyVisible ? null : upcoming(5, "Opens once your wallet is connected and signed (step 1). Buying after a PASS, or without a verdict, asks you to confirm first.")}

      {buyTx || delivery || refund ? (
        <section className={stepClass(6)} aria-labelledby="b7">
          {mark(6)}
          <h2 id="b7" tabIndex={-1} ref={deliveryHeading}>7. Download and verify</h2>
          <p className={styles.sub}>Your browser downloads the sealed file, checks its fingerprint and decrypts it with your key. Open a CSV in a text editor first.</p>
          <p>
            {buyTx ? <>Payment <TxLink chain="near" network={network} hash={buyTx.txHash} /></> : "Purchase found on chain"}
            {waitingSince !== null && busy === "buy" ? <> · <Countdown startedAt={waitingSince} label="waiting for the key" /></> : null}
          </p>
          {refund ? <p className={form.error}>The purchase failed on chain ({refund}). {REFUND_LINE}</p> : null}
          {needManual ? (
            <div>
              <p className={form.error}>Your browser could not download the file from its host. <a href={listing.blob_url} target="_blank" rel="noopener noreferrer">Open the link</a>, save the file, and choose it here.</p>
              <input
                type="file"
                aria-label="The encrypted file you saved"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f || !delivery) return;
                  if (f.size > MAX_BLOB_BYTES) {
                    setError(describeError(new Error(`That file is ${f.size} bytes; the limit is ${MAX_BLOB_BYTES}.`)));
                    return;
                  }
                  await verifyBlob(new Uint8Array(await f.arrayBuffer()), delivery.releaseH, delivery.purchaseId);
                }}
              />
            </div>
          ) : null}
          {delivery ? (
            <>
              <HashTriple onChain={listing.blob_sha256} enclave={hasEvalH ? evalH : undefined} release={delivery.releaseH} downloaded={delivery.downloaded} />
              {delivery.saveUrl ? (
                <p className={form.hint}>
                  Open this file in a text editor first. A spreadsheet runs formulas (cells starting with =, +, - or @), and this file comes from the seller.
                </p>
              ) : null}
              {delivery.saveUrl ? (
                <p>
                  <a className={form.primary} style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, textDecoration: "none" }} href={delivery.saveUrl} download={delivery.saveName}>Save {delivery.saveName}</a>
                </p>
              ) : null}
              {buyTx ? (
                <CopyEvidence
                  run={{
                    kind: "buy", tx: buyTx.txHash, chain: "near", listing_id: listingId, purchase_id: delivery.purchaseId,
                    expect: "buy op released K and sha256(downloaded) == listing.blob_sha256 == eval h == release h",
                    observed: delivery.downloaded === listing.blob_sha256 ? "hash chain matched" : "hash chain not matched",
                  }}
                />
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {buyTx || delivery || refund ? null : upcoming(6, "Your browser downloads the sealed file, checks its fingerprint and decrypts it with your key.")}

      {error ? (
        <ErrorBox title="That step did not finish" fallback={error.fallback}>
          <p>{error.message}</p>
        </ErrorBox>
      ) : null}
      </div>
      </div>
    </fieldset>
  );
}
