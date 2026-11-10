import Link from "next/link";
import { NEAR_AI_API, NEAR_AI_MODEL, type Report } from "@arrow/sdk/verify";
import { NETWORKS } from "@arrow/sdk/config";
import { Badge } from "../../../components/Badge.tsx";
import { EmptyState } from "../../../components/EmptyState.tsx";
import { ErrorBox } from "../../../components/ErrorBox.tsx";
import { ProofPill } from "../../../components/ProofPill.tsx";
import { TxLink } from "../../../components/TxLink.tsx";
import { evidence, releaseSha256, teamAccounts } from "../../../generated/data.ts";
import { parseNetwork } from "../../../lib/config.ts";
import { withNetwork } from "../../../lib/links.ts";
import { ttlCache } from "../../../lib/server/listingsCache.ts";
import { isEvalId, loadEval, type EvalPageData } from "../../../lib/server/verifyReport.ts";
import { reportJson, summaryView } from "../../../lib/verifyView.ts";
import { DcapRow } from "../DcapRow.tsx";
import { NearAiRow } from "../NearAiRow.tsx";
import { VerifyRows } from "../VerifyView.tsx";
import styles from "../verify.module.css";

// The engine reads the chain, the archival RPC and OutLayer for every recorded run: about 90 s for the testnet evidence today.
export const maxDuration = 300;

const evals = ttlCache<EvalPageData>(300_000);

const NEAR_AI_URL = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(NEAR_AI_MODEL)}&provider=near&signing_algo=ecdsa`;

export default async function VerifyEval({ params, searchParams }: { params: Promise<{ evalId: string }>; searchParams: Promise<{ network?: string }> }) {
  const { evalId: raw } = await params;
  const net = parseNetwork((await searchParams).network);
  const back = <p><Link href={withNetwork("/verify", net)}>All rows for {net}</Link></p>;

  if (!isEvalId(raw)) {
    return (
      <div data-ready="true">
        <h1>Verify eval</h1>
        <EmptyState title="This is not an eval id">An eval id is a whole number, for example <span className="mono">/verify/1</span>.</EmptyState>
        {back}
      </div>
    );
  }
  const id = Number(raw);

  let data: EvalPageData | null = null;
  let failure: string | null = null;
  try {
    data = await evals(`${net}:${id}`, () => loadEval({ network: net, evidence: evidence[net], releaseSha256, teamAccounts }, id));
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }

  if (failure || !data) {
    return (
      <div data-ready="true">
        <h1>Verify eval #{id}</h1>
        <ErrorBox title={`Could not read eval #${id} on ${net}`} fallback={`Run it yourself: npm run verify -- --network ${net}`}>
          <p className="mono">{failure}</p>
        </ErrorBox>
        {back}
      </div>
    );
  }

  const known = data.run !== null || data.onChain !== null;
  const att = data.attestation?.record;
  const report: Report | null = data.report;
  const summary = report ? summaryView(report) : null;
  return (
    <div data-ready="true">
      <h1>Verify eval #{id}</h1>
      <p className={styles.lead}>
        One eval, checked from the chain and OutLayer&apos;s attestation record. The Intel TDX quote is verified in this browser.
      </p>
      {back}
      <div className={styles.summary}>
        <Badge kind={net} />
        <span className="mono">{NETWORKS[net].contract}</span>
        {data.run?.tx ? <TxLink chain="near" network={net} hash={data.run.tx} /> : null}
      </div>

      {!known ? (
        <EmptyState title={`No eval #${id} on ${net}`}>
          {data.viewError ? <p className="mono">The contract view failed: {data.viewError}</p> : <p>The contract has no eval with this id and the evidence file does not mention it.</p>}
        </EmptyState>
      ) : null}

      {data.onChain ? (
        <section className={styles.group} aria-labelledby="g-chain">
          <h2 id="g-chain">On chain</h2>
          <dl className={styles.facts}>
            <dt>status</dt><dd>{data.onChain.status}</dd>
            <dt>listing</dt><dd>{String(data.onChain.listing_id)}</dd>
            <dt>h (blob sha256)</dt><dd className="mono">{data.onChain.h ?? "none"}</dd>
            {data.onChain.refund_reason ? (<><dt>refund reason</dt><dd>{data.onChain.refund_reason}</dd></>) : null}
          </dl>
        </section>
      ) : null}

      {known && !data.run ? (
        <div className={styles.box}>
          <ProofPill label="NOT PROVEN" /> The eval tx is not in the evidence file for {net}, so the attestation and its binding to this eval cannot be
          checked here. Add the run with <span className="mono">scripts/src/evidence-add.ts</span> and run{" "}
          <span className="mono">npm run verify -- --network {net}</span>.
        </div>
      ) : null}

      {report && summary ? (
        <>
          <h2>Rows for this eval</h2>
          <p className={styles.note}>Only the wasm hash and attestation rows run here, on this eval alone; the line counts those REQUIRED rows. The listing-level rows are on the main Verify page.</p>
          <div className={styles.summary} role="status">
            <span className={styles.line}>{summary.line}</span>
            {summary.failure ? <span className={styles.fail}>{summary.failure}</span> : null}
          </div>
          <VerifyRows rows={report.rows} after={{ N1: <NearAiRow urlPrefix={NEAR_AI_URL} /> }} />
          <script id="verify-rows" type="application/json" dangerouslySetInnerHTML={{ __html: reportJson(report) }} />
        </>
      ) : null}

      {data.run ? (
        <section className={styles.group} aria-labelledby="g-att">
          <h2 id="g-att">OutLayer attestation</h2>
          {att && data.attestation ? (
            <>
              <dl className={styles.facts}>
                <dt>request id</dt><dd className="mono">{data.attestation.requestId}</dd>
                <dt>transaction_hash</dt><dd className="mono">{att.transaction_hash}</dd>
                <dt>wasm_hash</dt><dd className="mono">{att.wasm_hash}</dd>
                <dt>input_hash</dt><dd className="mono">{att.input_hash}</dd>
                <dt>output_hash</dt><dd className="mono">{att.output_hash}</dd>
                {typeof att.worker_measurement === "string" ? (<><dt>worker_measurement</dt><dd className="mono">{att.worker_measurement}</dd></>) : null}
              </dl>
              <DcapRow quoteB64={att.tdx_quote} outlayerApi={NETWORKS[net].outlayerApi} />
            </>
          ) : (
            <div className={styles.box}>
              <ProofPill label="NOT PROVEN" /> No attestation record was read for this eval{data.attestationNote ? `: ${data.attestationNote}` : ""}.
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
