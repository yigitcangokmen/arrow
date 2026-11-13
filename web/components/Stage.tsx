import styles from "./Stage.module.css";

function Lock() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * The three steps of the product, each with a picture of what it produces. The pictures are examples, the same wallet-labels
 * example as the rest of the page; a live run happens on /try.
 */
export function Stage() {
  return (
    <ol className={styles.stage} aria-label="How it works, in three steps">
      <li className={styles.step}>
        <span className={styles.n}>01</span>
        <h2 className={styles.title}>Lock it.</h2>
        <p>A seller encrypts a file on their own machine and lists it with a price. Buyers see the column names and row count, not the rows.</p>
        <div className={styles.mock} aria-hidden="true">
          <span className={styles.file}><Lock />wallet-labels-1000.csv</span>
          <span className={styles.row}><span>encrypted before upload</span><span className={styles.v}>1,000 rows</span></span>
        </div>
      </li>
      <li className={styles.step}>
        <span className={styles.n}>02</span>
        <h2 className={styles.title}>Check it.</h2>
        <p>You pay a $0.25 inspection fee. Arrow&apos;s program, in sealed hardware, takes a 40-row sample, and an AI in its own sealed hardware judges it against what you need. It can only pick one of 51 fixed answers, never free text.</p>
        <div className={styles.mock} aria-hidden="true">
          <span className={styles.verdict}><span className={styles.buy}>BUY</span> <small>· fit 5 · novelty 4</small></span>
          <span className={styles.row}><span>fit: how well it matches your need</span><span className={styles.v}>1–5</span></span>
          <span className={styles.row}><span>novelty: how much of it is new to you</span><span className={styles.v}>1–5</span></span>
        </div>
      </li>
      <li className={styles.step}>
        <span className={styles.n}>03</span>
        <h2 className={styles.title}>Decide.</h2>
        <p>You get BUY or PASS. Pay the $2 price only if you want the file, then check it is the file the AI saw.</p>
        <div className={styles.mock} aria-hidden="true">
          <span className={styles.row}><span>same file the AI inspected</span><span className={styles.v}>match ✓</span></span>
          <span className={styles.row}><span>decrypted on your machine</span><span className={styles.v}>.csv</span></span>
        </div>
      </li>
    </ol>
  );
}
