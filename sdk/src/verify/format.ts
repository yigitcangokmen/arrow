// Text output of a Report. The last line is fixed (README step 2, the /verify parity grep and the tests expect it).
import type { Report } from "./types.ts";

const TAG_WIDTH = 13; // "[NOT PROVEN] " is the longest tag
const ID_WIDTH = 4;

export const SUMMARY_RE = /^verify: \d+\/\d+ REQUIRED PROVEN · exit [01]$/;

/** `requiredOnly` prints just the REQUIRED rows (the summary line counts only those anyway); the header says so. */
export function formatReport(r: Report, opts: { requiredOnly?: boolean } = {}): string[] {
  const head = `Arrow verify · ${r.network} · ${r.contract} · ${r.generatedAt.slice(0, 16)}Z`;
  const lines = [opts.requiredOnly ? `${head} · REQUIRED rows only (run without --required for every row)` : head];
  for (const row of opts.requiredOnly ? r.rows.filter((x) => x.required) : r.rows) {
    lines.push(`${`[${row.label}]`.padEnd(TAG_WIDTH)}${row.id.padEnd(ID_WIDTH)}${row.title}${row.detail ? `   ${row.detail}` : ""}`);
    for (const link of row.links) lines.push(`${" ".repeat(TAG_WIDTH + ID_WIDTH)}${link}`);
  }
  if (r.preLock) lines.push("PRE-LOCK RUN · R6 pending (H-16)");
  lines.push(`verify: ${r.required.proven}/${r.required.total} REQUIRED PROVEN · exit ${r.exitCode}`);
  return lines;
}
