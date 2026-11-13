"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Announcer } from "../../components/Announcer.tsx";
import { Countdown } from "../../components/Countdown.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { HashTriple } from "../../components/HashTriple.tsx";
import { MeaningTiles } from "../../components/MeaningTiles.tsx";
import { StepList, type Step, type StepState } from "../../components/StepList.tsx";
import { TxLink } from "../../components/TxLink.tsx";
import form from "../../components/form.module.css";
import { stateLine } from "../../lib/format.ts";
import { RECORDED_RUN_PATH } from "../../lib/links.ts";
import { realDeps, runTry, TRY_STEPS, TryError, type RefundedRun, type StepInfo, type TryConfig, type TryCriteria, type TryResult, type TryStep } from "../../lib/try/tryFlow.ts";
import styles from "./try.module.css";

const LABELS: Record<TryStep, string> = {
  account: "Create a throwaway testnet account",
  mint: "Get free test dollars (test USDC)",
  list: "List a synthetic file (encrypted here)",
  eval: "Pay the inspection fee",
  result: "Get the AI's verdict",
  buy: "Buy the file",
  decrypt: "Download the file and check it is the same one",
};

type Tx = { step: TryStep; hash: string };

const NEXT: { scene: TryCriteria | null; href: string; title: string; text: string }[] = [
  { scene: "demo", href: "/try?criteria=demo", title: "Run the PASS scene", text: "The unlock schedule does not fit the buyer's need: watch it say PASS." },
  { scene: "demo-buy", href: "/try?criteria=demo-buy", title: "Run the BUY scene", text: "Wallet labels that fit: it says BUY, buys and checks the file." },
  { scene: "print-row-1", href: "/try?criteria=print-row-1", title: "Ask it to print row 1", text: "A buyer tries to make the AI read out data. The answer is still one of the 51 verdicts." },
  { scene: null, href: "/verify", title: "Check the recorded proof", text: "Your fresh run is not in the recorded evidence; its transactions are above." },
  { scene: null, href: "/#trust", title: "Who sees what", text: "What each part can see, and the limits, in plain words." },
];

/** The two ways on after a run that did not finish: run it again here, or watch a recorded run that finished. */
function Recover({ onRetry }: { onRetry(): void }) {
  return (
    <div className={styles.recover}>
      <button type="button" className={form.primary} onClick={onRetry}>Run it again</button>
      <Link href={RECORDED_RUN_PATH}>Watch a recorded run that finished →</Link>
    </div>
  );
}

/** One refunded payment: what it was, why it refunded (read from the chain), and its transaction. */
function RefundLine({ r }: { r: RefundedRun }) {
  return (
    <li>
      {r.kind === "eval" ? `Inspection #${r.id}` : `Purchase #${r.id}`} was refunded{r.reason ? ` (${r.reason})` : ""}: {r.cause}.{" "}
      <TxLink chain="near" network="testnet" hash={r.txHash} />
    </li>
  );
}

