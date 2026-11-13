import { TRUST_ROWS, trustRowId } from "../lib/trust.ts";
import { TRUST_PATH } from "../lib/links.ts";
import styles from "./FlagGrid.module.css";

const KIND = { RISKY: styles.risky, "NOT PROVEN": styles.notproven, TODO: styles.todo } as const;

/** Flag counts, read from the trust table rows, never typed. */
export function flagCounts() {
  const count = (f: string) => TRUST_ROWS.filter((r) => r.flag === f).length;
  return { total: TRUST_ROWS.length, risky: count("RISKY"), notProven: count("NOT PROVEN"), todo: count("TODO") };
}

/**
 * One cell per trust-table row, coloured by its flag: RISKY, NOT PROVEN, TODO (hatched) or none. Static. With `link`, each cell opens
 * its row on the trust page, with cells large enough to tap (24 px, WCAG 2.5.8); inside another link (the home tile) it stays a picture.
 */
export function FlagGrid({ link = false }: { link?: boolean }) {
  return (
    <ul className={`${styles.grid} ${link ? styles.links : ""}`} aria-label={link ? "Trust table rows by flag" : undefined} aria-hidden={link ? undefined : true}>
      {TRUST_ROWS.map((r) => {
        const cls = `${styles.cell} ${r.flag ? KIND[r.flag] : ""}`;
        const name = `${r.part}${r.flag ? `: ${r.flag}` : ""}`;
        return (
          <li key={r.part}>
            {link ? <a className={cls} href={`${TRUST_PATH}#${trustRowId(r.part)}`} title={name}><span className="sr-only">{name}</span></a> : <span className={cls} title={name} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The three flag colours with their counts, for a grid shown without the trust table next to it. */
export function FlagLegend() {
  const n = flagCounts();
  return (
    <span className={styles.legend}>
      <span><i className={`${styles.cell} ${styles.risky}`} />{n.risky} risky</span>
      <span><i className={`${styles.cell} ${styles.notproven}`} />{n.notProven} not proven</span>
      <span><i className={`${styles.cell} ${styles.todo}`} />{n.todo} todo</span>
    </span>
  );
}
