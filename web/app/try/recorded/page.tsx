import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { evidence } from "../../../generated/data.ts";
import { CONTRACTS } from "../../../lib/config.ts";
import { RECORDED_RUN, shortHash } from "../../../lib/links.ts";
import { recordedRun } from "../../../lib/recorded.ts";
import { Replay } from "./Replay.tsx";
import styles from "./recorded.module.css";

export const metadata = { title: "Recorded run" };

export default async function Recorded() {
  const views = new ArrowViews("testnet", CONTRACTS.testnet);
  const chain = await Promise.all([views.listing(RECORDED_RUN.listingId), views.eval(RECORDED_RUN.evalId), views.purchase(RECORDED_RUN.purchaseId)])
    .then(([listing, ev, purchase]) => ({ listing, eval: ev, purchase }))
    .catch(() => null);
  const run = recordedRun(evidence.testnet, chain);
  const day = run.paidAt ? new Date(run.paidAt).toISOString().slice(0, 10) : null;
  const m = run.verdict ? /^(BUY|PASS) · fit (\d)\/5 · novelty (\d)\/5/.exec(run.verdict) : null;
  const verdict = m ? { word: m[1] as "BUY" | "PASS", fit: Number(m[2]), novelty: Number(m[3]) } : null;
  const prints = run.fingerprints;

  return (
    <div data-ready="true">
      <div className={styles.head}>
        <p className={styles.eyebrow}>Demo · recorded</p>
        <h1 className={styles.h1}>A run that finished.</h1>
        <p className={styles.lede}>One real run on NEAR testnet, replayed 6× faster; every step links to its transaction.</p>
      </div>
      <Replay
        steps={run.steps}
        verdict={verdict}
        unlocked={
          prints && run.match ? (
            <div className={styles.unlocked}>
              <span className={styles.unlockedTag}>fingerprints match ✓</span>
              <dl>
                <div><dt>listed</dt><dd className="mono">{shortHash(prints.listed)}</dd></div>
                <div><dt>inspected</dt><dd className="mono">{prints.inspected ? shortHash(prints.inspected) : "not on chain"}</dd></div>
                <div><dt>delivered</dt><dd className="mono">{prints.delivered ? shortHash(prints.delivered) : "not on chain"}</dd></div>
              </dl>
            </div>
          ) : null
        }
      />

      <section className={styles.result} aria-labelledby="rec-result">
        <h2 id="rec-result">{run.verdict ? `It said ${run.verdict.split(" ")[0]}. The buyer bought it. The file matched.` : "The buyer bought the file and it matched."}</h2>
        {run.verdict ? <p className={styles.verdict}>{run.verdict}</p> : null}
        <details className={styles.fold}>
          <summary>How this verdict was recorded</summary>
          <p className={styles.note}>
            The verdict is sealed to that buyer&apos;s own key, so the chain shows it only in sealed form; the words above are what the run recorded
            when it opened it. The fingerprints below are read from the chain now{day ? `; the run was paid on ${day}` : ""}.
            {chain ? " The times next to each step are read from the chain now." : " The chain could not be reached just now, so the real times are left out."}
          </p>
        </details>
        {run.fingerprints ? (
          <div className={styles.prints}>
            <dl>
              <div><dt>listed (on chain since the listing)</dt><dd className="mono">{run.fingerprints.listed}</dd></div>
              <div><dt>inspected (reported by the sealed hardware)</dt><dd className="mono">{run.fingerprints.inspected ?? "not on chain"}</dd></div>
              <div><dt>delivered (reported with the key)</dt><dd className="mono">{run.fingerprints.delivered ?? "not on chain"}</dd></div>
            </dl>
            <p className={run.match ? styles.match : undefined} role="status">
              {run.match ? "3 fingerprints on chain match ✓ The run recorded that the file it downloaded matched too." : "The fingerprints on chain do not all match."}
            </p>
          </div>
        ) : null}
      </section>

      <div className={styles.links}>
        <Link href="/try">Run it yourself, free →</Link>
        <Link href={`/verify/${RECORDED_RUN.evalId}`}>The full audit of this inspection, with the hardware report →</Link>
      </div>
    </div>
  );
}
