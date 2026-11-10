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
