import Link from "next/link";
import { NEAR_AI_API, NEAR_AI_MODEL, type Report } from "@arrow/sdk/verify";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { evidence, releaseSha256, teamAccounts } from "../../generated/data.ts";
import { parseNetwork } from "../../lib/config.ts";
import { withNetwork } from "../../lib/links.ts";
import { ttlCache } from "../../lib/server/listingsCache.ts";
import { loadReport } from "../../lib/server/verifyReport.ts";
import { reportJson, summaryView } from "../../lib/verifyView.ts";
import { NearAiRow } from "./NearAiRow.tsx";
import { VerifyRows } from "./VerifyView.tsx";
import styles from "./verify.module.css";

// The engine reads the chain, the archival RPC and OutLayer for every recorded run: about 90 s for the testnet evidence today.
export const maxDuration = 300;

// One engine run is dozens of public-RPC calls; a reloaded page should not repeat them within five minutes.
// Concurrent visitors share one run, and a failed run is not retried for a minute (WEB-3): 50 parallel requests used to start 50 runs.
const reports = ttlCache<Awaited<ReturnType<typeof loadReport>>>(300_000, Date.now, 4, { failTtlMs: 60_000, maxWaiters: 12 });

const NEAR_AI_URL = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(NEAR_AI_MODEL)}&provider=near&signing_algo=ecdsa`;

export default async function Verify({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);

  let report: Report | null = null;
  let failure: string | null = null;
  let evalIds: number[] = [];
  let runCount = 0;
  try {
    const raw = evidence[net];
    const out = await reports(net, () => loadReport({ network: net, evidence: raw, releaseSha256, teamAccounts }));
    report = out.report;
    runCount = out.evidence?.runs.length ?? 0;
    evalIds = [...new Set((out.evidence?.runs ?? []).filter((r) => r.kind === "eval" && r.tx && r.eval_id !== null).map((r) => Number(r.eval_id)))];
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }

  const summary = report ? summaryView(report) : null;
  return (
    <div data-ready="true">
      <h1>Verify</h1>
      <p className={styles.lead}>
        These are the rows <span className="mono">npm run verify -- --network {net}</span> prints, computed by the same code from the recorded
        runs and the chain. A row is PROVEN only when an independent check passed. NOT PROVEN is never counted as a pass.
      </p>
      <ul className={styles.switch} aria-label="Network">
        {(["testnet", "mainnet"] as const).map((n) => (
          <li key={n}>{n === net ? <span className={styles.current}>{n}</span> : <Link href={withNetwork("/verify", n)}>{n}</Link>}</li>
        ))}
      </ul>

      {failure ? (
        <ErrorBox title={`Could not compute the rows for ${net}`} fallback={`Run it yourself: npm run verify -- --network ${net}`}>
          <p className="mono">{failure}</p>
        </ErrorBox>
      ) : !report || !summary ? (
        <EmptyState title="No runs recorded yet">
          <p>There is no evidence file for {net}. Run <span className="mono">npm run verify -- --network {net}</span> once runs are recorded.</p>
        </EmptyState>
      ) : (
        <>
          <div className={styles.summary} role="status">
            <span className={styles.line}>{summary.line}</span>
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
          {evalIds.length > 0 ? (
            <section className={styles.group} aria-labelledby="g-evals">
              <h2 id="g-evals">Check one eval</h2>
              <p className={styles.note}>Opens the OutLayer attestation of that eval and verifies its Intel TDX quote in your browser.</p>
              <ul className={styles.evals}>
                {evalIds.map((id) => (
                  <li key={id}><Link href={withNetwork(`/verify/${id}`, net)}>eval #{id}</Link></li>
                ))}
              </ul>
            </section>
          ) : null}
          <script id="verify-rows" type="application/json" dangerouslySetInnerHTML={{ __html: reportJson(report) }} />
        </>
      )}
    </div>
  );
}
