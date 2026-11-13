import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { HonestyLine, PageHead } from "../../../components/Section.tsx";
import { evidence } from "../../../generated/data.ts";
import { CONTRACTS } from "../../../lib/config.ts";
import { RECORDED_RUN } from "../../../lib/links.ts";
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

  return (
    <div data-ready="true">
      <PageHead eyebrow="The demo, recorded" title="Watch a run that finished.">
        The same steps as the free demo, from one run on NEAR testnet{day ? ` on ${day}` : ""}: a file is listed, a buyer pays for an
        inspection, gets BUY, buys the file and checks it is the same file. Press play to watch it; every step with a transaction links to it.
      </PageHead>
      <HonestyLine items={["NEAR testnet", "synthetic data", "test money only", chain ? "times read from the chain now" : "chain not reachable: times left out"]} />
      <Replay steps={run.steps} />

      <section className={styles.result} aria-labelledby="rec-result">
        <h2 id="rec-result">{run.verdict ? `It said ${run.verdict.split(" ")[0]}. The buyer bought it. The file matched.` : "The buyer bought the file and it matched."}</h2>
        {run.verdict ? <p className={styles.verdict}>{run.verdict}</p> : null}
        <p className={styles.note}>
          The verdict is sealed to that buyer&apos;s own key, so the chain shows it only in sealed form; the words above are what the run recorded
          when it opened it. The fingerprints below are read from the chain now.
        </p>
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
