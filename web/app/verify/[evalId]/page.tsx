import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { NEAR_AI_API, NEAR_AI_MODEL, type Report } from "@arrow/sdk/verify";
import { NETWORKS } from "@arrow/sdk/config";
import { Badge } from "../../../components/Badge.tsx";
import { HashValue } from "../../../components/HashValue.tsx";
import { PageHead } from "../../../components/Section.tsx";
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
import { TryNext, VerifyRows } from "../VerifyView.tsx";
import styles from "../verify.module.css";

// The engine reads the chain, the archival RPC and OutLayer for every recorded run: about 90 s for the testnet evidence today.
export const maxDuration = 300;

const evals = ttlCache<EvalPageData>(300_000, Date.now, 200, { failTtlMs: 60_000, maxWaiters: 12 }); // one load per eval at a time, a failure is not retried for a minute

const NEAR_AI_URL = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(NEAR_AI_MODEL)}&provider=near&signing_algo=ecdsa`;

export async function generateMetadata({ params }: { params: Promise<{ evalId: string }> }): Promise<Metadata> {
  const raw = (await params).evalId;
  return { title: isEvalId(raw) ? `Verify inspection ${raw}` : "Not an inspection id" };
}

export default async function VerifyEval({ params, searchParams }: { params: Promise<{ evalId: string }>; searchParams: Promise<{ network?: string }> }) {
  const { evalId: raw } = await params;
  const net = parseNetwork((await searchParams).network);
  const back = <p><Link href={withNetwork("/verify", net)}>All rows for {net}</Link></p>;

  if (!isEvalId(raw)) {
    return (
      <div data-ready="true">
        <PageHead eyebrow="Verify one inspection" title="Verify an inspection" />
        <EmptyState title="This is not an inspection id">An inspection id is a whole number, for example <span className="mono">/verify/14</span>.</EmptyState>
        {back}
      </div>
    );
  }
  const id = Number(raw);
  return (
    <div data-ready="true">
      <PageHead eyebrow="Verify one inspection" title={`Inspection #${id}, checked from the chain.`}>
        What happened, step by step, with a transaction for each step. Below it are the checks: the program that ran and its hardware
        report, an Intel TDX quote that this browser verifies.
      </PageHead>
      {back}
      <Suspense key={`${net}:${id}`} fallback={
        <div className={styles.pending} aria-busy="true">
          <p className={styles.pendingLine} role="status">
            <span className={styles.spinner} aria-hidden="true" /> Reading inspection #{id} from the chain and OutLayer. This can take a minute or
            two when the server is cold.
          </p>
        </div>
      }>
        <EvalBody id={id} net={net} />
      </Suspense>
    </div>
  );
}

