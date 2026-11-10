// TS mirror of DEC I-15 (fit_rule structural gates), for PRE-CHECKS ONLY.
// The enclave logic lives in enclave/arrow-core; its Rust tests are the real proof.
import { parseCsv } from "./gen/csv.ts";

export type Criteria = {
  v: 1;
  required_columns?: string[];
  min_rows?: number;
  date_column?: string;
  date_from?: string;
  date_to?: string;
  max_null_rate?: number;
  text: string;
  min_fit?: number;
  min_novelty?: number;
  minhash?: string;
};

export type StructuralReport = {
  fit_rule: number; // 5 minus one per unmet criterion, at least 1
  failures: string[];
};

export function structuralCheck(csv: string, c: Criteria): StructuralReport {
  const { header, rows } = parseCsv(csv);
  const failures: string[] = [];

  const missing = (c.required_columns ?? []).filter((k) => !header.includes(k));
  if (missing.length) failures.push(`required_columns missing: ${missing.join(",")}`);

  if (c.min_rows !== undefined && rows.length < c.min_rows) failures.push(`min_rows ${rows.length} < ${c.min_rows}`);

  if (c.date_column && c.date_from && c.date_to) {
    const col = header.indexOf(c.date_column);
    const dates = col < 0 ? [] : rows.map((r) => r[col] ?? "").filter((d) => d !== "").sort();
    const lo = dates[0];
    const hi = dates[dates.length - 1];
    // Two readings of "date coverage": (A) the data covers the range, (B) every date lies in the range.
    // Both must hold, so the first and last row sit exactly on date_from / date_to.
    const covers = lo !== undefined && hi !== undefined && lo <= c.date_from && hi >= c.date_to;
    const within = lo !== undefined && hi !== undefined && lo >= c.date_from && hi <= c.date_to;
    if (!covers) failures.push(`date coverage (A): ${lo}..${hi} does not cover ${c.date_from}..${c.date_to}`);
    if (!within) failures.push(`date coverage (B): ${lo}..${hi} not within ${c.date_from}..${c.date_to}`);
  }

  if (c.max_null_rate !== undefined && rows.length > 0) {
    const nulls = header.map((_, j) => rows.filter((r) => (r[j] ?? "") === "").length);
    const perColumnMax = Math.max(...nulls) / rows.length; // reading 1: worst column
    const total = nulls.reduce((a, b) => a + b, 0) / (rows.length * header.length); // reading 2: all cells
    if (perColumnMax > c.max_null_rate) failures.push(`null rate per column ${perColumnMax} > ${c.max_null_rate}`);
    if (total > c.max_null_rate) failures.push(`null rate total ${total} > ${c.max_null_rate}`);
  }

  return { fit_rule: Math.max(1, 5 - failures.length), failures };
}
