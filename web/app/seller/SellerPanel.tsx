"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NETWORKS } from "@arrow/sdk/config";
import { generateIntent, outboundQuoteRequest, quote, submitIntent, TERMINAL_STATUSES, type OneClickStatus } from "@arrow/sdk/oneclick";
import { signRawErc191 } from "@arrow/sdk/intent";
import { Announcer } from "../../components/Announcer.tsx";
import { BitCounter } from "../../components/BitCounter.tsx";
import { CopyEvidence } from "../../components/CopyEvidence.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { TxLink } from "../../components/TxLink.tsx";
import { WalletButton } from "../../components/WalletButton.tsx";
import { Countdown } from "../../components/Countdown.tsx";
import form from "../../components/form.module.css";
import type { Network } from "../../lib/config.ts";
import { describeError, type Described } from "../../lib/errors.ts";
import { formatUsdc } from "../../lib/format.ts";
import { listingLinks } from "../../lib/links.ts";
import { fetchListings } from "../../lib/listingsClient.ts";
import { isSolanaAddress, listingsOf, looksLikeMissingTokenAccount, parseWithdrawal } from "../../lib/seller.ts";
import type { ListingView } from "../../lib/server/listingsCache.ts";
import { assertWithdrawPayload, destinationTxHash, erc191Payload, watchSwap } from "../../lib/swap.ts";
import { type Eoa, intentSigner } from "../../lib/wallet.ts";
import styles from "./seller.module.css";

type Phase =
  | { k: "idle" }
  | { k: "quoting" }
  | { k: "preview"; solana: string; units: bigint; out: string; etaSec: number }
  | { k: "signing" }
  | { k: "waiting"; startedAt: number; status: OneClickStatus }
  | { k: "done"; status: OneClickStatus; deposit: string; solTx: string | null; amount: bigint };

