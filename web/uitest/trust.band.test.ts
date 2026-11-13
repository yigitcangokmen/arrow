// HON-2: the trust band says every flagged trust-table row is in one of its plain lines; this keeps that true.
import { describe, expect, it } from "vitest";
import { LIMITS, MORE, WHO } from "../components/TrustBand.tsx";
import { TRUST_ROWS } from "../lib/trust.ts";

describe("HON-2: the trust band in plain words", () => {
  const lines = [...WHO, ...LIMITS, ...MORE];
  it("names every flagged trust-table row in a plain line", () => {
    const named = new Set(lines.flatMap((l) => l.rows));
    const missing = TRUST_ROWS.filter((r) => r.flag && !named.has(r.part)).map((r) => r.part);
    expect(missing).toEqual([]);
  });
  it("points only at rows that exist", () => {
    const parts = new Set(TRUST_ROWS.map((r) => r.part));
    expect(lines.flatMap((l) => l.rows).filter((r) => !parts.has(r))).toEqual([]);
  });
});
