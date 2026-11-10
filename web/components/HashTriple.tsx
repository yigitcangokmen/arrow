import styles from "./HashTriple.module.css";

/** The G3 triple: the hash on chain, the hash the enclave reported, the hash of the bytes you downloaded. */
export function HashTriple({ onChain, enclave, downloaded }: { onChain: string; enclave: string; downloaded?: string | null }) {
  const rows = [
    ["on chain (blob_sha256)", onChain],
    ["enclave read (h)", enclave],
    ["you downloaded", downloaded ?? "not downloaded yet"],
  ] as const;
  const match = downloaded != null && downloaded === onChain && enclave === onChain;
  return (
    <div className={styles.box}>
      <dl className={styles.list}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.row}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.verdict}>{match ? "sha256 match ✔" : downloaded == null ? "waiting for the download" : "sha256 mismatch ✘"}</p>
    </div>
  );
}
