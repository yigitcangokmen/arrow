import Link from "next/link";
import { shortHash } from "../lib/links.ts";
import styles from "./Fingerprints.module.css";

/**
 * The fingerprint chain of one run: listed on chain = inspected by the sealed hardware = delivered with the key. Values are what the
 * chain holds now; a value that could not be read shows the rule ("must match") instead of a tick. With `href`, the panel links to the
 * page that checks the run from the chain.
 */
export function Fingerprints({ listed, inspected, delivered, href }: { listed: string | null; inspected: string | null; delivered: string | null; href?: string }) {
  const row = (lab: string, v: string | null, ok: boolean, note: string) => (
    <div className={styles.hash}>
      <span className={styles.lab}>{lab}</span>
      <span className={styles.v} title={v ?? undefined}>{v ? shortHash(v) : "must match"}</span>
      <span className={ok ? styles.ok : styles.note}>{ok ? "✓" : note}</span>
    </div>
  );
  const body = (
    <>
      <span className={styles.k}>fingerprint{href ? <Arrow /> : null}</span>
      <div className={styles.hashes}>
        {row("listed", listed, false, "on chain")}
        <span className={styles.eq} aria-hidden="true">=</span>
        {row("inspected", inspected, !!listed && inspected === listed, "")}
        <span className={styles.eq} aria-hidden="true">=</span>
        {row("delivered", delivered, !!listed && delivered === listed, "")}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className={`${styles.triple} ${styles.linked}`}
      title="Check this run from the chain"
      aria-label={`Fingerprints of the recorded run: listed${inspected && listed && inspected === listed ? ", inspected" : ""}${delivered && listed && delivered === listed ? " and delivered match" : ""}. Check it from the chain`}
    >
      {body}
    </Link>
  ) : (
    <div className={styles.triple}>{body}</div>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
