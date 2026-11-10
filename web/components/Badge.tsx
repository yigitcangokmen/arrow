import styles from "./Badge.module.css";

export type BadgeKind = "synthetic" | "team-made" | "external" | "unlabelled" | "pre-lock" | "mainnet" | "testnet";

const TEXT: Record<BadgeKind, string> = {
  synthetic: "synthetic",
  "team-made": "team-made",
  external: "external seller",
  unlabelled: "unlabelled",
  "pre-lock": "pre-lock",
  mainnet: "mainnet",
  testnet: "testnet",
};

export function Badge({ kind }: { kind: BadgeKind }) {
  return <span className={`${styles.badge} ${styles[kind === "team-made" ? "team" : kind === "pre-lock" ? "prelock" : kind]}`}>{TEXT[kind]}</span>;
}
