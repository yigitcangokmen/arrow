import Link from "next/link";
import type { Row } from "@arrow/sdk/verify";
import type { ReactNode } from "react";
import { ProofPill } from "../../components/ProofPill.tsx";
import { couldNotRun, GROUP_PLAIN, groupRows, linkText, PLAIN, safeHref } from "../../lib/verifyView.ts";
import styles from "./verify.module.css";

/**
 * The rows of a report, grouped. Each row opens with one plain sentence; the engine's label and wording follow unchanged, so the
 * page never says more than `npm run verify` does.
 */
export function VerifyRows({ rows, after, fold = false }: { rows: readonly Row[]; after?: Record<string, ReactNode>; fold?: boolean }) {
  return (
    <>
      {groupRows(rows).map((g) => {
        const table = (
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
        );
        // With `fold`, only the REQUIRED rows stay open; every other group is one click away, its counts on the fold.
        if (fold && g.key !== "required") {
          const counts = [...new Set(g.rows.map((r) => r.label))].map((l) => `${g.rows.filter((r) => r.label === l).length} ${l}`).join(" · ");
          return (
            <details key={g.key} className={styles.groupFold}>
              <summary>
                <span className={styles.groupFoldTitle}>{GROUP_PLAIN[g.key]}</span>
                <span className={styles.groupFoldCount}>{counts}</span>
              </summary>
              <p className={styles.note}>{g.note}</p>
              {table}
            </details>
          );
        }
        return (
          <section key={g.key} className={styles.group} aria-labelledby={`g-${g.key}`}>
            <p className={styles.eyebrow}>{g.title}</p>
            <h2 id={`g-${g.key}`} className={styles.groupTitle}>{GROUP_PLAIN[g.key]}</h2>
            <p className={styles.note}>{g.note}</p>
            {table}
          </section>
        );
      })}
    </>
  );
}

function RowLine({ row, extra }: { row: Row; extra?: ReactNode }) {
  const links = row.links.map(safeHref).filter((h): h is string => h !== null);
  const plain = PLAIN[row.id];
  const failedToRun = couldNotRun(row.detail);
  return (
    <tr>
      <td className={styles.result}><ProofPill label={row.label} />{row.required ? <span className={styles.req}>required</span> : null}</td>
      <td className={styles.id}>{row.id}</td>
      <td>
        {plain ? <p className={styles.plain}>{plain}</p> : null}
        <p className={styles.engine}>{row.title}</p>
        {failedToRun ? (
          <div className={styles.retry}>
            <p>Could not check right now: the archive node did not answer. Reload the page in a few minutes to run the check again; until then it counts as NOT PROVEN.</p>
            <details>
              <summary>The error</summary>
              <p className="mono">{row.detail}</p>
            </details>
          </div>
        ) : row.detail ? (
          <p className={styles.detail}>{row.detail}</p>
        ) : null}
        {links.length > 0 ? (
          <ul className={styles.links}>
            {links.map((h) => (
              <li key={h}><a className="mono" href={h} target="_blank" rel="noopener noreferrer">{linkText(h)}<span className="sr-only"> (opens in a new tab)</span></a></li>
            ))}
          </ul>
        ) : null}
        {extra ? <div className={styles.extra}>{extra}</div> : null}
      </td>
    </tr>
  );
}

/** The next step after reading the proof: run it. */
export function TryNext() {
  return (
    <div className={styles.next}>
      <p><b>See it happen.</b> The free demo runs a listing, an inspection and a purchase on testnet with a throwaway account, in about 3 minutes.</p>
      <Link className={styles.go} href="/try">Run the demo, free</Link>
    </div>
  );
}
