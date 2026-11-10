// WS4-T10 acceptance with a fake chain: step order and evidence, the refund step needs both events, G3 triple equality.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hexToBytes, parseEvents } from "@arrow/sdk";
import { type E2eDeps, runE2e } from "../src/e2e-testnet.ts";
import { repoRoot } from "../src/lib/env.ts";
import { BUYER, type Quirks, SELLER, world } from "./helpers/fakeChain.ts";

let work: string;
beforeEach(() => void (work = mkdtempSync(join(tmpdir(), "arrow-e2e-test-"))));
afterEach(() => rmSync(work, { recursive: true, force: true }));

function setup(q: Quirks = {}, hasAi = true) {
  const w = world(q);
  const stored = new Map<string, { key: Uint8Array; nonce: Uint8Array }>();
  const lines: string[] = [];
  const deps: E2eDeps = {
    ctx: w.ctx, buyerId: BUYER, sellerId: SELLER, hasAi,
    balanceOf: async (id) => w.balances.get(id) ?? 0n,
    mint: async (id, amount) => {
      w.balances.set(id, (w.balances.get(id) ?? 0n) + amount);
      return { txHash: `mint-${id}`, signerId: id, url: `https://testnet.nearblocks.io/txns/mint-${id}` };
    },
    host: async (blob, sha) => {
      const url = `https://host.test/${sha}.bin`;
      w.blobs.set(url, blob);
      return url;
    },
    txEvents: async (hash) => parseEvents(w.txs.get(hash)),
    keys: (sha) => {
      if (!stored.has(sha)) stored.set(sha, { key: hexToBytes(sha), nonce: hexToBytes(sha).subarray(0, 24) });
      return { key: stored.get(sha)!.key, nonce: stored.get(sha)!.nonce };
    },
    repo: repoRoot(),
    workDir: work,
    sleep: async () => {},
    stamp: "20261111T000000Z",
    say: (l) => void lines.push(l),
  };
  const all = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  return { w, deps, lines, run: (steps = all) => runE2e(deps, { steps }) };
}

