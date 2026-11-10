"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Countdown } from "../../components/Countdown.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { HashTriple } from "../../components/HashTriple.tsx";
import { StepList, type Step, type StepState } from "../../components/StepList.tsx";
import { TxLink } from "../../components/TxLink.tsx";
import form from "../../components/form.module.css";
import { stateLine } from "../../lib/format.ts";
import { realDeps, runTry, TRY_STEPS, TryError, type StepInfo, type TryConfig, type TryCriteria, type TryResult, type TryStep } from "../../lib/try/tryFlow.ts";
import styles from "./try.module.css";

const LABELS: Record<TryStep, string> = {
  account: "Create a throwaway testnet account",
  mint: "Mint test USDC",
  list: "List a synthetic file (encrypted here)",
  eval: "Pay the inspection fee",
  result: "Read the verdict inside the enclave",
  buy: "Buy",
  decrypt: "Download, check the hashes and decrypt",
};

type Tx = { step: TryStep; hash: string };

export function TryFlow({ scene, config, evidence, criteria }: { scene: TryCriteria; config: TryConfig; evidence: unknown; criteria: Record<string, unknown> }) {
  const deps = useMemo(() => realDeps({ evidence, criteria }), [evidence, criteria]);
  const [states, setStates] = useState<Record<TryStep, StepInfo["state"] | "todo">>(() => Object.fromEntries(TRY_STEPS.map((s) => [s, "todo"])) as never);
  const [details, setDetails] = useState<Partial<Record<TryStep, string>>>({});
  const [txs, setTxs] = useState<Tx[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<TryError | Error | null>(null);
  const [saveUrl, setSaveUrl] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setStates(Object.fromEntries(TRY_STEPS.map((s) => [s, "todo"])) as never);
    setDetails({});
    setTxs([]);
    setResult(null);
    setError(null);
    setSaveUrl(null);
    setRunning(true);
    setStartedAt(Date.now());
    try {
      const r = await runTry({
        criteria: scene, config, deps, signal: ac.signal,
        onStep: (step, info) => {
          setStates((prev) => ({ ...prev, [step]: info.state }));
          if (info.detail) setDetails((prev) => ({ ...prev, [step]: info.detail }));
          if (info.txHash) setTxs((prev) => (prev.some((t) => t.hash === info.txHash) ? prev : [...prev, { step, hash: info.txHash! }]));
        },
      });
      setResult(r);
      if (r.file) setSaveUrl(URL.createObjectURL(new Blob([r.file.bytes as BlobPart], { type: "application/octet-stream" })));
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (abort.current === ac) setRunning(false);
    }
  }

  const steps: Step[] = TRY_STEPS.map((s) => ({
    label: LABELS[s],
    state: (states[s] === "skipped" ? "todo" : states[s]) as StepState,
    detail: states[s] === "skipped" ? `skipped: ${details[s] ?? "not needed in this scene"}` : details[s],
  }));
  const totalSec = result ? Math.round(result.elapsedMs / 1000) : null;

  return (
    <section className={form.panel} aria-labelledby="try-title">
      <h2 id="try-title">Run it</h2>
      <p className={styles.help}>This testnet key lives only in this tab. Nothing here costs money, and the data is synthetic.</p>
      <div className={form.actions}>
        <button type="button" className={form.primary} disabled={running} onClick={() => void start()}>
          {running ? "Running…" : result || error ? "Run again" : "Start"}
        </button>
        {running && startedAt !== null ? <Countdown startedAt={startedAt} label="elapsed" /> : null}
      </div>

      {running || result || error ? <StepList steps={steps} /> : null}
      {txs.length > 0 ? (
        <ul className={styles.txs} aria-label="Transactions">
          {txs.map((t) => (
            <li key={t.hash}>{t.step}: <TxLink chain="near" network="testnet" hash={t.hash} /></li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <ErrorBox title="The run stopped" fallback={error instanceof TryError && error.code === "ACCOUNT_FAILED" ? undefined : "You can run it again, or use the terminal: npm run try:testnet"}>
          <p>{error.message}</p>
          {error instanceof TryError && error.code === "ACCOUNT_FAILED" ? <p><a href="https://near-faucet.io" target="_blank" rel="noopener noreferrer">near-faucet.io</a></p> : null}
        </ErrorBox>
      ) : null}

      {result ? (
        <div aria-live="polite">
          <p className={styles.verdict}>{stateLine(result.state, "scored")}</p>
          <p className={form.hint}>
            Account <span className="mono">{result.accountId}</span> · listing #{result.listingId}{result.usedDemoListing ? " (pre-listed demo listing)" : ""} · eval #{result.evalId}
            {result.purchaseId !== undefined ? ` · purchase #${result.purchaseId}` : ""}{totalSec !== null ? ` · ${totalSec} s in total` : ""}
          </p>
          {result.hashInput ? (
            <HashTriple onChain={result.hashInput.onChain} enclave={result.hashInput.evalH} release={result.hashInput.releaseH} downloaded={result.hashInput.downloaded} />
          ) : (
            <p className={form.hint}>This scene shows the verdict only; nothing was bought.</p>
          )}
          {saveUrl && result.file ? <p><a href={saveUrl} download={result.file.name}>Save {result.file.name}</a></p> : null}
        </div>
      ) : null}
    </section>
  );
}
