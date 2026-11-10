import styles from "./ProofPill.module.css";

export type ProofLabel = "PROVEN" | "NOT PROVEN" | "RISKY";

const CLASS: Record<ProofLabel, string> = { PROVEN: styles.proven, "NOT PROVEN": styles.notproven, RISKY: styles.risky };

/** The state is always written as text; colour only reinforces it. */
export function ProofPill({ label }: { label: ProofLabel }) {
  return <span className={`${styles.pill} ${CLASS[label]}`}>{label}</span>;
}
