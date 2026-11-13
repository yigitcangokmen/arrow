// NOV-1: the recorded-run page replays one finished run from the evidence file and the chain.
import { describe, expect, it } from "vitest";
import { evidence } from "../generated/data.ts";
import { recordedRun } from "../lib/recorded.ts";

const sha = "ab".repeat(32);
const at = (s: number) => String(BigInt(1_794_000_000 + s) * 1_000_000_000n);
const chain = {
  listing: { id: 14, title: "[synthetic] NEAR DeFi wallet labels (1,000 rows)", blob_sha256: sha } as never,
  eval: { id: 14, status: "done", h: sha, created_at_ns: at(0), settled_at_ns: at(73) } as never,
  purchase: { id: 5, status: "done", h: sha, created_at_ns: at(80), settled_at_ns: at(102) } as never,
};

describe("recordedRun", () => {
  it("takes the transactions and the verdict from the evidence and the times and fingerprints from the chain", () => {
    const r = recordedRun(evidence.testnet, chain);
    expect(r.verdict).toBe("BUY · fit 5/5 · novelty 4/5");
    expect(r.match).toBe(true);
    expect(r.steps.map((s) => s.clock)).toEqual(["earlier", "+0 s", null, "+73 s", "+80 s", "+102 s", null]);
    expect(r.steps.filter((s) => s.txHash).map((s) => s.txHash)).toEqual([
      "3cnPPaFMv6VCwE8QKzo22W33dKxLF9Ce6vprrUw8bvwu",
      "Epn1sL6Kkek1Qx9Nr255mFUG6JHmkd7bRXgW87Ru1xGP",
      "8e3JKNU98uXmwUb5ADpqWjYoAivhhAivWScWs9GNHk4V",
    ]);
    const order = r.steps.map((s) => s.at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("shows no clock it did not read when the chain is not reachable, and claims no match", () => {
    const r = recordedRun(evidence.testnet, null);
    expect(r.steps.map((s) => s.clock)).toEqual(["earlier", null, null, null, null, null, null]);
    expect(r.match).toBe(false);
    expect(r.fingerprints).toBeNull();
  });
});
