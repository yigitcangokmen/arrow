import styles from "./StepList.module.css";

/** "refunded": the contract sent the payment back on its own (a run that failed or would answer late); not an error of the page. */
export type StepState = "todo" | "doing" | "done" | "failed" | "refunded";
export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

const MARK: Record<Exclude<StepState, "todo">, string> = { doing: "…", done: "✔", failed: "✘", refunded: "↺" };
const SPOKEN: Record<StepState, string> = { todo: "not started", doing: "in progress", done: "done", failed: "failed", refunded: "refunded" };

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className={styles.list}>
      {steps.map((s, i) => (
        <li key={s.label} className={`${styles.item} ${styles[s.state]}`}>
          <span aria-hidden="true" className={styles.mark}>{s.state === "todo" ? i + 1 : MARK[s.state]}</span>
          <span>
            {s.label}
            <span className="sr-only"> ({SPOKEN[s.state]})</span>
            {s.detail ? <span className={styles.detail}> {s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
