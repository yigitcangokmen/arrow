import type { Network } from "../config.ts";
import type { EvidenceFile } from "../schemas.ts";
import type { HashSemantics, OnlyKind } from "./config.ts";

/** Glassbox labels (DEC O-01). Nothing else is ever printed as a label. */
export type Label = "PROVEN" | "NOT PROVEN" | "RISKY";

export interface Row {
  id: string;
  label: Label;
  required: boolean;
  title: string;
  detail: string;
  links: string[];
}

export interface Report {
  rows: Row[];
  required: { proven: number; total: number };
  exitCode: 0 | 1;
  /** Everything below is for printing and the saved --json output. */
  network: Network;
  contract: string;
  generatedAt: string;
  preLock: boolean;
  unlockedReason?: string;
}

/** Team-controlled accounts (evidence/team-accounts.json): only for the "external" counts of row I4. */
export interface TeamAccounts {
  near?: string[];
  evm?: { address: string }[];
}

export interface VerifyOptions {
  network: Network;
  evidence: EvidenceFile;
  /** Contents of release/sha256.txt (64 lowercase hex). Without it R1 is NOT PROVEN. */
  releaseSha256?: string;
  preLock?: boolean;
  /** K6 path: the contract could not be locked. R6 and R7 become RISKY and leave the REQUIRED count. */
  unlockedReason?: string;
  only?: OnlyKind[];
  teamAccounts?: TeamAccounts;
  /** Measured timing-channel bits from the bench, if any (row K5). */
  timingBits?: number;
  /** Overrides evidence.contract (ARROW_CONTRACT_<NET>). */
  contract?: string;
  semantics?: HashSemantics;
  now?: Date;
  fetchImpl?: typeof fetch;
}
