import { TRUST_ROWS, trustRowId } from "../lib/trust.ts";
import { OpenOnHash } from "./OpenOnHash.tsx";
import { SectionHead } from "./Section.tsx";
import { TrustTable } from "./TrustTable.tsx";
import styles from "./TrustBand.module.css";

/** Plain lines. `rows` names the trust-table rows each line comes from; the table stays the source of truth and each line links to its first row. */
const WHO: { label: string; value: string; detail: string; rows: string[] }[] = [
  { label: "You, the buyer", value: "BUY or PASS, plus a fit score and a novelty score from 1 to 5 if the seller allows scores. Never a row.", detail: "That is one of 51 possible answers. Measured as information it is under 6 bits, about as much as six yes/no answers. A failed run adds two more possible outcomes.", rows: ["Output channel", "Error channel"] },
  { label: "The seller", value: "Earns 90% of each inspection fee, and 98% of the price when you buy.", detail: "Cannot read what you asked for.", rows: ["Decision correctness", "Seller data at rest"] },
  { label: "NEAR AI", value: "A 40-row sample, whole-file totals and what you asked for. Its model runs in its own sealed hardware.", detail: "The sample reaches it encrypted in transit, but not sealed end to end. That it keeps nothing is its own claim; we cannot prove it.", rows: ["40-row sample to NEAR AI", "Wasm to NEAR AI", "LLM"] },
  { label: "Arrow, the operator", value: "Hosts the encrypted files and sees who pays: IP address, wallet address, listing.", detail: "This site is served by Arrow, and a changed version could read what you type. For sensitive data use the command-line tool.", rows: ["Arrow operator", "Arrow web app (served JavaScript)"] },
  { label: "Anyone on chain", value: "How long each inspection ran and how much work it did; the column names, row count and exact file size.", detail: "These can hint at the data. They are not counted in the 6-bit figure, and a buyer can steer them with what they ask.", rows: ["Side channels"] },
  { label: "If it fails", value: "A failed purchase comes back in full; a failed inspection, less Arrow's 10% share of the fee.", detail: "On mainnet it goes to your NEAR Intents balance, a USDC balance held for your wallet on NEAR; on testnet, to your test-token balance.", rows: ["Refund destination"] },
];

/** Flag counts, computed from the rows, never typed. */
function flagCounts() {
  const count = (f: string) => TRUST_ROWS.filter((r) => r.flag === f).length;
  const flagged = TRUST_ROWS.filter((r) => r.flag).length;
  return { risky: count("RISKY"), notProven: count("NOT PROVEN"), todo: count("TODO"), flagged, total: TRUST_ROWS.length };
}

/** "Who sees what": the dark band on the home page (`id="trust"`), with the full trust table one click away at its foot. */
export function TrustBand({ verifyLine }: { verifyLine?: string | null }) {
  const c = flagCounts();
  return (
    <section id="trust" aria-labelledby="trust-title" className={styles.ink}>
      <div className={styles.wrap}>
        <div className={styles.inkVars}>
          <SectionHead eyebrow="Trust, in plain words" title="Who sees what." id="trust-title">
            Everything you still have to trust, in plain words. Each line links to its row in the full trust table at the bottom of this band,
            which is the source of truth.
          </SectionHead>
          <div className={styles.grid}>
            <dl className={styles.dl}>
              {WHO.map((w) => (
                <div key={w.label}>
                  <dt>{w.label}</dt>
                  <dd>
                    {w.value}
                    <span className={styles.detail}>
                      {w.detail}{" "}
                      <a className={styles.src} href={`#${trustRowId(w.rows[0]!)}`} title={`Trust table: ${w.rows.join(" · ")}`}>
                        Source<span className="sr-only">: trust table, {w.rows.join(", ")}</span>
                      </a>
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className={styles.limits}>
              <h3>The honest limits.</h3>
              <ul className={styles.limitList}>
                <li>The company that runs the sealed hardware, OutLayer, holds the keys, and the group that governs it could export them.</li>
                <li>OutLayer and NEAR Intents can change their own contracts.</li>
                <li>Nothing on chain checks the hardware report of each run; the verify page checks it in your browser.</li>
                <li>A buyer can resell a file they bought. And if the key for a purchase is published too late, the buyer gets a refund and can still open the file.</li>
                <li>Real payments are not live yet: mainnet is not deployed and the contract can still be changed by the team.</li>
                <li>The AI runs on the hackathon&apos;s free key. If it runs out, inspections fail and most of the fee comes back.</li>
              </ul>
              <details className={styles.more}>
                <summary>Seven more, in technical terms</summary>
                <ul>
                  <li>Every program key comes from OutLayer&apos;s shared master key.</li>
                  <li>The quality bench has not run, and instructions hidden in well-formed data are an open risk.</li>
                  <li>No transaction tests the program key&apos;s WasmHash condition (it is configured).</li>
                  <li>A buyer can use up a listing&apos;s leak budget with failing inspections.</li>
                  <li>The time guard trusts the host&apos;s clock.</li>
                  <li>The relayer account also has a full-access key.</li>
                  <li>How much the run time reveals has not been measured; no number is published.</li>
                </ul>
              </details>
              <p>
                <b>{c.flagged} of {c.total}</b> trust rows carry a flag. A flag is a limit we name, not something broken:
              </p>
              <ul className={styles.chips} aria-label="Flags in the trust table">
                <li><b>{c.risky} RISKY</b> a named risk, not closed</li>
                <li><b>{c.notProven} NOT PROVEN</b> a claim we cannot prove</li>
                <li><b>{c.todo} TODO</b> proof still to come</li>
              </ul>
              {verifyLine ? (
                <p>
                  Latest result on the verify page: <span className="mono">{verifyLine}</span>
                </p>
              ) : null}
              <p className={styles.check}>
                Check it yourself: <code>npm run verify -- --network testnet</code>
              </p>
            </div>
          </div>
        </div>
        <details id="trust-table" className={styles.table}>
          <summary>The full trust table: all {c.total} rows, with how to check each one</summary>
          <div className={styles.tablePanel}>
            <TrustTable />
          </div>
        </details>
        <OpenOnHash id="trust-table" prefix="trust-row-" />
      </div>
    </section>
  );
}