async function EvalBody({ id, net }: { id: number; net: "testnet" | "mainnet" }) {
  let data: EvalPageData | null = null;
  let failure: string | null = null;
  try {
    data = await evals(`${net}:${id}`, () => loadEval({ network: net, evidence: evidence[net], releaseSha256, teamAccounts }, id));
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }

  if (failure || !data) {
    return (
      <ErrorBox title={`Could not read inspection #${id} on ${net}`} fallback={`Run it yourself: npm run verify -- --network ${net}`}>
        <p className="mono">{failure}</p>
      </ErrorBox>
    );
  }

  const known = data.run !== null || data.onChain !== null;
  const att = data.attestation?.record;
  const report: Report | null = data.report;
  const summary = report ? summaryView(report) : null;
  return (
    <>
      {data.run ? <Timeline data={data} net={net} /> : null}
      <div className={styles.summary}>
        <span className={styles.note}>Market contract · inspection transaction</span>
        <Badge kind={net} />
        <span className="mono">{NETWORKS[net].contract}</span>
        {data.run?.tx ? <TxLink chain="near" network={net} hash={data.run.tx} /> : null}
      </div>

      {!known ? (
        <EmptyState title={`No inspection #${id} on ${net}`}>
          {data.viewError ? <p className="mono">The contract view failed: {data.viewError}</p> : <p>The contract has no inspection with this id and the evidence file does not mention it.</p>}
        </EmptyState>
      ) : null}

      {data.onChain ? (
        <section className={styles.group} aria-labelledby="g-chain">
          <p className={styles.eyebrow}>On chain</p>
          <h2 id="g-chain" className={styles.groupTitle}>What the contract recorded.</h2>
          <dl className={styles.facts}>
            <dt>status</dt><dd>{data.onChain.status}</dd>
            <dt>listing</dt><dd>{String(data.onChain.listing_id)}</dd>
            <dt>file fingerprint (h)</dt><dd>{data.onChain.h ? <HashValue value={data.onChain.h} /> : "none"}</dd>
            {data.onChain.refund_reason ? (<><dt>refund reason</dt><dd>{data.onChain.refund_reason}</dd></>) : null}
          </dl>
          {data.onChain.status === "refunded" ? (
            <p className={styles.note}>
              This inspection did not finish, so the contract refunded it (the buyer gets the fee back less Arrow&apos;s share). A refunded
              inspection has no verdict to check. Recorded refunds are checked by row R5 on the main Verify page.
            </p>
          ) : null}
        </section>
      ) : null}

      {known && !data.run ? (
        <div className={styles.box}>
          <ProofPill label="NOT PROVEN" /> This inspection exists on chain but is not one of the recorded runs (a visitor&apos;s demo run, for
          example), so its attestation is not checked here. That says nothing against it; it was simply not recorded. Recorded runs are listed
          on the <Link href={withNetwork("/verify", net)}>main Verify page</Link>. To add one: <span className="mono">scripts/src/evidence-add.ts</span>, then{" "}
          <span className="mono">npm run verify -- --network {net}</span>.
        </div>
      ) : null}

      {report && summary ? (
        <>
          <p className={styles.eyebrow}>Checks</p>
          <h2 className={styles.groupTitle}>The checks for this inspection.</h2>
          <p className={styles.note}>Only the program-hash and attestation rows run here, on this inspection alone. The listing-level rows are on the main Verify page.</p>
          <div className={styles.summary} role="status">
            <p className={`${styles.verdictLine} ${summary.passed ? styles.ok : ""}`}>
              {summary.passed ? `All ${report.required.total} required checks passed.` : `${report.required.proven} of ${report.required.total} required checks passed right now.`}
            </p>
            <span className={styles.summaryPlain}>
              {summary.passed
                ? "The program that ran is the published one, and the hardware report belongs to this inspection."
                : "Not every required row could be PROVEN for this inspection. NOT PROVEN means this page could not show it, for example because a record was missing; each row below says why."}
            </span>
            <span className={styles.cli}>{summary.line}</span>
            {summary.failure ? <span className={styles.fail}>{summary.failure}</span> : null}
          </div>
          <VerifyRows rows={report.rows} after={{ N1: <NearAiRow urlPrefix={NEAR_AI_URL} /> }} />
          <script id="verify-rows" type="application/json" dangerouslySetInnerHTML={{ __html: reportJson(report) }} />
        </>
      ) : null}

      {data.run ? (
        <section className={styles.group} aria-labelledby="g-att">
          <p className={styles.eyebrow}>OutLayer attestation</p>
          <h2 id="g-att" className={styles.groupTitle}>The hardware report.</h2>
          {att && data.attestation ? (
            <>
              <dl className={styles.facts}>
                <dt>request id</dt><dd className="mono">{data.attestation.requestId}</dd>
                <dt>transaction_hash</dt><dd><HashValue value={att.transaction_hash} /></dd>
                <dt>wasm_hash</dt><dd><HashValue value={att.wasm_hash} /></dd>
                <dt>input_hash</dt><dd><HashValue value={att.input_hash} /></dd>
                <dt>output_hash</dt><dd><HashValue value={att.output_hash} /></dd>
                {typeof att.worker_measurement === "string" ? (<><dt>worker_measurement</dt><dd><HashValue value={att.worker_measurement} /></dd></>) : null}
              </dl>
              <DcapRow quoteB64={att.tdx_quote} />
            </>
          ) : (
            <div className={styles.box}>
              <ProofPill label="NOT PROVEN" /> No attestation record was read for this inspection{data.attestationNote ? `: ${data.attestationNote}` : ""}.
            </div>
          )}
        </section>
      ) : null}
      <TryNext />
    </>
  );
}

/** "A recorded verdict": the part of the observed line before the bit counts ("BUY · fit 5/5 · novelty 4/5"). */
const verdictOf = (observed: string): string => observed.split(" · out ")[0]!.trim();

/** The inspection as it happened, in plain steps, each with its transaction. Only recorded runs; nothing here is inferred. */
function Timeline({ data, net }: { data: EvalPageData; net: "testnet" | "mainnet" }) {
  const run = data.run!;
  const refunded = data.onChain?.status === "refunded";
  const listing = run.listing_id !== null ? `listing #${String(run.listing_id)}` : "the listing";
  return (
    <ol className={styles.timeline} aria-label="What happened">
      <li>
        <span className={styles.step}>1</span>
        <p className={styles.what}>A seller listed an encrypted file.</p>
        <p className={styles.meta}>
          {listing}
          {data.story.list?.tx ? <> · <TxLink chain="near" network={net} hash={data.story.list.tx} /></> : " · listing transaction not recorded"}
        </p>
      </li>
      <li>
        <span className={styles.step}>2</span>
        <p className={styles.what}>A buyer paid the inspection fee and said what they need.</p>
        <p className={styles.meta}>{run.tx ? <TxLink chain="near" network={net} hash={run.tx} /> : "transaction not recorded"}</p>
      </li>
      <li>
        <span className={styles.step}>3</span>
        {refunded ? (
          <p className={styles.what}>The run did not finish, so the fee was refunded.</p>
        ) : (
          <p className={styles.what}>The AI answered <span className="mono">{verdictOf(run.observed) || "(not recorded)"}</span>.</p>
        )}
        <p className={styles.meta}>
          The verdict is sealed to the buyer&apos;s key on chain, so this page cannot read it; this is what the recording script observed ({run.script}).
        </p>
      </li>
      {data.story.buy ? (
        <li>
          <span className={styles.step}>4</span>
          <p className={styles.what}>The listing was bought and the file&apos;s fingerprint was checked.</p>
          <p className={styles.meta}>
            <span className="mono">{data.story.buy.observed}</span>
            {data.story.buy.tx ? <> · <TxLink chain="near" network={net} hash={data.story.buy.tx} /></> : null}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
