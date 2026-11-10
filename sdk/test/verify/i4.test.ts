// F5: the I4 detail names the external accounts it counts, so a team account missing from the file is visible.
import { describe, expect, it } from "vitest";
import type { VerifyCtx } from "../../src/verify/context.ts";
import { i4 } from "../../src/verify/rows/i4.ts";

const ctxWith = (listings: { id: number; seller: string }[], evals: Record<number, { buyer: string }[]>, team: string[] = []) =>
  ({
    network: "testnet",
    opts: { teamAccounts: { near: team, evm: [] } },
    listings: async () => listings,
    evalsOf: async (id: number) => evals[id] ?? [],
    runs: () => [],
  }) as unknown as VerifyCtx;

describe("I4 external accounts", () => {
  it("prints the external sellers and buyers next to the counts", async () => {
    const judges = ["arrow-judge-45228169.testnet", "arrow-judge-e3a2703c.testnet"];
    const evals = [...judges, ...judges, ...judges, ...judges].map((buyer) => ({ buyer }));
    const r = await i4(ctxWith([{ id: 1, seller: "seller.near" }], { 1: evals }));
    expect(r.detail).toContain("external: 1 listings, 8 evals");
    expect(r.detail).toContain("seller.near");
    for (const j of judges) expect(r.detail).toContain(j);
  });

  it("does not list a team account, whether listed in the file or a subaccount of the root", async () => {
    const r = await i4(
      ctxWith([{ id: 1, seller: "perf.arrowhq.testnet" }], { 1: [{ buyer: "arrow-judge-45228169.testnet" }, { buyer: "e2e-buyer.arrowhq.testnet" }] }, ["arrow-judge-45228169.testnet"]),
    );
    expect(r.detail).toContain("external: 0 listings, 0 evals");
    expect(r.detail).not.toContain("arrow-judge");
    expect(r.detail).not.toContain("e2e-buyer");
  });

  it("caps the printed list", async () => {
    const buyers = Array.from({ length: 9 }, (_, i) => ({ buyer: `b${i}.near` }));
    const r = await i4(ctxWith([{ id: 1, seller: "s.near" }], { 1: buyers }));
    expect(r.detail).toContain("external: 1 listings, 9 evals");
    expect(r.detail).toContain("+4 more");
  });
});

describe("STATE-10: I4 inbound counts only 1Click deposits", () => {
  it("an Intents-internal transfer recorded as inbound is not an inbound swap", async () => {
    const runs = [
      { kind: "inbound", chain: "base", oneclick_deposit: "dep-in", observed: "" },
      { kind: "inbound", chain: "near", oneclick_deposit: null, observed: "transferred 1 USDC buyer -> seller" },
    ];
    const ctx = { network: "mainnet", opts: {}, listings: async () => [], evalsOf: async () => [], runs: (...k: string[]) => runs.filter((r) => k.includes(r.kind)) } as unknown as VerifyCtx;
    expect((await i4(ctx)).detail).toContain("inbound 1/2");
  });
});
