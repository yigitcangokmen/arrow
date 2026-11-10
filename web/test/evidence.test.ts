import { describe, expect, it } from "vitest";
import { EvidenceRun } from "@arrow/sdk/schemas";
import { evidenceJson, webRun } from "../lib/evidence.ts";

describe("webRun", () => {
  it("is a run that evidence-add can complete (id, commit, timestamp and block height are filled by the tool)", () => {
    const run = webRun({ kind: "eval", tx: "ED5VCvV6", chain: "near", listing_id: 3, eval_id: 9, expect: "PASS", observed: "PASS · fit 4 · novelty 1" });
    expect(run.script).toBe("web");
    expect(() => EvidenceRun.parse({ id: "web-001", commit: "-", timestamp_utc: "-", block_height: null, ...run })).not.toThrow();
    expect(run).toMatchObject({ purchase_id: null, oneclick_deposit: null });
  });
  it("prints stable JSON and never carries keys or data", () => {
    const json = evidenceJson({ kind: "outbound", tx: "5xSol", chain: "solana", expect: "x", observed: "y" });
    expect(Object.keys(JSON.parse(json))).toEqual(["kind", "tx", "chain", "listing_id", "eval_id", "purchase_id", "oneclick_deposit", "expect", "observed", "script"]);
    expect(json).not.toMatch(/key|secret|private/i);
  });
});