/** The heading of a finished run, from what actually happened, not from the scene's expectation. */
function headline(r: TryResult, scene: TryCriteria): string {
  if (r.purchaseId !== undefined && r.hashes?.match) return "It said BUY. You bought it. The file matches.";
  if (scene === "print-row-1") return `No row came back: the answer was ${stateLine(r.state, "scored")}, one of the 51 fixed answers.`;
  if (r.state.verdict === "PASS") return "It said PASS. Nothing was bought.";
  return `It said ${r.state.verdict}.`;
}

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

  // A refund or a pause before paying is the system working as designed: that step shows as refunded, not as failed.
  const calm = error instanceof TryError && (error.code === "REFUNDED" || error.code === "QUEUE_BUSY") ? error.code : null;
  const steps: Step[] = TRY_STEPS.map((s) => ({
    label: LABELS[s],
    state: (states[s] === "skipped" ? "todo" : calm && states[s] === "failed" ? (calm === "REFUNDED" ? "refunded" : "todo") : states[s]) as StepState,
    detail: states[s] === "skipped" ? `skipped: ${details[s] ?? "not needed in this scene"}` : details[s],
  }));
  const totalSec = result ? Math.round(result.elapsedMs / 1000) : null;
  const finished = TRY_STEPS.filter((s) => states[s] === "done" || states[s] === "skipped").length;
  const stepNo = Math.min(TRY_STEPS.length, finished + (running ? 1 : 0));
  const doing = TRY_STEPS.find((s) => states[s] === "doing");
  // Step changes, the result and a failure are read out through the one always-mounted live region.
  const announce = result ? headline(result, scene) : calm ? "The run ended without a verdict, as designed. What happened and the next steps are below." : error ? "The run stopped. The reason and the next steps are below." : running && doing ? `Step ${stepNo} of ${TRY_STEPS.length}: ${LABELS[doing]}` : "";

  return (
    <>
      <section className={styles.run} aria-labelledby="try-title">
        <h2 id="try-title" className="sr-only">Run it</h2>
        <div className={styles.runbar}>
          <div className={styles.runButtons}>
            <button type="button" className={`${form.primary} ${styles.go}`} disabled={running} onClick={() => void start()}>
              {running ? "Running…" : result || error ? "Run it again" : "Run the demo"}
            </button>
            {running ? <button type="button" onClick={() => abort.current?.abort()}>Cancel</button> : null}
          </div>
          <p className={styles.runInfo}>
            <span className="mono">{stepNo === 0 ? `${TRY_STEPS.length} steps` : `Step ${stepNo} of ${TRY_STEPS.length}`}</span>
            {running && startedAt !== null ? <> · <Countdown startedAt={startedAt} label="elapsed" /></> : totalSec !== null ? <> · <span className="mono">{totalSec} s in total</span></> : null}
            {" "}· about 3 minutes · nothing here costs money
          </p>
          <Link className={styles.recorded} href={RECORDED_RUN_PATH}>Or watch a recorded run</Link>
        </div>
        <p className={styles.runNote}>
          Each paid step runs Arrow&apos;s program in sealed hardware through OutLayer&apos;s shared testnet queue. When that queue is slow, the
          program does not answer late; the contract refunds the payment on its own. This page checks the queue before each payment, waits
          while it is slow, and pays a refunded step once more.
        </p>

        <Announcer text={announce} />
        <StepList steps={steps} />
        {running && doing && details[doing]?.startsWith("OutLayer's shared testnet queue is slow") ? (
          <p className={styles.waitNote}>
            This page pays as soon as the queue is quick again; Cancel stops it. Meanwhile:{" "}
            <a href={RECORDED_RUN_PATH} target="_blank" rel="noopener noreferrer">watch the recorded run<span className="sr-only"> (opens in a new tab)</span></a>.
          </p>
        ) : null}
        {txs.length > 0 ? (
          <ul id="try-txs" className={styles.txs} aria-label="Transactions">
            {txs.map((t) => (
              <li key={t.hash}>{t.step}: <TxLink chain="near" network="testnet" hash={t.hash} /></li>
            ))}
          </ul>
        ) : null}

        {error instanceof TryError && error.code === "REFUNDED" ? (
          <div className={styles.outcome} role="status">
            <h3>Refunded automatically. The refund rule did its job.</h3>
            <p>
              {error.step === "buy"
                ? "The test money for the purchase went back to the throwaway account in full."
                : "The test money went back to the throwaway account, less Arrow's 10% share of the fee."}{" "}
              Arrow&apos;s program answers on time or not at all: when its run in sealed hardware fails or would answer late, the contract
              sends the money back on its own, and no data comes out.
            </p>
            <ul className={styles.refunds}>
              {error.refunds.map((r) => <RefundLine key={r.txHash} r={r} />)}
            </ul>
            <Recover onRetry={() => void start()} />
          </div>
        ) : error instanceof TryError && error.code === "QUEUE_BUSY" ? (
          <div className={styles.outcome} role="status">
            <h3>Paused before paying: OutLayer&apos;s testnet queue is slow.</h3>
            <p>{error.message} A run paid now would almost certainly be refunded, so this page stopped first.</p>
            <Recover onRetry={() => void start()} />
          </div>
        ) : error ? (
          <ErrorBox title="The run stopped">
            <p>{error.message}</p>
            {error instanceof TryError && error.code === "ACCOUNT_FAILED" ? <p><a href="https://near-faucet.io" target="_blank" rel="noopener noreferrer">near-faucet.io</a></p> : null}
            <Recover onRetry={() => void start()} />
            <details>
              <summary>Run it from a terminal instead</summary>
              <p className="mono">npm run try:testnet</p>
            </details>
          </ErrorBox>
        ) : null}
      </section>

      {result ? (
        <section className={styles.result} aria-labelledby="try-result">
          <h2 id="try-result" className={styles.headline}>{headline(result, scene)}</h2>
          <p className={styles.verdict}>{stateLine(result.state, "scored")}</p>
          <p className={form.hint}>
            Account <span className="mono">{result.accountId}</span> · listing #{result.listingId}{result.usedDemoListing ? " (pre-listed demo listing)" : ""} · eval #{result.evalId}
            {result.purchaseId !== undefined ? ` · purchase #${result.purchaseId}` : ""}{totalSec !== null ? ` · ${totalSec} s in total` : ""}
          </p>
          {result.refunds.length > 0 ? (
            <div className={styles.outcome}>
              <p>
                <b>{result.refunds.length === 1 ? "One payment was refunded first, then paid again." : "Some payments were refunded first, then paid again."}</b>{" "}
                A refund is the contract&apos;s answer to a run that fails or would answer late.
              </p>
              <ul className={styles.refunds}>
                {result.refunds.map((r) => <RefundLine key={r.txHash} r={r} />)}
              </ul>
            </div>
          ) : null}
          <MeaningTiles withAnswers />
          {result.hashInput ? (
            <div className={styles.hashes}>
              <p className={styles.match}>
                {result.hashes?.match ? "4 fingerprints match ✓ The file you saved is the file the enclave inspected and then released." : "The fingerprints did not all match."}
              </p>
              <details>
                <summary>Show the four sha256 values</summary>
                <HashTriple onChain={result.hashInput.onChain} enclave={result.hashInput.evalH} release={result.hashInput.releaseH} downloaded={result.hashInput.downloaded} />
              </details>
            </div>
          ) : (
            <p className={form.hint}>This scene shows the verdict only; nothing was bought.</p>
          )}
          <div className={form.actions}>
            {saveUrl && result.file ? <a className={styles.save} href={saveUrl} download={result.file.name}>Save {result.file.name}</a> : null}
            {txs.length > 0 ? <a href="#try-txs">Open the transactions</a> : null}
          </div>
          {saveUrl ? (
            <p className={form.hint}>Open this file in a text editor first. A spreadsheet runs formulas (cells starting with =, +, - or @).</p>
          ) : null}
        </section>
      ) : null}

      <div className={styles.while}>
        <div>
          <h3>{running ? "What is happening right now." : "What happens during a run."}</h3>
          <p>
            Your fee goes to the market, which starts Arrow&apos;s program in sealed hardware; the program asks an AI about a sample and writes
            back a short answer.
          </p>
          <details className={styles.more}>
            <summary>In detail</summary>
            <p>
            The payment reaches the market contract, which asks OutLayer to run Arrow&apos;s program inside an Intel TDX enclave. The program
            downloads the encrypted file, checks its fingerprint against the chain, decrypts it, samples 40 rows and sends them with the
            buyer&apos;s criteria to NEAR AI&apos;s model, which runs in its own sealed hardware. The verdict comes back and the contract writes
            it on chain, sealed to the buyer&apos;s key.
            </p>
          </details>
        </div>
        <div>
          <h3>Why the verdict is so small.</h3>
          <p>
            To keep what an answer can carry about the data small. The program can only write one of 51 fixed answers: BUY or PASS, fit 1–5, novelty 1–5,
            no free text. Measured as information (one bit is one yes/no answer), that is at most 5.67 bits per
            inspection, and at most 283.65 bits over a listing&apos;s 50 inspections. A failed run shows on chain as one of two more outcomes (an
            error output, or no output). Run time and instruction count are public and are not counted in that figure.{" "}
            <a href="/#trust">Who sees what</a>.
          </p>
        </div>
      </div>

      {result ? (
        <nav className={styles.next} aria-labelledby="try-next">
          <h2 id="try-next">Next.</h2>
          <ul>
            {NEXT.filter((n) => n.scene !== scene).map((n) => (
              <li key={n.href}>
                <Link href={n.href}><b>{n.title}</b><span>{n.text}</span></Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </>
  );
}
