import type { Row } from "@arrow/sdk/verify";
import type { ReactNode } from "react";
import { ProofPill } from "../../components/ProofPill.tsx";
import { groupRows, linkText, safeHref } from "../../lib/verifyView.ts";
import styles from "./verify.module.css";

/** The rows of a report, grouped. Labels are printed as text and the engine's wording is shown unchanged. */
export function VerifyRows({ rows, after }: { rows: readonly Row[]; after?: Record<string, ReactNode> }) {
  return (
    <>
      {groupRows(rows).map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`}>{g.title}</h2>
          <p className={styles.note}>{g.note}</p>
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">Result</th><th scope="col">Row</th><th scope="col">Claim and evidence</th></tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <RowLine key={r.id} row={r} extra={after?.[r.id]} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function RowLine({ row, extra }: { row: Row; extra?: ReactNode }) {
  const links = row.links.map(safeHref).filter((h): h is string => h !== null);
  return (
    <>
      <tr>
        <td data-label="Result"><ProofPill label={row.label} />{row.required ? <span className={styles.req}>REQUIRED</span> : null}</td>
        <td data-label="Row" className={styles.id}>{row.id}</td>
        <td data-label="Claim and evidence">
          {row.title}
          {row.detail ? <p className={styles.detail}>{row.detail}</p> : null}
          {links.length > 0 ? (
            <ul className={styles.links}>
              {links.map((h) => (
                <li key={h}><a className="mono" href={h} target="_blank" rel="noopener noreferrer">{linkText(h)}</a></li>
              ))}
            </ul>
          ) : null}
        </td>
      </tr>
      {extra ? <tr><td colSpan={3}>{extra}</td></tr> : null}
    </>
  );
}
