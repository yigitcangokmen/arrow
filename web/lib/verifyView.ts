// What /verify shows, derived from the one report the sdk engine produces (the CLI prints the same rows).
// Pure: no fetch, no generated data. The page text never decides a label; it only groups and prints them.
import { formatReport, type Report, type Row } from "@arrow/sdk/verify";

/** The CLI's last line, character for character: `verify: 5/5 REQUIRED PROVEN · exit 0`. */
export const summaryLine = (r: Report): string => formatReport(r).at(-1) ?? "";

export interface SummaryView {
  line: string;
  /** True only when REQUIRED rows exist and every one of them is PROVEN. */
  passed: boolean;
  /** Printed next to the line when it did not pass. NOT PROVEN is never counted as a pass. */
  failure: string | null;
}

export function summaryView(r: Report): SummaryView {
  const missing = r.required.total - r.required.proven;
  const passed = r.exitCode === 0;
  return {
    line: summaryLine(r),
    passed,
    failure: passed ? null : r.required.total === 0 ? "FAIL: no REQUIRED row ran" : `FAIL: ${missing} of ${r.required.total} REQUIRED rows are not PROVEN`,
  };
}

export interface RowGroup {
  key: "required" | "also" | "notproven" | "risky";
  title: string;
  note: string;
  rows: Row[];
}

/**
 * REQUIRED rows first, then the checks that do not count toward the line, the rows that are NOT PROVEN by design (N*)
 * and the known risks. Empty groups are dropped.
 */
export function groupRows(rows: readonly Row[]): RowGroup[] {
  const groups: RowGroup[] = [
    { key: "required", title: "REQUIRED", note: "Every one of these must be PROVEN for the line above to pass.", rows: rows.filter((r) => r.required) },
    { key: "also", title: "Also checked", note: "Counts and cross-checks. They never turn a REQUIRED row green.", rows: rows.filter((r) => !r.required && r.label !== "RISKY" && !r.id.startsWith("N")) },
    { key: "notproven", title: "NOT PROVEN by design", note: "Nothing on this page can prove these. They are listed so nobody has to guess.", rows: rows.filter((r) => !r.required && r.id.startsWith("N")) },
    { key: "risky", title: "RISKY", note: "Known open risks, in the same words as the trust table.", rows: rows.filter((r) => !r.required && r.label === "RISKY") },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** The report as JSON for a <script type="application/json">. `<` is escaped so the text cannot end the script element. */
export const reportJson = (r: Report): string => JSON.stringify(r).replace(/</g, "\\u003c");

/** Only https links from the engine are rendered as links. */
export const safeHref = (url: string): string | null => (/^https:\/\//.test(url) ? url : null);

/** "testnet.nearblocks.io/txns/DahVhG…": the host and the start of the path. */
export function linkText(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname}`;
}

/**
 * One plain sentence per engine row: what the row is about, in words a non-developer can read. It states the claim or the risk,
 * never the result; the label next to it (PROVEN, NOT PROVEN, RISKY) says whether the check passed. The engine's own wording
 * stays underneath, unchanged.
 */
export const PLAIN: Record<string, string> = {
  R1: "The program that ran is the one the contract names and the release publishes.",
  R2: "Each recorded inspection was run by OutLayer's enclave, for a request made through this market's contract.",
  R3: "The file a buyer downloaded is the file that was listed and inspected.",
  R4: "The cross-chain USDC swaps for payment and payout finished.",
  R5: "Each failed run was refunded: the refund event and the money sent back match.",
  R6: "Nobody holds a key that can change the market contract (the lock).",
  R7: "Every listing says whether it was made before or after the lock.",
  R8: "The leak-budget counter adds up for every listing.",
  I1: "The enclave's signed record matches the answer written on chain.",
  I2: "The hardware report covers exactly those signed fields.",
  I3: "The contract code running on chain is the recorded build.",
  I4: "How much the market has been used, compared with our own targets.",
  I5: "The program's secret key is configured for this program and this contract only; no transaction tests the program-hash condition.",
  N1: "NEAR AI's hardware report for its model, as it stands now, not at the time of each inspection.",
  N2: "No contract checks the hardware report on chain; this site checks it in your browser instead.",
  K1: "OutLayer's contract can be upgraded by its owner.",
  K2: "The intents.near contract can be upgraded by its owner.",
  K3: "OutLayer's keystore is run by a DAO, which decides which code can read the keys.",
  K4: "All projects on OutLayer share one master key.",
  K5: "Run time and instruction count are public and can reveal a little about the data.",
  K6: "The time guard trusts the host machine's clock.",
  K7: "A buyer can use up a listing's leak budget with failing inspections.",
  K8: "The inference key is the hackathon's free key; if it runs out, inspections fail and are refunded, less Arrow's 10% share of the fee.",
};

/** Plain group headings, shown under the engine's group name. */
export const GROUP_PLAIN: Record<RowGroup["key"], string> = {
  required: "What must hold.",
  also: "Cross-checks.",
  notproven: "What this page cannot prove.",
  risky: "Known open risks.",
};

/** A row whose check itself failed to run (an RPC hiccup) rather than a check that ran and failed. */
export const couldNotRun = (detail: string): boolean => /^check could not run/i.test(detail);

/** Eval ids of recorded eval runs on this evidence file's own contract, sorted; older markets reuse the same ids. */
export function evalIdsOf(evidence: { contract: string; runs: readonly { kind: string; tx?: string | null; eval_id?: number | string | null; contract?: string }[] } | null): number[] {
  if (!evidence) return [];
  const ids = evidence.runs.filter((r) => r.kind === "eval" && r.tx && r.eval_id !== null && r.eval_id !== undefined && r.contract === evidence.contract).map((r) => Number(r.eval_id));
  return [...new Set(ids)].sort((a, b) => a - b);
}
