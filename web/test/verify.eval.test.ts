// WS5-T07: the per-eval page data. One eval's attestation record and the rows that concern it, from a fake network.
import { describe, expect, it } from "vitest";
import { buildWorld, fakeFetch } from "../../sdk/test/verify/world.ts";
import { isEvalId, loadEval } from "../lib/server/verifyReport.ts";

const inputs = (w = buildWorld("testnet")) => ({ network: "testnet" as const, evidence: w.evidence, fetchImpl: fakeFetch(w), releaseSha256: w.releaseSha256 });

describe("loadEval", () => {
  it("an eval in evidence gets its attestation record and only the rows that concern it", async () => {
    const d = await loadEval(inputs(), 1);
    expect(d.run?.eval_id).toBe(1);
    expect(d.attestation?.requestId).toBe(4001);
    expect(d.attestation?.record.tdx_quote.length).toBeGreaterThan(100);
    expect(d.attestation?.record.transaction_hash).toBe("EVAL1");
    expect(d.onChain).toMatchObject({ id: 1, status: "done" });
    const ids = d.report!.rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["R1", "R2", "I1", "I2", "N1", "N2"]));
    expect(ids).not.toEqual(expect.arrayContaining(["R3"]));
    expect(ids).not.toContain("R8");
    expect(d.report!.rows.find((r) => r.id === "R2")).toMatchObject({ label: "PROVEN", required: true });
  });

  it("only this eval's run is checked: the other eval's tx does not reach the rows", async () => {
    const w = buildWorld("testnet");
    const f = fakeFetch(w);
    const seen: string[] = [];
    const spy = (async (u: any, i: any) => {
      if (i?.body && String(i.body).includes("EVAL2")) seen.push("EVAL2");
      return f(u, i);
    }) as typeof fetch;
    await loadEval({ ...inputs(w), fetchImpl: spy }, 1);
    expect(seen).toEqual([]);
  });

  it("an eval that exists on chain but not in evidence is NOT PROVEN by absence: no rows, no attestation", async () => {
    const d = await loadEval(inputs(), 3);
    expect(d.run).toBeNull();
    expect(d.onChain).toMatchObject({ id: 3, status: "refunded" });
    expect(d.report).toBeNull();
    expect(d.attestation).toBeNull();
  });

  it("an unknown eval id is empty on both sides", async () => {
    const d = await loadEval(inputs(), 99);
    expect(d).toMatchObject({ run: null, onChain: null, report: null, attestation: null });
  });

  it("a missing attestation record is reported with its reason, never turned into a pass", async () => {
    const w = buildWorld("testnet");
    w.attestations = {};
    const d = await loadEval(inputs(w), 1);
    expect(d.attestation).toBeNull();
    expect(d.attestationNote).toMatch(/attestation not stored/);
    expect(d.report!.rows.find((r) => r.id === "R2")).toMatchObject({ label: "NOT PROVEN" });
  });

  it("works without any evidence file", async () => {
    const w = buildWorld("testnet");
    const d = await loadEval({ ...inputs(w), evidence: null }, 1);
    expect(d.run).toBeNull();
    expect(d.report).toBeNull();
    expect(d.onChain).toMatchObject({ id: 1 });
  });
});

describe("isEvalId", () => {
  it("accepts whole numbers only", () => {
    expect(["1", "42", "0007"].every(isEvalId)).toBe(true);
    expect(["", "x", "1.5", "-1", "1e3", "../1", "9".repeat(13)].some(isEvalId)).toBe(false);
  });
});
