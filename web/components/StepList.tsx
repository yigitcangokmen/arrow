import styles from "./StepList.module.css";

export type StepState = "todo" | "doing" | "done" | "failed";
export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

const MARK: Record<StepState, string> = { todo: "·", doing: "…", done: "✔", failed: "✘" };
const SPOKEN: Record<StepState, string> = { todo: "not started", doing: "in progress", done: "done", failed: "failed" };

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className={styles.list}>
      {steps.map((s) => (
        <li key={s.label} className={`${styles.item} ${styles[s.state]}`}>
          <span aria-hidden="true" className={styles.mark}>{MARK[s.state]}</span>
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
