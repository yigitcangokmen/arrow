import Link from "next/link";
import { Suspense } from "react";
import { NEAR_AI_API, NEAR_AI_MODEL, type Report } from "@arrow/sdk/verify";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { evidence, releaseSha256, teamAccounts } from "../../generated/data.ts";
import { parseNetwork } from "../../lib/config.ts";
import { withNetwork } from "../../lib/links.ts";
import { ttlCache } from "../../lib/server/listingsCache.ts";
import { loadReport, rememberSummary } from "../../lib/server/verifyReport.ts";
import { evalIdsOf, PLAIN, reportJson, summaryView } from "../../lib/verifyView.ts";
import { RECORDED_EVAL } from "../../lib/links.ts";
import { PageHead } from "../../components/Section.tsx";
import { NearAiRow } from "./NearAiRow.tsx";
import { TryNext, VerifyRows } from "./VerifyView.tsx";
import styles from "./verify.module.css";

// The engine reads the chain, the archival RPC and OutLayer for every recorded run: about 90 s for the testnet evidence today.
export const maxDuration = 300;

// One engine run is dozens of public-RPC calls; a reloaded page should not repeat them within five minutes.
// Concurrent visitors share one run, and a failed run is not retried for a minute (WEB-3): 50 parallel requests used to start 50 runs.
const reports = ttlCache<Awaited<ReturnType<typeof loadReport>>>(300_000, Date.now, 4, { failTtlMs: 60_000, maxWaiters: 12 });

