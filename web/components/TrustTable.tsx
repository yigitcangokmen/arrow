import { TRUST_ROWS, trustRowId } from "../lib/trust.ts";
import { ProofPill } from "./ProofPill.tsx";
import styles from "./TrustTable.module.css";

/** Table on wide screens, one card per row at 640 px and below (CSS only). */
export function TrustTable() {
  return (
    <section aria-labelledby="trust-table-title">
      <h2 id="trust-table-title" className={styles.title}>Trust table</h2>
      <p className={styles.lead}>What you trust, what each part can see, and how to check it. Open risks are marked RISKY, claims we cannot prove NOT PROVEN, and proof still to come TODO.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Who you trust</th>
            <th scope="col">Can see</th>
            <th scope="col">Cannot</th>
            <th scope="col">How to check</th>
          </tr>
        </thead>
        <tbody>
          {TRUST_ROWS.map((r) => (
            <tr key={r.part} id={trustRowId(r.part)}>
              <th scope="row" data-label="Part">
                {r.part} {r.flag ? <ProofPill label={r.flag} /> : null}
              </th>
              <td data-label="Who you trust">{r.trust}</td>
              <td data-label="Can see">{r.sees}</td>
              <td data-label="Cannot">{r.cannot}</td>
              <td data-label="How to check">{r.check}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
