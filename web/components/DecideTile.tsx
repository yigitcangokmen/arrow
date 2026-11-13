"use client";
import { Cipher } from "./Cipher.tsx";
import PixelTransition from "./reactbits/PixelTransition.tsx";
import styles from "./DecideTile.module.css";

/** The first five rows of fixtures/demo/wallet-labels-1000.csv (synthetic), first three columns. */
const ROWS = [
  ["w0001-8d4f8d…", "cex_hot_wallet", "0.59"],
  ["w0002-9926d8…", "arbitrage_bot", "0.99"],
  ["w0003-855644…", "airdrop_farmer", "0.68"],
  ["w0004-aa8d01…", "arbitrage_bot", "0.90"],
  ["w0005-25bd85…", "lp_whale", "0.52"],
];

const Eye = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Pay, and the rows are yours: the sealed file dissolves into readable rows on hover, tap or keyboard focus (React Bits PixelTransition). */
export function DecideTile({ fileName }: { fileName: string }) {
  return (
    <PixelTransition
      className={styles.tile}
      aspectRatio="auto"
      label="Show the decrypted rows of the synthetic file"
      gridSize={16}
      pixelColor="var(--pix)"
      animationStepDuration={0.35}
      firstContent={
        <div className={styles.face}>
          <div className={styles.head}><span className={styles.name}>{fileName}</span><span className={styles.tags}><span className={styles.tag}>sealed</span><span className={styles.hint}><Eye />reveal</span></span></div>
          <Cipher className={styles.rows} lines={11} seed={3} />
        </div>
      }
      secondContent={
        <div className={styles.face}>
          <div className={styles.head}><span className={styles.name}>{fileName}</span><span className={styles.tag}>synthetic</span></div>
          <table className={styles.plain}>
            <thead><tr><th scope="col">account_id</th><th scope="col">label</th><th scope="col">confidence</th></tr></thead>
            <tbody>{ROWS.map((r) => <tr key={r[0]}>{r.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      }
    />
  );
}