export function SellerPanel({ network, readOnly }: { network: Network; readOnly: boolean }) {
  const [eoa, setEoa] = useState<Eoa | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceKey, setBalanceKey] = useState(0);
  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [solana, setSolana] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [error, setError] = useState<Described | null>(null);
  const [ataHint, setAtaHint] = useState(false);
  const abort = useRef(new AbortController());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const ac = (abort.current = new AbortController()); // a fresh one per mount: strict mode runs effects twice in dev
    return () => {
      alive.current = false;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    setListings(null);
    setListError(null);
    fetchListings(network).then(
      (l) => alive.current && setListings(l),
      (e: unknown) => alive.current && setListError(e instanceof Error ? e.message : "could not load the listings"),
    );
  }, [network]);

  const resetWallet = useCallback(() => {
    setEoa(null);
    setBalance(null);
    setPhase({ k: "idle" });
  }, []);

  const mine = eoa && listings ? listingsOf(listings, eoa.intentsId) : null;

  function fail(e: unknown, label: string) {
    if (!alive.current || (e instanceof Error && e.name === "AbortError")) return;
    const text = e instanceof Error ? e.message : "";
    setAtaHint(looksLikeMissingTokenAccount(text));
    const d = describeError(e);
    setError(d.message.startsWith("Something went wrong") ? { message: `${label} ${text.slice(0, 200)}` } : d);
    setPhase({ k: "idle" });
  }

  async function preview() {
    if (!eoa || balance === null) return;
    setError(null);
    setAtaHint(false);
    try {
      const w = parseWithdrawal({ solana, amount, balance });
      setPhase({ k: "quoting" });
      const r = await quote(outboundQuoteRequest({ amount: w.units.toString(), sellerEvm: eoa.address, solana: w.solana, dry: true }));
      if (alive.current) setPhase({ k: "preview", solana: w.solana, units: w.units, out: r.quote.amountOutFormatted, etaSec: r.quote.timeEstimate });
    } catch (e) {
      fail(e, "1Click could not quote this withdrawal.");
    }
  }

  async function withdraw(p: { solana: string; units: bigint }) {
    if (!eoa) return;
    setError(null);
    setPhase({ k: "signing" });
    try {
      const real = await quote(outboundQuoteRequest({ amount: p.units.toString(), sellerEvm: eoa.address, solana: p.solana, dry: false }));
      const deposit = real.quote.depositAddress;
      if (!deposit) throw new Error("1Click returned no deposit address");
      const { intent } = await generateIntent({ signerId: eoa.intentsId, depositAddress: deposit });
      // The payload is signed byte for byte, and intents.near also accepts add_public_key and withdraw intents: it must be exactly
      // one transfer of the chosen USDC from this account to this quote's deposit address, or nothing is signed.
      const payload = erc191Payload(intent);
      assertWithdrawPayload(payload, { signerId: eoa.intentsId, depositAddress: deposit, usdcToken: NETWORKS.mainnet.usdcToken, units: p.units });
      const signed = await signRawErc191(payload, intentSigner(eoa));
      await submitIntent(signed);
      const startedAt = Date.now();
      setPhase({ k: "waiting", startedAt, status: "PENDING_DEPOSIT" });
      const last = await watchSwap(deposit, {
        signal: abort.current.signal,
        onTick: (s) => alive.current && setPhase({ k: "waiting", startedAt, status: s.status }),
      });
      if (!alive.current) return;
      setPhase({ k: "done", status: last?.status ?? "PROCESSING", deposit, solTx: destinationTxHash(last), amount: p.units });
      if (last?.status === "SUCCESS") setBalanceKey((k) => k + 1);
    } catch (e) {
      fail(e, "The withdrawal did not complete.");
    }
  }

  const announce =
    phase.k === "signing" ? "Waiting for your wallet: sign the withdrawal."
    : phase.k === "waiting" ? `1Click status ${phase.status}.`
    : phase.k === "done" ? (phase.status === "SUCCESS" ? "The withdrawal is done." : `The withdrawal ended with status ${phase.status}.`)
    : error ? `That did not work: ${error.message}`
    : "";
  const quoting = phase.k === "quoting";
  const showForm = phase.k === "idle" || phase.k === "quoting" || phase.k === "preview";

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Announcer text={announce} />
      <section className={form.panel} aria-labelledby="p1">
        <h2 id="p1">Wallet</h2>
        <WalletButton eoa={eoa} balance={balance} onConnect={setEoa} onBalance={setBalance} onReset={resetWallet} refreshKey={balanceKey} />
        {readOnly ? <p className={form.hint}><b>Connecting is switched off on this network</b>, because payouts run on mainnet, where the market is live; it is not locked yet, so the team can still change it.</p> : null}
      </section>

      <section className={form.panel} aria-labelledby="p2">
        <h2 id="p2">Your listings</h2>
        {!eoa ? (
          <EmptyState title="Connect your wallet to see your listings." />
        ) : listError ? (
          <ErrorBox title="Could not load the listings" fallback="Reload in a minute."><p className="mono">{listError}</p></ErrorBox>
        ) : mine === null ? (
          <Skeleton height={96} />
        ) : mine.length === 0 ? (
          <EmptyState title="No listings from this address yet.">
            <Link href="/sell">Sell data</Link>
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {mine.map((l) => (
              <li key={String(l.id)} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong><bdi>{l.displayTitle}</bdi></strong>
                  <span>{l.evals_used} / {l.max_evals} inspections used</span>
                  <Link href={listingLinks(l.id, network).buy}>Open #{String(l.id)}</Link>
                </div>
                <BitCounter spentBits={l.budget.spentBits} budgetBits={l.budget.budgetBits} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={form.panel} aria-labelledby="p3">
        <h2 id="p3">Withdraw to Solana <span className={styles.chip}>untested from this page</span></h2>
        <p className={form.hint}>
          This signs a withdrawal from your NEAR Intents balance to a Solana address. You receive USDC on Solana; 1Click may take a few minutes.
        </p>
        {showForm ? (
          <>
            <div className={form.field}>
              <label htmlFor="sol">Solana address</label>
              <input id="sol" value={solana} onChange={(e) => { setSolana(e.target.value); if (phase.k === "preview") setPhase({ k: "idle" }); }} autoComplete="off" spellCheck={false} />
              <p className={form.hint}>
                {solana && !isSolanaAddress(solana.trim()) ? "That is not a Solana address yet. " : ""}
                Use the address of a wallet, not a token account. If it never held USDC, 1Click creates its USDC account and charges for it in the quote.
              </p>
            </div>
            <div className={form.field}>
              <label htmlFor="amt">Amount (USDC){balance !== null ? `, up to ${formatUsdc(balance)}` : ""}</label>
              <input id="amt" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); if (phase.k === "preview") setPhase({ k: "idle" }); }} />
            </div>
            {phase.k === "preview" ? (
              <p>
                You withdraw {formatUsdc(phase.units)} USDC and receive about <strong>{phase.out} USDC</strong> on Solana (about {phase.etaSec} s).
              </p>
            ) : null}
            <div className={form.actions}>
              <button type="button" disabled={!eoa || balance === null || quoting} onClick={() => void preview()}>{quoting ? "Getting a quote…" : "Preview"}</button>
              {phase.k === "preview" ? <button type="button" className={form.primary} onClick={() => void withdraw(phase)}>Sign and withdraw</button> : null}
            </div>
          </>
        ) : null}
        {phase.k === "signing" ? <p role="status">Waiting for your wallet: sign the withdrawal.</p> : null}
        {phase.k === "waiting" ? (
          <p role="status">
            1Click status <strong>{phase.status}</strong> · <Countdown startedAt={phase.startedAt} label="elapsed" />
            <br />
            <span className={form.hint}>You can leave this page; the withdrawal continues.</span>
          </p>
        ) : null}
        {phase.k === "done" ? (
          <div role="status">
            <p className={phase.status === "SUCCESS" ? form.ok : form.error}>
              {phase.status === "SUCCESS" ? `Done: ${formatUsdc(phase.amount)} USDC left your Intents balance for Solana.` : null}
              {phase.status === "REFUNDED" ? "1Click refunded the withdrawal to your NEAR Intents balance." : null}
              {phase.status === "FAILED" ? "1Click could not complete the withdrawal. Your balance is unchanged." : null}
              {!TERMINAL_STATUSES.includes(phase.status) ? `Still ${phase.status}. Check your Solana wallet in a few minutes.` : null}
              {phase.solTx ? <> Solana transaction <TxLink chain="solana" network="mainnet" hash={phase.solTx} /></> : null}
            </p>
            {phase.status === "SUCCESS" && phase.solTx ? (
              <CopyEvidence
                run={{
                  kind: "outbound", tx: phase.solTx, chain: "solana", oneclick_deposit: phase.deposit,
                  expect: "Intents USDC withdrawn to a Solana address through 1Click",
                  observed: `${formatUsdc(phase.amount)} USDC withdrawal reached SUCCESS`,
                }}
              />
            ) : null}
            <button type="button" onClick={() => { setPhase({ k: "idle" }); setAmount(""); }}>Withdraw again</button>
          </div>
        ) : null}
        {ataHint ? <p className={form.band}>1Click reported a problem with the USDC account of this address. Check that you pasted a wallet address, not a token account, and try the preview again.</p> : null}
        {error ? <ErrorBox title="That did not work" fallback={error.fallback}><p>{error.message}</p></ErrorBox> : null}
      </section>
    </fieldset>
  );
}
