// NOV-1: the recorded-run page replays one finished run from the evidence file and the chain.
import { describe, expect, it } from "vitest";
import { evidence } from "../generated/data.ts";
import { recordedRun } from "../lib/recorded.ts";

// The mainnet run of 14 Nov on arrow-market.near as the chain holds it (get_listing 2, get_eval 2, get_purchase 1).
const sha = "9ab5bfe48c96a896206684c252fb0b0f68867ae909816977640f83d6c815d344";
const chain = {
  listing: { id: 2, title: "[synthetic] NEAR DeFi wallet labels (1,000 rows)", blob_sha256: sha } as never,
  eval: { id: 2, status: "done", h: sha, created_at_ns: "1794655623816358100", settled_at_ns: "1794655675701984500" } as never,
  purchase: { id: 1, status: "done", h: sha, created_at_ns: "1794655814661030100", settled_at_ns: "1794655821691244000" } as never,
};

describe("recordedRun", () => {
  it("takes the transactions and the verdict from the evidence and the times and fingerprints from the chain", () => {
    const r = recordedRun(evidence.mainnet, chain);
    expect(r.verdict).toBe("BUY · fit 5/5 · novelty 4/5");
    expect(r.match).toBe(true);
    expect(r.paidAt?.slice(0, 10)).toBe("2026-11-14");
    expect(r.steps.map((s) => s.clock)).toEqual(["earlier", "+0 s", null, "+52 s", "+191 s", "+198 s", null]);
    expect(r.steps.filter((s) => s.txHash).map((s) => s.txHash)).toEqual([
      "8p7vdybX6v1gY9jZvfL3A4pUNCY4jJGtYtAjZ7nDi6RZ",
      "DuoZg5F6RUSrNMbRSZjS3Q7ABMwda2ZbWZkHrfcwhAfD",
      "Eaj1mPrtdNBWX6p49aDy9M797dsLZ4hyyi51xaKvyAR6",
    ]);
    const order = r.steps.map((s) => s.at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("shows no clock it did not read when the chain is not reachable, and claims no match", () => {
    const r = recordedRun(evidence.mainnet, null);
    expect(r.steps.map((s) => s.clock)).toEqual(["earlier", null, null, null, null, null, null]);
    expect(r.match).toBe(false);
    expect(r.fingerprints).toBeNull();
  });
});
