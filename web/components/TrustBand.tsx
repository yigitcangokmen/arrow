import { TRUST_ROWS, trustRowId } from "../lib/trust.ts";
import { OpenOnHash } from "./OpenOnHash.tsx";
import { SectionHead } from "./Section.tsx";
import { TrustTable } from "./TrustTable.tsx";
import styles from "./TrustBand.module.css";

/** Plain lines. `rows` names the trust-table rows each line comes from; the table stays the source of truth and each line links to its first row. */
export const WHO: { label: string; value: string; detail: string; rows: string[] }[] = [
  { label: "You, the buyer", value: "BUY or PASS, plus a fit score and a novelty score from 1 to 5 if the seller allows scores. Never a row.", detail: "That is one of 51 possible answers. Measured as information it is under 6 bits, about as much as six yes/no answers. A failed run adds two more possible outcomes.", rows: ["Output channel", "Error channel"] },
  { label: "The seller", value: "Earns 90% of each inspection fee, and 98% of the price when you buy.", detail: "Cannot read what you asked for.", rows: ["Decision correctness", "Seller data at rest"] },
  { label: "NEAR AI", value: "A 40-row sample, whole-file totals and what you asked for. Its model runs in its own sealed hardware.", detail: "The sample reaches it encrypted in transit, but not sealed end to end. That it keeps nothing is its own claim; we cannot prove it.", rows: ["40-row sample to NEAR AI", "Wasm to NEAR AI", "LLM"] },
  { label: "Arrow, the operator", value: "Hosts the encrypted files and sees who pays: IP address, wallet address, listing.", detail: "This site is served by Arrow, and a changed version could read what you type. For sensitive data use the command-line tool.", rows: ["Arrow operator", "Arrow web app (served JavaScript)"] },
  { label: "Anyone on chain", value: "How long each inspection ran and how much work it did; the column names, row count and exact file size.", detail: "These can hint at the data. They are not counted in the 6-bit figure, and a buyer can steer them with what they ask.", rows: ["Side channels"] },
  { label: "If it fails", value: "A failed purchase comes back in full; a failed inspection, less Arrow's 10% share of the fee.", detail: "On mainnet it goes to your NEAR Intents balance, a USDC balance held for your wallet on NEAR; on testnet, to your test-token balance.", rows: ["Refund destination"] },
];

/**
 * The limits, in plain words. Together with WHO they name every flagged row of the trust table (web/uitest/trust.band.test.ts),
 * so the intro can say so. `rows` are trust-table part names; the first one is linked.
 */
export const LIMITS: { text: string; rows: string[] }[] = [
  { text: "The company that runs the sealed hardware, OutLayer, holds the keys, and the group that governs it could export them.", rows: ["OutLayer keystore DAO"] },
  { text: "OutLayer and NEAR Intents can change their own contracts, and OutLayer changed its mainnet contract this week.", rows: ["outlayer.near, intents.near contracts", "OutLayer on mainnet"] },
  { text: "Paying from Base goes through 1Click and a bridge run by Intents Technology, which hold the money for a short time during the swap.", rows: ["1Click and the PoA bridge (Intents Technology)"] },
  { text: "Nothing on chain checks the hardware report of each run; the verify page checks it in your browser.", rows: ["Evaluation"] },
  { text: "The verdict can be wrong. Fixed rules check the structure, but whether a 40-row sample fits what you asked is the AI's judgement.", rows: ["Decision correctness"] },
  { text: "Anyone can see which wallet inspected which listing, when, and what it paid. Any site that gets the same wallet signature can open that wallet's verdicts.", rows: ["Buyer viewing key"] },
  { text: "A buyer can resell a file they bought. And if the key for a purchase is published too late, the buyer gets a refund and can still open the file.", rows: ["After purchase", "Time guard"] },
  { text: "Real payments are not live yet: mainnet is not deployed and the contract can still be changed by the team.", rows: ["Arrow operator", "Refund destination"] },
  { text: "The AI runs on the hackathon's free key. If it runs out, inspections fail and most of the fee comes back.", rows: ["NEAR AI API key (inside the OutLayer secret)"] },
];

/** The rest of the flagged rows, still in plain words, one fold down. */
export const MORE: { text: string; rows: string[] }[] = [
  { text: "Every program key comes from one master key that OutLayer shares across programs.", rows: ["Program key / PROTECTED_MASTER"] },
  { text: "The rule that ties the key to Arrow's exact program is set, but no transaction has tested it.", rows: ["Program key / PROTECTED_MASTER"] },
  { text: "The test of the AI's judgement on many datasets has not run, and instructions hidden inside well-formed data are an open risk.", rows: ["Decision correctness"] },
  { text: "A buyer can use up a listing's limit on inspections with runs that fail.", rows: ["Leak budget"] },
  { text: "The time limits use the clock of the machine that runs the sealed hardware.", rows: ["Time guard"] },
  { text: "The market contract keeps NEAR to pay for each run. Failed runs still use it up, and when it runs low new inspections are refused until someone tops it up.", rows: ["Gas tank"] },
  { text: "The account that relays payments has a second, all-powers key, kept by the team in a laptop keychain, never on the server; whoever holds it can drain the relay's gas or stop it. It holds no user money.", rows: ["Relayer account"] },
  { text: "The program file sits on a public file host. Its fingerprint is pinned on chain, so the host cannot swap it unnoticed, but it could stop serving it.", rows: ["Program bytes"] },
  { text: "How much the public run time reveals has not been measured; no number is published.", rows: ["Side channels"] },
];

/** Flag counts, computed from the rows, never typed. */
function flagCounts() {
  const count = (f: string) => TRUST_ROWS.filter((r) => r.flag === f).length;
  const flagged = TRUST_ROWS.filter((r) => r.flag).length;
  return { risky: count("RISKY"), notProven: count("NOT PROVEN"), todo: count("TODO"), flagged, total: TRUST_ROWS.length };
}

/** The link from a plain line to its first trust-table row. */
function Src({ rows }: { rows: string[] }) {
  return (
    <a className={styles.src} href={`#${trustRowId(rows[0]!)}`} title={`Trust table: ${rows.join(" · ")}`}>
      Source<span className="sr-only">: trust table, {rows.join(", ")}</span>
    </a>
  );
}

/** The dark band on /trust (`id="trust"`): every flagged row in plain words, with the full trust table one click away at its foot. */
export function TrustBand({ verifyLine }: { verifyLine?: string | null }) {
  const c = flagCounts();
  return (
    <section id="trust" aria-labelledby="trust-title" className={styles.ink}>
      <div className={styles.wrap}>
        <div className={styles.inkVars}>
          <SectionHead eyebrow="In plain words" title="What you still trust." id="trust-title">
            Every flagged row of the trust table is in a line below, the main ones first. Each line links to its row in the full table at the
            bottom of this band, which is the source of truth.
          </SectionHead>
          <div className={styles.grid}>
            <dl className={styles.dl}>
              {WHO.map((w) => (
                <div key={w.label}>
                  <dt>{w.label}</dt>
                  <dd>
                    {w.value}
                    <span className={styles.detail}>
                      {w.detail} <Src rows={w.rows} />
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className={styles.limits}>
              <h3>The honest limits.</h3>
              <ul className={styles.limitList}>
                {LIMITS.map((l) => <li key={l.text}>{l.text} <Src rows={l.rows} /></li>)}
              </ul>
              <details className={styles.more}>
                <summary>{MORE.length} more</summary>
                <ul>
                  {MORE.map((l) => <li key={l.text}>{l.text} <Src rows={l.rows} /></li>)}
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
