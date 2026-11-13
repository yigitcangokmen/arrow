import styles from "./AttackGrid.module.css";

/** One cell per planted instruction: caught by the pattern check (tick) or not (cross). A picture; the numbers sit next to it. */
export function AttackGrid({ caught }: { caught: boolean[] }) {
  return (
    <span className={styles.grid} aria-hidden="true">
      {caught.map((c, i) => (
        <span key={i} className={c ? styles.ok : styles.miss} />
      ))}
    </span>
  );
}