describe("e2e-testnet steps", () => {
  it("e2e_steps_order_and_evidence", async () => {
    const { w, run, lines } = setup();
    const r = await run();
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[0, "PASS"], [1, "PASS"], [2, "PASS"], [3, "PASS"], [4, "PASS"], [5, "PASS"], [6, "PASS"], [7, "PASS"], [8, "PASS"]]);
    expect(r.exit).toBe(0);
    expect(lines.at(-1)).toBe("E2E testnet: 9/9 steps green");
    const kinds = w.evidence.map((e) => e.kind);
    expect(kinds.filter((k) => k === "list")).toHaveLength(3);
    expect(kinds.filter((k) => k === "eval")).toHaveLength(2);
    expect(kinds.filter((k) => k === "buy")).toHaveLength(1);
    expect(kinds.filter((k) => k === "refund")).toHaveLength(1);
    expect(kinds.filter((k) => k === "spike")).toHaveLength(2); // the two mints
    expect(new Set(w.evidence.map((e) => e.id)).size).toBe(w.evidence.length);
    expect(w.evidence.every((e) => e.id.startsWith("e2e-20261111T000000Z-"))).toBe(true);
    // steps ran in order: the first list evidence precedes the first eval, which precedes the buy
    expect(kinds.indexOf("list")).toBeLessThan(kinds.indexOf("eval"));
    expect(kinds.indexOf("eval")).toBeLessThan(kinds.indexOf("buy"));
    expect(kinds.indexOf("buy")).toBeLessThan(kinds.indexOf("refund"));
  });

  it("L3 shares L2's ciphertext hash but points at a missing host", async () => {
    const { w, run } = setup();
    await run();
    const [l1, l2, l3] = [...w.listings.values()];
    expect(l3.blob_sha256).toBe(l2.blob_sha256);
    expect(l3.blob_url).toMatch(/^https:\/\/blob-host-missing\.invalid\//);
    expect(l1.blob_sha256).not.toBe(l2.blob_sha256);
    expect(l1.title).toContain("[synthetic]");
  });

  it("without the NEAR AI key steps 3 and 4 wait and the rest still runs", async () => {
    const { run } = setup({}, false);
    const r = await run();
    const by = Object.fromEntries(r.results.map((x) => [x.n, x]));
    expect(by[3].status).toBe("SKIP");
    expect(by[3].summary).toContain("H-01a");
    expect(by[4].status).toBe("SKIP");
    expect(by[5].status).toBe("PASS");
    expect(by[6].status).toBe("WARN"); // eval.h leg not exercised
    expect(by[6].summary).toContain("eval.h leg");
    expect(by[7].status).toBe("WARN"); // refund mechanics proven, cause not isolated
    expect(by[7].summary).toContain("not isolated");
    expect(by[8].status).toBe("PASS"); // L1 used 0, L3 used 1, counters match
    expect(by[8].summary).toContain("L1 used 0");
    expect(by[8].summary).toContain("L3 used 1");
    expect(r.exit).toBe(3);
  });

  it("e2e_refund_step_requires_both_events", async () => {
    const onlyArrow = await setup({ omit: "ft_transfer" }).run();
    expect(onlyArrow.results.find((x) => x.n === 7)).toMatchObject({ status: "FAIL" });
    expect(onlyArrow.results.find((x) => x.n === 7)!.summary).toContain("ft_transfer");
    const onlyFt = await setup({ omit: "arrow_refund" }).run();
    expect(onlyFt.results.find((x) => x.n === 7)).toMatchObject({ status: "FAIL" });
    expect(onlyFt.results.find((x) => x.n === 7)!.summary).toContain("arrow_refund");
    expect(onlyFt.exit).toBe(1);
  });

  it("the refund step fails when the buyer balance does not come back", async () => {
    const r = await setup({ keepFee: true }).run();
    const s7 = r.results.find((x) => x.n === 7)!;
    expect(s7.status).toBe("FAIL");
    expect(s7.summary).toContain("balance");
  });

  it("e2e_g3_triple_equality", async () => {
    const r = await setup({ purchaseHash: "0".repeat(64) }).run();
    const s6 = r.results.find((x) => x.n === 6)!;
    expect(s6.status).toBe("FAIL");
    expect(s6.summary).toContain("release.h");
    expect(r.exit).toBe(1);
  });

  it("step 3 fails when the structural PASS scene returns BUY", async () => {
    const r = await setup({ l1Verdict: "BUY" }).run();
    expect(r.results.find((x) => x.n === 3)).toMatchObject({ status: "FAIL" });
  });

  it("step 4 is a WARN, not a failure, when the model does not say BUY", async () => {
    const r = await setup({ l2Verdict: "PASS" }).run();
    const s4 = r.results.find((x) => x.n === 4)!;
    expect(s4.status).toBe("WARN");
    expect(s4.summary).toContain("BUY scene not reproduced");
    expect(r.exit).toBe(0);
  });

  it("--steps limits what runs, and a resumed run counts evals from the listing's own counters", async () => {
    const first = setup();
    await first.run(new Set([0, 1, 2, 3, 4]));
    const ids = [...first.w.listings.keys()] as [number, number, number];
    const r = await runE2e(first.deps, { steps: new Set([5, 6, 7, 8]), listingIds: ids });
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[5, "PASS"], [6, "PASS"], [7, "PASS"], [8, "PASS"]]);
    expect(r.results[3].summary).toContain("L1 used 1");
    expect(r.results[3].summary).toContain("L3 used 1");
  });

  it("--publish-demo lists the two public demo scenes and writes the listings file try-testnet reads", async () => {
    const { deps, w } = setup();
    const out = join(work, "listings.json");
    const r = await runE2e(deps, { steps: new Set([0]), publishDemo: true, listingsOut: out });
    expect(r.results.at(-1)).toMatchObject({ n: 9, status: "PASS" });
    const file = JSON.parse(readFileSync(out, "utf8"));
    expect(file).toMatchObject({ contract: "arrow.arrowhq.testnet", pass_listing_id: 1, buy_listing_id: 2 });
    expect(file.program_wasm_sha256).toMatch(/^[0-9a-f]{64}$/);
    const titles = [...w.listings.values()].map((l) => l.title);
    expect(titles[0]).toContain("[synthetic] Q1 2027 token unlock schedule");
    expect(titles[1]).toContain("[synthetic] NEAR DeFi wallet labels");
  });

  it("a listing that the final state shows a moment late is waited for, not reported as a mismatch", async () => {
    const r = await setup({ listingLag: 2 }).run(new Set([0, 1, 2]));
    expect(r.results.find((x) => x.n === 2)).toMatchObject({ status: "PASS" });
  });
});
