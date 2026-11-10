"use client";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { base } from "viem/chains";
import { inboundQuoteRequest, quote, status, submitDeposit, TERMINAL_STATUSES, type OneClickStatus } from "@arrow/sdk/oneclick";
import { formatUsdc, REFUND_LINE } from "../lib/format.ts";
import { parseUsdc } from "@arrow/sdk/usdc";
import { BASE_USDC_ADDRESS, type Eoa, ensureBase } from "../lib/wallet.ts";
import { Countdown } from "./Countdown.tsx";
import { TxLink } from "./TxLink.tsx";
import styles from "./form.module.css";

type Phase =
  | { k: "idle" }
  | { k: "quoting" }
  | { k: "preview"; units: bigint; out: string; etaSec: number }
  | { k: "sending" }
  | { k: "waiting"; startedAt: number; status: OneClickStatus; txHash: string }
  | { k: "done"; status: OneClickStatus; txHash: string };

const POLL_MS = 5_000;
const POLL_LIMIT_MS = 15 * 60_000; // INCOMPLETE_DEPOSIT keeps being polled for a while (research 13 section 74)

/** Base USDC to the buyer's Intents balance through 1Click (DEC K-01). `defaultAmount` is in base units. */
export function TopUp({ eoa, defaultAmount, onSuccess }: { eoa: Eoa; defaultAmount: bigint; onSuccess?(): void }) {
  const [amount, setAmount] = useState(formatUsdc(defaultAmount));
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fail = (e: unknown, fallback: string) => {
    if (!alive.current) return;
    const msg = e instanceof Error ? e.message : "";
    setError(/rejected|denied/i.test(msg) ? "You rejected the request in your wallet." : msg ? `${fallback} (${msg.slice(0, 160)})` : fallback);
    setPhase({ k: "idle" });
  };

  async function preview() {
    setError(null);
    let units: bigint;
    try {
      units = parseUsdc(amount.trim());
      if (units <= 0n) throw new Error("zero");
    } catch {
      setError("Enter a USDC amount with up to 6 decimals, for example 0.50.");
      return;
    }
    setPhase({ k: "quoting" });
    try {
      const r = await quote(inboundQuoteRequest({ amount: units.toString(), evm: eoa.address, dry: true }));
      if (alive.current) setPhase({ k: "preview", units, out: r.quote.amountOutFormatted, etaSec: r.quote.timeEstimate });
    } catch (e) {
      fail(e, "1Click could not quote this amount.");
    }
  }

  async function pay(units: bigint) {
    setError(null);
    setPhase({ k: "sending" });
    try {
      const real = await quote(inboundQuoteRequest({ amount: units.toString(), evm: eoa.address, dry: false }));
      const deposit = real.quote.depositAddress;
      if (!deposit || !/^0x[0-9a-fA-F]{40}$/.test(deposit)) throw new Error("1Click returned no Base deposit address");
      await ensureBase(eoa);
      const txHash = await eoa.client.writeContract({
        account: eoa.address,
        chain: base,
        address: BASE_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [deposit as `0x${string}`, units],
      });
      await submitDeposit({ txHash, depositAddress: deposit }).catch(() => undefined); // 1Click also scans the chain itself
      const startedAt = Date.now();
      if (alive.current) setPhase({ k: "waiting", startedAt, status: "KNOWN_DEPOSIT_TX", txHash });
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const s = await status(deposit).catch(() => null);
        if (!s) continue;
        const terminal = TERMINAL_STATUSES.includes(s.status);
        if (terminal) {
          setPhase({ k: "done", status: s.status, txHash });
          if (s.status === "SUCCESS") onSuccess?.();
          return;
        }
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setPhase({ k: "done", status: s.status, txHash });
          return;
        }
        setPhase({ k: "waiting", startedAt, status: s.status, txHash });
      }
    } catch (e) {
      fail(e, "The top-up did not complete.");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="topup-title">
      <h3 id="topup-title">Add USDC from Base</h3>
      <p className={styles.hint}>
        1Click moves USDC from your Base wallet to your NEAR Intents balance. You sign one USDC transfer on Base. Funds that 1Click
        cannot deliver go back to your Base address.
      </p>
      {phase.k === "idle" || phase.k === "quoting" || phase.k === "preview" ? (
        <>
          <div className={styles.field}>
            <label htmlFor="topup-amount">Amount (USDC)</label>
            <input id="topup-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); if (phase.k === "preview") setPhase({ k: "idle" }); }} />
          </div>
          {phase.k === "preview" ? (
            <p>
              You send {formatUsdc(phase.units)} USDC on Base and receive about <strong>{phase.out} USDC</strong> in your Intents balance
              (about {phase.etaSec} s).
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" disabled={phase.k === "quoting"} onClick={preview}>{phase.k === "quoting" ? "Getting a quote…" : "Preview"}</button>
            {phase.k === "preview" ? (
              <button type="button" className={styles.primary} onClick={() => void pay(phase.units)}>Pay on Base</button>
            ) : null}
          </div>
        </>
      ) : null}
      {phase.k === "sending" ? <p role="status">Waiting for your wallet: confirm the USDC transfer on Base.</p> : null}
      {phase.k === "waiting" ? (
        <p role="status">
          1Click status <strong>{phase.status}</strong> · <Countdown startedAt={phase.startedAt} label="elapsed" /> · deposit{" "}
          <TxLink chain="base" network="mainnet" hash={phase.txHash} />
          <br />
          <span className={styles.hint}>You can leave this page. Your balance updates when the status is SUCCESS.</span>
        </p>
      ) : null}
      {phase.k === "done" ? (
        <p className={phase.status === "SUCCESS" ? styles.ok : styles.error} role="status">
          {phase.status === "SUCCESS" ? "Done: the USDC is in your Intents balance." : null}
          {phase.status === "REFUNDED" ? "1Click refunded the deposit to your Base address." : null}
          {phase.status === "FAILED" ? "1Click could not complete the swap." : null}
          {phase.status === "INCOMPLETE_DEPOSIT" ? "1Click received less than the quoted amount. It may still refund the difference to your Base address." : null}
          {!TERMINAL_STATUSES.includes(phase.status) && phase.status !== "INCOMPLETE_DEPOSIT" ? `Still ${phase.status}. Check again in a few minutes.` : null}{" "}
          Deposit <TxLink chain="base" network="mainnet" hash={phase.txHash} />
        </p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.hint}>If an inspection or purchase fails: {REFUND_LINE} Sending it back to Base is a separate 1Click withdrawal.</p>
    </section>
  );
}
