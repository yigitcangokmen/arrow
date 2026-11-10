import { hashCheck } from "../lib/hashes.ts";
import styles from "./HashTriple.module.css";

/** The G3 check: the hash on chain, what the enclave reported (eval and release), and the bytes you downloaded. */
export function HashTriple({ onChain, enclave, release, downloaded }: {
  onChain: string;
  /** h of the eval output. */
  enclave?: string | null;
  /** h of the release output; leave out when no purchase was made. */
  release?: string | null;
  downloaded?: string | null;
}) {
  const check = hashCheck({ onChain, evalH: enclave, releaseH: release, downloaded });
  const verdict = check.match
    ? "sha256 match ✔ delivered blob == inspected blob"
    : check.mismatched.length > 0
      ? `sha256 mismatch ✘ (${check.mismatched.join(", ")})`
      : "waiting for the remaining hashes";
  return (
    <div className={styles.box}>
      <dl className={styles.list}>
        {check.rows.map((r) => (
          <div key={r.label} className={styles.row}>
            <dt>{r.label}{r.state === "mismatch" ? " ✘" : r.state === "ok" ? " ✔" : ""}</dt>
            <dd className="mono">{r.value ?? "not available yet"}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.verdict} role="status">{verdict}</p>
    </div>
  );
}
