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
import { loadReport, parseEvidence, rememberSummary } from "../../lib/server/verifyReport.ts";
import { evalIdsOf, PLAIN, reportJson, summaryView } from "../../lib/verifyView.ts";
import { RECORDED_EVAL } from "../../lib/links.ts";
import { PageHead } from "../../components/Section.tsx";
import { FlagGrid, flagCounts } from "../../components/FlagGrid.tsx";
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

/** The recorded inspections of this network's evidence file, with the verdict the recording observed. No chain call: it renders at once. */
function recordedEvals(net: "testnet" | "mainnet"): { id: number; verdict: string | null }[] {
  let ev: ReturnType<typeof parseEvidence> = null;
  try {
    ev = parseEvidence(evidence[net]);
  } catch {
    return [];
  }
  return evalIdsOf(ev).map((id) => ({
    id,
    verdict: observedVerdict(ev?.runs.filter((r) => r.kind === "eval" && Number(r.eval_id) === id && r.contract === ev?.contract).at(-1)?.observed),
  }));
}

/**
 * The last report in which every row could be checked, per network, with when it ran. When the RPC is too busy for a fresh run, the
 * page shows this one, dated, next to the fresh partial result instead of only the partial one. In memory: a cold server has none.
 */
const lastFull = new Map<string, { report: Report; at: Date }>();

/**
 * The heading, the explanation and the network switch render at once; the rows stream in when the engine is done (about 10 to
 * 90 seconds on a cold server), so nobody looks at an empty page while the chain is read.
 */
export default async function Verify({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  const flags = flagCounts();
  return (
    <div data-ready="true">
      <PageHead eyebrow="Verify" title="Checked from the chain.">
        Each row is a promise; NOT PROVEN never counts as passed.
      </PageHead>
      <details className={styles.how}>
        <summary>How to read this</summary>
        <p>
          Each row below is one promise, checked against public blockchain data by the same code you can run yourself. A row is PROVEN only
          when an independent check passed; NOT PROVEN is never counted as a pass. Each row opens with a plain sentence, with the engine&apos;s
          own wording under it. Run it yourself: <span className={`mono ${styles.nowrap}`}>npm run verify -- --network {net}</span>
        </p>
      </details>
      <div className={styles.flags}>
        <FlagGrid link />
        <p className={styles.note}>
          Trust table: {flags.risky} RISKY · {flags.notProven} NOT PROVEN · {flags.todo} TODO of {flags.total} rows. <Link href="/trust#trust-table">Open it →</Link>
        </p>
      </div>
      {(() => {
        const evals = recordedEvals(net);
        return evals.length > 0 ? (
          <section className={styles.oneAt} aria-labelledby="g-evals">
            <h2 id="g-evals" className={styles.oneTitle}>Check one inspection</h2>
            <ul className={styles.evals}>
              {evals.map(({ id, verdict }) => (
                <li key={id}>
                  <Link href={withNetwork(`/verify/${id}`, net)}>#{id}{verdict ? <span className={styles.evalVerdict}>{"\u00a0·\u00a0"}{verdict}</span> : null}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })()}
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
        <span className={styles.spinner} aria-hidden="true" /> Checking every promise against {net} now: up to three minutes on a cold server.
        {recordedEvals(net).length > 0 ? " One inspection above opens in seconds." : ""}
      </p>
      <p className={styles.note}>The required checks:</p>
      <ul className={styles.pendingList}>
        {required.map((id) => (
          <li key={id}><span className="mono">{id}</span> {PLAIN[id]}</li>
        ))}
      </ul>
      {net === "mainnet" ? (
        <p className={styles.note}>
          While you wait: <Link href={withNetwork(`/verify/${RECORDED_EVAL}`, "mainnet")}>the recorded run, inspection #{RECORDED_EVAL} →</Link>
        </p>
      ) : null}
    </div>
  );
}

async function VerifyLive({ net }: { net: "testnet" | "mainnet" }) {
  let report: Report | null = null;
  let failure: string | null = null;
  let runCount = 0;
  try {
    const raw = evidence[net];
    const out = await reports(net, () => loadReport({ network: net, evidence: raw, releaseSha256, teamAccounts }));
    report = out.report;
    runCount = out.evidence?.runs.length ?? 0;
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }

  let summary = report ? summaryView(report) : null;
  // A run in which no row failed to reach the RPC is kept; a busy run shows the last such run instead, dated, and says so.
  let fresh: { line: string; failure: string | null } | null = null;
  let asOf: Date | null = null;
  if (report && summary && !summary.busy) lastFull.set(net, { report, at: new Date() });
  else if (report && summary?.busy) {
    const last = lastFull.get(net);
    if (last) {
      fresh = { line: summary.line, failure: summary.failure };
      report = last.report;
      summary = summaryView(last.report);
      asOf = last.at;
    }
  }
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
        {asOf ? (
          <p className={styles.asOf}>
            Last full check at {asOf.toISOString().slice(11, 16)} UTC. The check just now could not reach the RPC ({fresh?.line}); reload in a minute to run it again.
          </p>
        ) : null}
        <p className={`${styles.verdictLine} ${summary.passed ? styles.ok : ""}`}>
          {summary.passed
            ? `All ${report.required.total} required checks passed.`
            : `${report.required.proven} of ${report.required.total} required checks passed right now.`}
        </p>
        <span className={styles.summaryPlain}>
          {summary.passed ? "Every required promise holds on public blockchain data." : "Not every required row could be PROVEN right now. Each row below says why."}
          {net === "testnet" ? " R4, R6 and R7 are mainnet-only. The market is live on mainnet; it is not locked yet, so the team can still change it." : null}
        </span>
        <span className={styles.cli}>{summary.line}</span>
        {summary.failure ? <span className={summary.busy ? styles.busy : styles.fail}>{summary.failure}</span> : null}
        {report.preLock ? <Badge kind="pre-lock" /> : null}
        <Badge kind={net} />
      </div>
      {runCount === 0 ? (
        <EmptyState title="No runs recorded yet">
          <p>The evidence file for {net} has no runs, so the rows below cannot be PROVEN yet.</p>
        </EmptyState>
      ) : null}
      <VerifyRows rows={report.rows} after={{ N1: <NearAiRow urlPrefix={NEAR_AI_URL} /> }} fold />
      <TryNext />
      <script id="verify-rows" type="application/json" dangerouslySetInnerHTML={{ __html: reportJson(report) }} />
    </>
  );
}

