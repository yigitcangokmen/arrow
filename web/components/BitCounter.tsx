import { formatBits } from "../lib/format.ts";
import styles from "./BitCounter.module.css";

/** G1 counter (DEC A.1): the line is verbatim, the note under it keeps the claim honest. */
export function BitCounter({ spentBits, budgetBits }: { spentBits: number; budgetBits: number }) {
  return (
    <div className={styles.counter}>
      <p className={`mono ${styles.line}`}>
        seller content → chain/operator: 0 B · out: {formatBits(Math.round(spentBits * 1000))} bits / budget{" "}
        {formatBits(Math.round(budgetBits * 1000))} bits
      </p>
      <p className={styles.note}>
        a 40-row sample is read by NEAR AI&apos;s TEE model (see <a href="/#trust">trust table</a>)
      </p>
    </div>
  );
}