const NEAR_AI_URL = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(NEAR_AI_MODEL)}&provider=near&signing_algo=ecdsa`;

export const metadata = { title: "Verify" };

/** What every recorded run's evidence says it observed, first word only ("BUY", "PASS"), for the eval list. */
function observedVerdict(observed: unknown): string | null {
  const m = typeof observed === "string" ? /^(BUY|PASS)\b/.exec(observed) : null;
  return m ? m[1]! : null;
}

/**
 * The heading, the explanation and the network switch render at once; the rows stream in when the engine is done (about 10 to
 * 90 seconds on a cold server), so nobody looks at an empty page while the chain is read.
 */
export default async function Verify({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  return (
    <div data-ready="true">
      <PageHead eyebrow="Verify" title="Check the claims against the chain.">
        Each row below is one promise, checked against public blockchain data by the same code you can run yourself. A row is PROVEN only
        when an independent check passed; NOT PROVEN is never counted as a pass. Each row opens with a plain sentence, with the engine&apos;s
        own wording under it. Run it yourself: <span className={`mono ${styles.nowrap}`}>npm run verify -- --network {net}</span>
      </PageHead>
      <ul className={styles.switch} aria-label="Network">
        {(["testnet", "mainnet"] as const).map((n) => (
          <li key={n}>{n === net ? <span className={styles.current}>{n}</span> : <Link href={withNetwork("/verify", n)}>{n}</Link>}</li>
        ))}
      </ul>
      <Suspense key={net} fallback={<Pending net={net} />}>
        <VerifyLive net={net} />
      </Suspense>
    </div>
  );
}

/** Shown while the engine reads the chain: what is being checked, in plain words, and how long it takes. */
function Pending({ net }: { net: "testnet" | "mainnet" }) {
  const required = ["R1", "R2", "R3", "R5", "R8"];
  return (
    <div className={styles.pending} aria-busy="true">
      <p className={styles.pendingLine} role="status">
        <span className={styles.spinner} aria-hidden="true" /> Checking every claim against {net} now. This reads dozens of transactions and
        can take up to three minutes when the server is cold; later visits are quick.
      </p>
      <p className={styles.note}>Among the things it checks:</p>
      <ul className={styles.pendingList}>
        {required.map((id) => (
          <li key={id}><span className="mono">{id}</span> {PLAIN[id]}</li>
        ))}
      </ul>
      {net === "testnet" ? (
        <p className={styles.note}>
          While you wait: <Link href={`/verify/${RECORDED_EVAL}`}>one recorded inspection, checked on its own →</Link>
        </p>
      ) : null}
    </div>
  );
}

async function VerifyLive({ net }: { net: "testnet" | "mainnet" }) {
  let report: Report | null = null;
  let failure: string | null = null;
  let evals: { id: number; verdict: string | null }[] = [];
  let runCount = 0;
  try {
    const raw = evidence[net];
    const out = await reports(net, () => loadReport({ network: net, evidence: raw, releaseSha256, teamAccounts }));
    report = out.report;
    runCount = out.evidence?.runs.length ?? 0;
    evals = evalIdsOf(out.evidence).map((id) => ({
      id,
      verdict: observedVerdict(out.evidence?.runs.filter((r) => r.kind === "eval" && Number(r.eval_id) === id && r.contract === out.evidence?.contract).at(-1)?.observed),
    }));
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }

  const summary = report ? summaryView(report) : null;
  // Only a passing line is quoted on the home page; a partial run (an RPC hiccup, say) is shown here and not repeated there.
  if (summary?.passed) rememberSummary(net, summary.line);
  if (failure) {
    return (
      <ErrorBox title={`Could not compute the rows for ${net}`} fallback={`Run it yourself: npm run verify -- --network ${net}`}>
        <p className="mono">{failure}</p>
      </ErrorBox>
    );
  }
  if (!report || !summary) {
    return (
      <EmptyState title="No runs recorded yet">
        <p>There is no evidence file for {net}. Run <span className="mono">npm run verify -- --network {net}</span> once runs are recorded.</p>
      </EmptyState>
    );
  }
  return (
    <>
      <div className={styles.summary} role="status">
        <p className={`${styles.verdictLine} ${summary.passed ? styles.ok : ""}`}>
          {summary.passed
            ? `All ${report.required.total} required checks passed.`
            : `${report.required.proven} of ${report.required.total} required checks passed right now.`}
        </p>
        <span className={styles.summaryPlain}>
          {summary.passed
            ? "Every required promise was checked against public blockchain data and holds. Below them are cross-checks, what this page cannot prove, and the known risks."
            : "Not every required row could be PROVEN right now. Each row below says why."}
          {net === "testnet" ? " R4 (cross-chain swaps), R6 (the lock) and R7 (listings before and after the lock) are mainnet-only rows; mainnet is not deployed yet." : null}
        </span>
        <span className={styles.cli}>{summary.line}</span>
        {summary.failure ? <span className={styles.fail}>{summary.failure}</span> : null}
        {report.preLock ? <Badge kind="pre-lock" /> : null}
        <Badge kind={net} />
      </div>
      {runCount === 0 ? (
        <EmptyState title="No runs recorded yet">
          <p>The evidence file for {net} has no runs, so the rows below cannot be PROVEN yet.</p>
        </EmptyState>
      ) : null}
      <VerifyRows rows={report.rows} after={{ N1: <NearAiRow urlPrefix={NEAR_AI_URL} /> }} />
      {evals.length > 0 ? (
        <section className={styles.group} aria-labelledby="g-evals">
          <p className={styles.eyebrow}>One at a time</p>
          <h2 id="g-evals" className={styles.groupTitle}>Check one inspection.</h2>
          <p className={styles.note}>Each opens that inspection&apos;s OutLayer attestation and verifies its Intel TDX quote in your browser. The verdict is what the recording script observed.</p>
          <ul className={styles.evals}>
            {evals.map(({ id, verdict }) => (
              <li key={id}>
                <Link href={withNetwork(`/verify/${id}`, net)}>inspection #{id}{verdict ? <span className={styles.evalVerdict}>{"\u00a0·\u00a0"}{verdict}</span> : null}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <TryNext />
      <script id="verify-rows" type="application/json" dangerouslySetInnerHTML={{ __html: reportJson(report) }} />
    </>
  );
}

