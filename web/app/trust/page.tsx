import Link from "next/link";
import type { Metadata } from "next";
import { SightLegend, Sightlines } from "../../components/Sightlines.tsx";
import { TrustBand } from "../../components/TrustBand.tsx";
import { DEFAULT_NETWORK } from "../../lib/config.ts";
import { lastSummary } from "../../lib/server/verifyReport.ts";
import styles from "./trust.module.css";

export const metadata: Metadata = { title: "Who sees what" };

/** Who sees what: the four sightlines, why Arrow exists, what sealed hardware is, every limit in plain words and the full trust table. */
export default function Trust() {
  const verifyLine = lastSummary(DEFAULT_NETWORK);
  return (
    <div data-ready="true" className={styles.page}>
      <section className={styles.head} aria-labelledby="trust-h1">
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Who sees what</p>
          <h1 id="trust-h1" className={styles.h1}>Who sees what.</h1>
          <p className={styles.lede}>What each part can see, what comes back to you, and what you still trust.</p>
          <SightLegend className={styles.legend} />
          <div className={styles.sight}><Sightlines large /></div>
          <p className={styles.jump}><a href="#trust-table">The full trust table ↓</a></p>
        </div>
      </section>

      <section className={styles.why} aria-label="Why inspect first">
        <div className={`${styles.wrap} ${styles.whyGrid}`}>
          <p className={styles.whyLeft}>
            In 1962 the economist Kenneth Arrow described why data is hard to sell: a buyer cannot judge it without seeing it, and once they have
            seen it they have little reason to pay.
          </p>
          <div className={styles.whyRight}>
            <p>
              <b>Arrow&apos;s answer: the buyer does not look.</b> For a small fee, an AI looks for them inside sealed hardware and returns a capped
              verdict. Then they decide.
            </p>
            <p className={styles.define}>
              Sealed hardware means a walled-off part of a computer chip, built so that even the machine&apos;s owner cannot read or change the
              program running inside, and so that the chip can sign a report of exactly which program ran.
            </p>
            <details className={styles.fold}>
              <summary>Technical detail</summary>
              <p>
                A trusted execution environment (TEE, also called an enclave). Arrow&apos;s program runs in an Intel TDX TEE on OutLayer&apos;s
                workers; NEAR AI runs its model in Intel TDX with NVIDIA confidential computing. The signed report is a TDX quote:{" "}
                <Link href="/verify">/verify</Link> checks it in your browser, nothing on chain checks it, and the guarantee rests on Intel&apos;s
                hardware (trust rows <i>Evaluation</i> and <i>LLM</i>).
              </p>
            </details>
          </div>
        </div>
      </section>

      <TrustBand verifyLine={verifyLine?.line ?? null} />
    </div>
  );
}
