// WS4-T15 acceptance with a fake chain: spend plan arithmetic, --from-step id reuse, the confirmation gate, preflight rules,
// the testnet dry rehearsal (8 applicable steps) and a full mainnet-shaped pass with stubbed 1Click legs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes, NETWORKS, parseEvents } from "@arrow/sdk";
import type { Ctx } from "../../agent/src/commands.ts";
import { confirmSpend, EXIT_NEEDS_CONFIRM } from "../src/lib/confirm.ts";
import { repoRoot } from "../src/lib/env.ts";
import { AMOUNTS, configProblems, findRefundEvents, main, type MainnetDeps, type MainnetOpts, nextAfterStop, repoBlobHost, rerunBase, resumeFrom, runE2eMainnet, sellerShare, spendPlan, successValue, withdrawPayload } from "../src/e2e-mainnet.ts";
import { BUYER, SELLER, world } from "./helpers/fakeChain.ts";
import { fixture } from "../../agent/test/helpers.ts";

let work: string;
beforeEach(() => void (work = mkdtempSync(join(tmpdir(), "arrow-e2e-main-test-"))));
afterEach(() => rmSync(work, { recursive: true, force: true }));

const SHA = "ab".repeat(32);
const ALL = new Set([...Array(11).keys()]);
const BASE_PLAN = { bond: 100_000n, inboundOut: 4_998_000n, feeBpsEval: 1000, feeBpsSale: 200, buyerNow: 1_999_596n, sellerNow: 0n };

describe("spend plan", () => {
  it("spend_plan_totals", () => {
    const p = spendPlan({ ...BASE_PLAN, steps: ALL });
    // buyer: +4.998 inbound -0.5 funding -2 x 0.25 evals -2.00 buy; the refunded L3 eval costs the 10 % treasury share
    expect(p.buyerAfter).toBe(1_999_596n + 4_998_000n - 500_000n - 500_000n - 2_000_000n - 25_000n);
    // seller: +0.5 funding -0.3 bonds +90% of 2 evals +98% of the price -1.00 outbound
    expect(p.sellerAfter).toBe(500_000n - 300_000n + 450_000n + 1_960_000n - 1_000_000n);
    expect(p.shortfalls).toEqual([]);
    expect(p.spendsValue).toBe(true);
    const text = p.lines.join("\n");
    expect(text).toContain("after this run, buyer Intents will hold ≈3.972596 USDC, seller ≈1.61 USDC");
    expect(text).not.toContain("H-15");
    expect(text).toContain("step 8  eval L3: 0.25 USDC from the buyer, 0.225 refunded to the buyer's NEAR Intents balance (not to Base); a failed eval keeps the 10% treasury share");
    expect(text).toContain("total leaving Base: 5 USDC + gas");
    expect(text).toContain("3 x 0.1 USDC listing bond");
  });

  it("NUM-7: the seller gets what the contract leaves after rounding the treasury share down", () => {
    expect(sellerShare(50_001n, 1000)).toBe(45_001n);
    expect(sellerShare(2_000_000n, 200)).toBe(1_960_000n);
    expect(sellerShare(250_000n, 1000)).toBe(225_000n);
  });

  it("QA-09: the plan shows the worst case of the automatic eval retries (2 + 4 + 2 evals), only for the selected steps", () => {
    const p = spendPlan({ ...BASE_PLAN, steps: ALL });
    expect(p.worstEvalFees).toBe(2_000_000n);
    expect(p.lines.join("\n")).toContain("worst case with the automatic retries: 8 evals = 2 USDC in eval fees from the buyer");
    expect(spendPlan({ ...BASE_PLAN, steps: new Set([6, 7, 8, 9, 10]) }).worstEvalFees).toBe(500_000n);
    expect(spendPlan({ ...BASE_PLAN, steps: new Set([6]) }).lines.join("\n")).not.toContain("worst case");
  });

  it("the plan covers only the selected steps and flags a balance that would go negative", () => {
    const p = spendPlan({ ...BASE_PLAN, steps: new Set([6]), buyerNow: 1_000_000n });
    expect(p.lines.join("\n")).toContain("step 6  buy L2");
    expect(p.lines.join("\n")).not.toContain("step 1");
    expect(p.shortfalls).toEqual(["buyer Intents balance would be -1 after step 6"]);
    const none = spendPlan({ ...BASE_PLAN, steps: new Set([7, 10]) });
    expect(none.spendsValue).toBe(false);
  });
});

describe("preflight rules", () => {
  const version = { ...fixture("version"), build: "mainnet" };
  const mainnetCfg = (hash: string) => {
    const c = fixture("config");
    return { ...c, build: "mainnet", config: { ...c.config, outlayer: "outlayer.near", intents: "intents.near", usdc_token_id: NETWORKS.mainnet.usdcToken, program_wasm_hash: hash } };
  };
  const pk = "04" + "11".repeat(64);

  it("preflight_fails_on_wasm_hash_mismatch", () => {
    const r = configProblems({ network: "mainnet", version, cfg: mainnetCfg("cd".repeat(32)), pk, release: { sha: SHA, source: "release/sha256.txt", frozen: true } });
    expect(r.problems).toEqual([expect.stringContaining("program_wasm_hash cdcdcdcdcdcd… != release/sha256.txt abababababab…")]);
    const ok = configProblems({ network: "mainnet", version, cfg: mainnetCfg(SHA), pk, release: { sha: SHA, source: "release/sha256.txt", frozen: true } });
    expect(ok).toEqual({ problems: [], warnings: [] });
  });

  it("a missing release/sha256.txt blocks mainnet and only warns on testnet; a candidate mismatch only warns", () => {
    expect(configProblems({ network: "mainnet", version, cfg: mainnetCfg(SHA), pk, release: null }).problems[0]).toContain("release/sha256.txt is missing");
    const t = fixture("config");
    const tv = fixture("version");
    expect(configProblems({ network: "testnet", version: tv, cfg: t, pk, release: null }).problems).toEqual([]);
    const cand = configProblems({ network: "testnet", version: tv, cfg: t, pk, release: { sha: "cd".repeat(32), source: "release/arrow-tee-rc.sha256", frozen: false } });
    expect(cand.problems).toEqual([]);
    expect(cand.warnings[0]).toContain("not frozen");
  });

  it("wrong chain, wrong token and a paused contract are blockers", () => {
    const bad = { ...mainnetCfg(SHA), paused: true, config: { ...mainnetCfg(SHA).config, intents: "evil.near", usdc_token_id: "nep141:other" } };
    const r = configProblems({ network: "mainnet", version: fixture("version"), cfg: bad, pk: null, release: { sha: SHA, source: "release/sha256.txt", frozen: true } });
    expect(r.problems.join("\n")).toMatch(/build is testnet, not mainnet[\s\S]*paused[\s\S]*intents is evil\.near[\s\S]*usdc_token_id[\s\S]*program_pubkey/);
  });
});

describe("resume", () => {
  const row = (id: string, kind: any, listing: number | null, purchase: number | null = null) => ({ id, kind, listing_id: listing, eval_id: null, purchase_id: purchase });
  it("from_step_reuses_ids", () => {
    const runs = [
      row("e2e-mainnet-20261112T140000Z-list-L1-3", "list", 3),
      row("e2e-mainnet-20261112T140000Z-list-L2-4", "list", 4),
      row("e2e-mainnet-20261112T140000Z-list-L3-5", "list", 5),
      row("e2e-mainnet-20261112T140000Z-eval-mainnet-8", "eval", 3),
      row("e2e-mainnet-20261112T140000Z-buy-mainnet-2", "buy", 4, 2),
      row("e2e-mainnet-20261112T130000Z-list-L1-1", "list", 1), // an older, partial run
      row("spike-s3b", "spike", null),
    ];
    expect(resumeFrom(runs)).toEqual({ stamp: "20261112T140000Z", ids: { L1: 3, L2: 4, L3: 5 }, evalDone: { L1: true, L2: false }, purchaseId: 2 });
    expect(resumeFrom(runs.slice(5))).toBeNull();
    expect(resumeFrom([])).toBeNull();
  });
});

describe("refund events", () => {
  it("accepts the mainnet shape: NEP-245 mt_transfer from the market back to the buyer", () => {
    const events = parseEvents({
      transaction_outcome: { id: "t", outcome: { executor_id: "x", logs: [] } },
      receipts_outcome: [
        { id: "a", outcome: { executor_id: "arrow-market.near", logs: [`EVENT_JSON:${JSON.stringify({ standard: "arrow", version: "1.0.0", event: "arrow_refund", data: { kind: "eval", id: 9, amount: "250000" } })}`] } },
        { id: "b", outcome: { executor_id: "intents.near", logs: [`EVENT_JSON:${JSON.stringify({ standard: "nep245", version: "1.0.0", event: "mt_transfer", data: [{ old_owner_id: "arrow-market.near", new_owner_id: "0xbuyer", token_ids: [NETWORKS.mainnet.usdcToken], amounts: ["250000"], memo: "refund" }] })}`] } },
      ],
    });
    const found = findRefundEvents(events, { network: "mainnet", contract: "arrow-market.near", buyerId: "0xbuyer", evalId: 9 });
    expect(found.refund).toBeTruthy();
    expect(found.amount).toBe("250000");
    expect(found.token).toBe(NETWORKS.mainnet.usdcToken);
    expect(findRefundEvents(events, { network: "mainnet", contract: "arrow-market-v2.near", buyerId: "0xbuyer", evalId: 9 }).transfer).toBeUndefined();
    expect(findRefundEvents(events, { network: "mainnet", contract: "arrow-market.near", buyerId: "0xother", evalId: 9 }).transfer).toBeUndefined();
  });
});

// ------------------------------------------------------------------ the step machine on a fake chain

function setup(o: { mainnet?: boolean; release?: MainnetDeps["release"]; confirm?: MainnetDeps["confirm"] } = {}) {
  const w = world();
  w.balances.set(BUYER, 10_000_000n);
  w.balances.set(SELLER, 5_000_000n);
  const stored = new Map<string, { key: Uint8Array; nonce: Uint8Array }>();
  const lines: string[] = [];
  const calls = { inbound: 0, outbound: 0, confirm: 0, pay: 0 };
  let ctx: Ctx = w.ctx;
  if (o.mainnet) {
    const mainnetCfg = { ...fixture("config"), build: "mainnet", tank_available: "7000000000000000000000000", config: { ...fixture("config").config, outlayer: "outlayer.near", intents: "intents.near", usdc_token_id: NETWORKS.mainnet.usdcToken } };
    ctx = {
      ...w.ctx,
      network: "mainnet",
      views: { ...w.ctx.views, config: async () => mainnetCfg, version: async () => ({ ...fixture("version"), build: "mainnet" }) },
      actor: (role) => ({ ...w.ctx.actor(role), network: "mainnet", evm: {} as any }),
      transport: {
        pay: async (a) => (calls.pay++, w.ctx.transport.pay(a)),
        transfer: async ({ actor, toId, amount }) => {
          w.balances.set(actor.id, (w.balances.get(actor.id) ?? 0n) - amount);
          w.balances.set(toId, (w.balances.get(toId) ?? 0n) + amount);
          return { txHash: "fundtx", signerId: "arrow-relayer.arrowhq.near", url: "https://nearblocks.io/txns/fundtx" };
        },
      },
    };
  } else {
    ctx = { ...w.ctx, transport: { ...w.ctx.transport, pay: async (a) => (calls.pay++, w.ctx.transport.pay(a)) } };
  }
  const toNep245 = (hash: string) =>
    parseEvents(w.txs.get(hash)).map((e) =>
      e.standard === "nep141" && e.event === "ft_transfer"
        ? { ...e, standard: "nep245", event: "mt_transfer", executorId: NETWORKS.mainnet.intents!, data: e.data.map((d: any) => ({ old_owner_id: d.old_owner_id, new_owner_id: d.new_owner_id, token_ids: [NETWORKS.mainnet.usdcToken], amounts: [d.amount], memo: d.memo })) }
        : e,
    );
  const deps: MainnetDeps = {
    ctx, dry: !o.mainnet, buyerId: BUYER, sellerId: SELLER, contract: NETWORKS.testnet.contract,
    release: o.release === undefined ? { sha: SHA, source: "release/sha256.txt", frozen: true } : o.release,
    balanceOf: async (id) => w.balances.get(id) ?? 0n,
    host: async (blob, sha) => {
      const url = `https://host.test/${sha}.bin`;
      w.blobs.set(url, blob);
      return url;
    },
    keys: (sha) => {
      if (!stored.has(sha)) stored.set(sha, { key: hexToBytes(sha), nonce: hexToBytes(sha).subarray(0, 24) });
      return stored.get(sha)!;
    },
    txEvents: async (hash) => (o.mainnet ? toNep245(hash) : parseEvents(w.txs.get(hash))),
    evidenceRuns: () => w.evidence,
    confirm: o.confirm ?? (async () => void calls.confirm++),
    repo: repoRoot(), workDir: work, sleep: async () => {}, stamp: "20261112T140000Z", say: (l) => void lines.push(l),
  };
  if (o.mainnet) {
    deps.base = { usdc: async () => 6_000_000n, eth: async () => 10n ** 16n };
    deps.inboundQuote = async () => 4_998_000n;
    deps.outboundQuote = async () => 990_000n;
    deps.inbound = async () => {
      calls.inbound++;
      const before = w.balances.get(BUYER) ?? 0n;
      w.balances.set(BUYER, before + 4_998_000n);
      return { status: "SUCCESS", baseTx: "0xbase", deposit: "0xdeposit", seconds: 35, block: 123, before, after: before + 4_998_000n, attempts: 1 };
    };
    deps.outbound = async (units) => {
      calls.outbound++;
      w.balances.set(SELLER, (w.balances.get(SELLER) ?? 0n) - units);
      return { status: "SUCCESS", deposit: "0xdeposit2", solTx: "5solsig", route: "generate-intent", nearTx: null };
    };
  }
  const run = (opts: Partial<MainnetOpts> = {}) => runE2eMainnet(deps, { from: 0, ...opts });
  return { w, deps, lines, calls, run };
}

describe("e2e-mainnet step machine", () => {
  it("dry on testnet: 8 applicable steps green, the mainnet-only steps are skipped", async () => {
    const { run, lines, calls, w } = setup();
    const r = await run();
    expect(r.exit).toBe(0);
    expect(r.results.map((x) => [x.n, x.status, !!x.na])).toEqual([
      [0, "PASS", false], [1, "SKIP", true], [2, "SKIP", true], [3, "PASS", false], [4, "PASS", false], [5, "PASS", false],
      [6, "PASS", false], [7, "PASS", false], [8, "PASS", false], [9, "SKIP", true], [10, "PASS", false],
    ]);
    expect(r.results.find((x) => x.n === 1)!.summary).toBe("mainnet-only: skipped in dry");
    expect(lines.at(-1)).toBe("E2E mainnet (dry on testnet): 8/8 applicable steps green");
    expect(calls.confirm).toBe(0);
    // evidence ids carry the dry prefix and the BUY run is tagged as the e2e demo purchase
    expect(w.evidence.every((e) => e.id.startsWith("e2e-dry-20261112T140000Z-"))).toBe(true);
    expect(w.evidence.find((e) => e.kind === "buy").observed).toContain('demo:"e2e"');
  });

  it("mainnet shape: 11/11 green, the plan is printed and confirmed once before anything is sent", async () => {
    const { run, lines, calls, w } = setup({ mainnet: true });
    const r = await run();
    expect(r.exit).toBe(0);
    expect(r.results.map((x) => x.status)).toEqual(Array(11).fill("PASS"));
    expect(lines.at(-2)).toBe("E2E mainnet: 11/11 green");
    expect(lines.at(-1)).toContain("npm run verify -- --network mainnet --only e2e --pre-lock");
    expect(calls).toMatchObject({ inbound: 1, outbound: 1, confirm: 1 });
    const planAt = lines.indexOf("spend plan:");
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(lines.findIndex((l) => l.startsWith("[PASS] step 1")));
    const kinds = w.evidence.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["inbound", "list", "eval", "buy", "refund", "outbound"]));
    expect(w.evidence.every((e) => e.id.startsWith("e2e-mainnet-20261112T140000Z-"))).toBe(true);
    const out = w.evidence.find((e) => e.kind === "outbound");
    expect(out).toMatchObject({ chain: "solana", tx: "5solsig", oneclick_deposit: "0xdeposit2" });
    expect(w.evidence.find((e) => e.kind === "inbound" && e.chain === "base")).toMatchObject({ tx: "0xbase", oneclick_deposit: "0xdeposit" });
    expect(lines.find((l) => l.startsWith("[PASS] step 9"))).toContain("https://solscan.io/tx/5solsig");
  });

  it("refuses_without_tty_or_yes: a declined confirmation sends nothing", async () => {
    const decline = vi.fn(async () => {
      throw new Error("exit 5");
    });
    const { run, calls, w } = setup({ mainnet: true, confirm: decline });
    const r = await run();
    // in the real script confirmSpend exits 5 itself; any throw from the gate stops the run the same way
    expect(r.exit).toBe(1);
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[0, "PASS"], [0, "FAIL"]]);
    expect(r.results[1].summary).toBe("exit 5");
    expect(decline).toHaveBeenCalledOnce();
    expect(calls).toMatchObject({ inbound: 0, outbound: 0, pay: 0 });
    expect(w.evidence).toEqual([]);
  });

  it("refuses_without_tty_or_yes: confirmSpend exits 5 on a non-terminal without --yes", async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(confirmSpend(["pay 1 USDC"], false)).rejects.toThrow(`exit ${EXIT_NEEDS_CONFIRM}`);
      await expect(confirmSpend(["pay 1 USDC"], true)).resolves.toBeUndefined();
    } finally {
      exit.mockRestore();
      err.mockRestore();
      out.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    }
  });

  it("--dry-plan runs the preflight and prints the plan but sends nothing and never asks", async () => {
    const { run, lines, calls, w } = setup({ mainnet: true });
    const r = await run({ dryPlan: true });
    expect(r.exit).toBe(0);
    expect(r.results.map((x) => x.n)).toEqual([0]);
    expect(lines).toContain("spend plan:");
    expect(lines.at(-1)).toContain("dry-plan: preflight green · spend plan printed · nothing sent");
    expect(calls).toMatchObject({ inbound: 0, outbound: 0, confirm: 0, pay: 0 });
    expect(w.evidence).toEqual([]);
  });

  it("a wasm hash mismatch stops the run at the preflight, before any payment", async () => {
    const { run, calls, lines } = setup({ mainnet: true, release: { sha: "cd".repeat(32), source: "release/sha256.txt", frozen: true } });
    const r = await run();
    expect(r.exit).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ n: 0, status: "FAIL" });
    expect(r.results[0].summary).toContain("program_wasm_hash");
    expect(calls).toMatchObject({ inbound: 0, pay: 0, confirm: 0 });
    expect(lines.some((l) => l.includes("--from-step"))).toBe(true);
  });

  it("from_step_reuses_ids: --from-step 4 takes the listings of the earlier run and lists nothing new", async () => {
    const first = setup({ mainnet: true });
    await first.run({ only: 3 });
    const ids = [...first.w.listings.keys()];
    expect(ids).toHaveLength(3);
    const listPays = first.calls.pay;
    const r = await first.run({ from: 4 });
    expect(r.listingIds).toEqual({ L1: ids[0], L2: ids[1], L3: ids[2] });
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[4, "PASS"], [5, "PASS"], [6, "PASS"], [7, "PASS"], [8, "PASS"], [9, "PASS"], [10, "PASS"]]);
    expect(first.w.listings.size).toBe(3);
    // 2 evals + buy + broken-host eval = 4 payments after the 3 bonds
    expect(first.calls.pay - listPays).toBe(4);
  });

  it("STATE-9: --from-step 4 after a complete run pays for nothing again, --only N still can", async () => {
    const t = setup({ mainnet: true });
    expect((await t.run()).exit).toBe(0);
    const paidBefore = t.calls.pay;
    expect(paidBefore).toBe(7); // 3 bonds, 2 evals, the buy, the broken-host eval
    expect(t.calls.outbound).toBe(1);

    const r = await t.run({ from: 4 });
    expect(r.exit).toBe(0);
    expect(t.calls.pay).toBe(paidBefore);
    expect(t.calls.outbound).toBe(1);
    const skipped = r.results.filter((x) => x.status === "SKIP");
    expect(skipped.map((x) => x.n)).toEqual([4, 5, 6, 8, 9]);
    expect(skipped.every((x) => x.na && x.summary.includes("already paid in the run 20261112T140000Z"))).toBe(true);
    expect(r.results.filter((x) => x.status === "PASS").map((x) => x.n)).toEqual([7, 10]);
    // the spend plan approved for the rerun lists none of the paid steps
    expect(r.plan?.lines.join("\n")).not.toMatch(/step (4|5|6|8|9) /);
    expect(r.plan?.spendsValue).toBe(false);

    await t.run({ from: 4, only: 4 });
    expect(t.calls.pay).toBe(paidBefore + 1);
  });

  it("--from-step 6 --only 7 decrypts the purchase an earlier run made without paying again", async () => {
    const first = setup({ mainnet: true });
    await first.run({ from: 0, only: undefined, skipOutbound: true });
    const payBefore = first.calls.pay;
    const r = await first.run({ from: 7, only: 7 });
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[7, "PASS"]]);
    expect(first.calls.pay).toBe(payBefore);
  });

  it("--skip-inbound and --skip-outbound leave those steps skipped (exit 3)", async () => {
    const { run, calls } = setup({ mainnet: true });
    const r = await run({ skipInbound: true, skipOutbound: true });
    expect(r.results.find((x) => x.n === 1)).toMatchObject({ status: "SKIP", summary: "skipped by --skip-inbound" });
    expect(r.results.find((x) => x.n === 9)).toMatchObject({ status: "SKIP", summary: "skipped by --skip-outbound" });
    expect(r.exit).toBe(3);
    expect(calls).toMatchObject({ inbound: 0, outbound: 0 });
  });

  it("a mainnet run whose buyer cannot cover the plan stops at the preflight", async () => {
    const { run, calls, w } = setup({ mainnet: true });
    w.balances.set(BUYER, 0n);
    const r = await run({ from: 3 }); // no inbound, and the fake buyer holds 0
    expect(r.exit).toBe(1);
    expect(r.results[0].summary).toContain("buyer Intents balance would be");
    expect(calls.pay).toBe(0);
  });

  it("AMOUNTS match the card: 5.00 inbound, 0.50 funding, 0.25 eval fee, 2.00 price, 1.00 outbound", () => {
    expect(AMOUNTS).toEqual({ inbound: 5_000_000n, fund: 500_000n, price: 2_000_000n, evalFee: 250_000n, outbound: 1_000_000n });
  });
});

// ------------------------------------------------------------------ --mock-intents: the mainnet wasm rehearsed on testnet

describe("mock-intents rehearsal (mainnet wasm on testnet)", () => {
  const MOCK = "intents-rh.arrowhq.testnet";
  const mockCfg = { ...fixture("config"), build: "mainnet", config: { ...fixture("config").config, outlayer: "outlayer.testnet", intents: MOCK, usdc_token_id: NETWORKS.mainnet.usdcToken } };
  const pk = "04" + "11".repeat(64);
  const mainnetVersion = { ...fixture("version"), build: "mainnet" };

  it("expects the mainnet build and the mock as intents; the plain testnet rules stay as they were", () => {
    const ok = configProblems({ network: "testnet", version: mainnetVersion, cfg: mockCfg, pk, release: { sha: mockCfg.config.program_wasm_hash, source: "release/sha256.txt", frozen: true }, mockIntents: MOCK });
    expect(ok.problems).toEqual([]);
    const other = configProblems({ network: "testnet", version: mainnetVersion, cfg: mockCfg, pk, release: null, mockIntents: "evil.testnet" });
    expect(other.problems).toEqual([`intents is ${MOCK}, expected the mock evil.testnet`]);
    // without the flag a mainnet build on testnet is still a blocker
    expect(configProblems({ network: "testnet", version: mainnetVersion, cfg: mockCfg, pk, release: null }).problems).toEqual(["build is mainnet, not testnet"]);
    expect(configProblems({ network: "testnet", version: fixture("version"), cfg: mockCfg, pk, release: null, mockIntents: MOCK }).problems).toEqual(["build is testnet, not mainnet"]);
  });

  it("step 8 passes on arrow_refund + the unused amount handed back to intents, and fails when the market returns another amount", async () => {
    for (const [returned, status] of [[["225000"], "PASS"], [["250000"], "FAIL"]] as const) {
      const { deps, run } = setup();
      deps.mockIntents = MOCK;
      const views = deps.ctx.views;
      deps.ctx = { ...deps.ctx, views: { ...views, version: async () => mainnetVersion, config: async () => { const c = await views.config(); return { ...c, build: "mainnet", config: { ...c.config, intents: MOCK } }; } } };
      deps.txReturn = async () => returned;
      const r = await run();
      const s8 = r.results.find((x) => x.n === 8)!;
      expect(s8.status).toBe(status);
      if (status === "PASS") {
        expect(s8.summary).toContain('mt_on_transfer returned ["225000"]');
        expect(r.exit).toBe(0);
      } else expect(s8.summary).toContain('mt_on_transfer returned ["250000"] to intents, expected ["225000"]');
    }
  });

  it("successValue decodes the final return value and is undefined while the tx has none", () => {
    expect(successValue({ status: { SuccessValue: Buffer.from(JSON.stringify(["225000"])).toString("base64") } })).toEqual(["225000"]);
    expect(successValue({ status: { SuccessValue: "" } })).toBeUndefined();
    expect(successValue({ status: "Started" })).toBeUndefined();
  });

  it("--mock-intents is refused outside a testnet --dry run and without --blob-base", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--network", "mainnet", "--mock-intents", MOCK])).toBe(2);
      expect(await main(["--network", "testnet", "--dry-plan", "--mock-intents", MOCK, "--blob-base", "https://x.test"])).toBe(2);
      expect(await main(["--network", "testnet", "--dry", "--mock-intents", MOCK])).toBe(2);
    } finally {
      err.mockRestore();
    }
  });
});

// ------------------------------------------------------------------ readiness fixes (docs/internal/readiness, 13 Nov)

describe("a failed paid step stops the run (QA-02, QA-16, RH-01)", () => {
  it("QA-02: step 1 REFUNDED twice stops before the seller funding, the listings and the evals; the next command checks 1Click first", async () => {
    const t = setup({ mainnet: true });
    t.deps.command = "npx tsx scripts/src/e2e-mainnet.ts --network mainnet --relay direct --blob-base https://b.test/blobs";
    t.deps.inbound = async () => ({ status: "REFUNDED", baseTx: "0xbase", deposit: "0xdep", seconds: 40, block: 1, before: 0n, after: 0n, attempts: 2 });
    const r = await t.run();
    expect(r.exit).toBe(1);
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[0, "PASS"], [1, "FAIL"]]);
    expect(t.calls.pay).toBe(0);
    expect(t.w.listings.size).toBe(0);
    const text = t.lines.join("\n");
    expect(text).toContain("stopped after the failed step 1: no later step was paid");
    expect(text).toContain("https://1click.chaindefuser.com/v0/status?depositAddress=");
    expect(text).toContain("REFUNDED or FAILED (the USDC went back to Base): npx tsx scripts/src/e2e-mainnet.ts --network mainnet --relay direct --blob-base https://b.test/blobs --from-step 1");
    expect(text).toContain("SUCCESS (it arrived late): npx tsx scripts/src/e2e-mainnet.ts --network mainnet --relay direct --blob-base https://b.test/blobs --from-step 2");
  });

  it("QA-02: a failed eval at step 4 stops the run before step 5 pays (it used to go on and pay steps 5, 6 and 8)", async () => {
    // L1 must come out PASS; the BUY quirk makes step 4 FAIL after its eval was paid
    const q = setup({ mainnet: true });
    const quirk = world({ l1Verdict: "BUY" });
    quirk.balances.set(BUYER, 10_000_000n);
    quirk.balances.set(SELLER, 5_000_000n);
    let pays = 0;
    q.deps.ctx = {
      ...q.deps.ctx,
      views: { ...quirk.ctx.views, config: q.deps.ctx.views.config, version: q.deps.ctx.views.version },
      transport: {
        pay: async (a) => (pays++, quirk.ctx.transport.pay(a)),
        transfer: async ({ actor, toId, amount }) => {
          quirk.balances.set(actor.id, (quirk.balances.get(actor.id) ?? 0n) - amount);
          quirk.balances.set(toId, (quirk.balances.get(toId) ?? 0n) + amount);
          return { txHash: "fundtx", signerId: "arrow-relayer.arrowhq.near", url: "https://nearblocks.io/txns/fundtx" };
        },
      },
      evidence: quirk.ctx.evidence,
      wait: quirk.ctx.wait,
    };
    q.deps.balanceOf = async (id) => quirk.balances.get(id) ?? 0n;
    q.deps.host = async (blob, sha) => {
      const url = `https://host.test/${sha}.bin`;
      quirk.blobs.set(url, blob);
      return url;
    };
    q.deps.txEvents = async () => [];
    const r = await q.run();
    expect(r.results.map((x) => [x.n, x.status])).toEqual([[0, "PASS"], [1, "PASS"], [2, "PASS"], [3, "PASS"], [4, "FAIL"]]);
    expect(pays).toBe(4); // 3 bonds + the step 4 eval, nothing after it
    const text = q.lines.join("\n");
    expect(text).toContain("stopped after the failed step 4");
    expect(text).toMatch(/next: wait until qprobe shows every job started ≤ 30 s after its block, then npx tsx scripts\/src\/e2e-mainnet\.ts --network mainnet --from-step 4/);
  });

  it("QA-16: a step that throws after its payment says the money moved and names the --from-step that skips it", async () => {
    const t = setup({ mainnet: true });
    const views = t.deps.ctx.views;
    // every read of the paid eval fails (an RPC 429 spell) until the settle timeout
    t.deps.ctx = { ...t.deps.ctx, wait: { ...t.deps.ctx.wait, timeoutMs: 0 }, views: { ...views, eval: async () => { throw new Error("https://rpc.mainnet.near.org: HTTP 429"); } } };
    const r = await t.run();
    expect(r.results.at(-1)).toMatchObject({ n: 4, status: "FAIL" });
    expect(t.calls.pay).toBe(4);
    const text = t.lines.join("\n");
    expect(text).toMatch(/step 4 sent https:\/\/testnet\.nearblocks\.io\/txns\/tx\d+ and then lost track of it: that money moved\. Never rerun step 4 blind\./);
    expect(text).toContain(`npm run arrow -- status --network mainnet --listing ${r.listingIds.L1}`);
    expect(text).toContain("that eval done or refunded: npx tsx scripts/src/e2e-mainnet.ts --network mainnet --from-step 5");
    expect(text).not.toContain("--from-step 4 (evals already recorded");
  });

  it("failures after step 6 do not stop the run: step 8, 9 and 10 still run their checks", async () => {
    const t = setup({ mainnet: true });
    t.deps.outbound = async () => ({ status: "FAILED", deposit: "0xd", solTx: null, route: "generate-intent", nearTx: null });
    const r = await t.run();
    expect(r.results.find((x) => x.n === 9)!.status).toBe("FAIL");
    expect(r.results.find((x) => x.n === 10)!.status).toBe("PASS");
    expect(t.lines.join("\n")).not.toContain("stopped after");
  });

  it("RH-01: --to-step 5 stops before the buy and prints the queue probe and the --from-step 6 command; the resume pays only steps 6 and 8", async () => {
    const t = setup({ mainnet: true });
    t.deps.command = "npx tsx scripts/src/e2e-mainnet.ts --network mainnet";
    const a = await t.run({ to: 5 });
    expect(a.exit).toBe(0);
    expect(a.results.map((x) => x.n)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.lines.at(-1)).toBe("next: run the OutLayer queue probe (qprobe); when every job started ≤ 10 s after its block: npx tsx scripts/src/e2e-mainnet.ts --network mainnet --from-step 6");
    expect(a.plan?.lines.join("\n")).not.toMatch(/step (6|8|9) /);
    const before = t.calls.pay;
    const b = await t.run({ from: 6 });
    expect(b.exit).toBe(0);
    expect(b.results.map((x) => [x.n, x.status])).toEqual([[6, "PASS"], [7, "PASS"], [8, "PASS"], [9, "PASS"], [10, "PASS"]]);
    expect(t.calls.pay - before).toBe(2); // the buy and the broken-host eval
  });

  it("rerunBase drops --from-step, --only and the approval flags, and keeps --to-step so a retry in part 14a still stops before the buy", () => {
    expect(rerunBase(["--network", "mainnet", "--relay", "direct", "--from-step", "4", "--yes", "--to-step", "5", "--only=6", "--blob-base", "https://b.test/blobs"]))
      .toBe("npx tsx scripts/src/e2e-mainnet.ts --network mainnet --relay direct --to-step 5 --blob-base https://b.test/blobs");
  });

  it("part 14a: a failed eval prints a retry that keeps --to-step 5; a green 14a prints --from-step 6 without it", async () => {
    const t = setup({ mainnet: true });
    t.deps.command = "npx tsx scripts/src/e2e-mainnet.ts --network mainnet --to-step 5";
    expect((await t.run({ to: 5 })).exit).toBe(0);
    expect(t.lines.at(-1)).toContain("qprobe); when every job started ≤ 10 s after its block: npx tsx scripts/src/e2e-mainnet.ts --network mainnet --from-step 6");
    expect(nextAfterStop(4, { command: t.deps.command, network: "mainnet" }).join("\n")).toContain("--network mainnet --to-step 5 --from-step 4");
  });

  it("nextAfterStop: step 2 reads the seller balance first, step 3 relists and never goes back to steps 1-2, step 6 waits for a fast queue", () => {
    const p = { command: "C", network: "mainnet" as const };
    expect(nextAfterStop(2, p).join("\n")).toContain("it rose by 0.5: C --from-step 3 · it did not: C --from-step 2");
    expect(nextAfterStop(3, p).join("\n")).toContain("C --from-step 3 lists all three again");
    expect(nextAfterStop(6, p).join("\n")).toContain("Wait until qprobe shows ≤ 10 s, then C --from-step 6");
  });
});

describe("outbound: only an exact withdrawal is signed (S3)", () => {
  const deposit = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const expected = { signerId: "0xA54B000000000000000000000000000000004B73", depositAddress: deposit, amount: "1000000" };
  const payload = (intents: unknown[]) => JSON.stringify({ verifying_contract: "intents.near", signer_id: expected.signerId.toLowerCase(), deadline: "2026-11-16T15:22:24Z", nonce: "x", intents });
  const good = payload([{ intent: "transfer", receiver_id: deposit, tokens: { [NETWORKS.mainnet.usdcToken]: "1000000" } }]);

  it("passes the live-shaped 1Click payload through unchanged", () => {
    expect(withdrawPayload({ standard: "erc191", payload: good }, expected)).toBe(good);
  });

  it.each([
    ["an add_public_key intent", payload([{ intent: "add_public_key", public_key: "ed25519:evil" }])],
    ["a transfer to another receiver", payload([{ intent: "transfer", receiver_id: "evil.near", tokens: { [NETWORKS.mainnet.usdcToken]: "1000000" } }])],
    ["a larger amount", payload([{ intent: "transfer", receiver_id: deposit, tokens: { [NETWORKS.mainnet.usdcToken]: "9000000" } }])],
    ["a second intent", payload([JSON.parse(good).intents[0], { intent: "transfer", receiver_id: "evil.near", tokens: { [NETWORKS.mainnet.usdcToken]: "1" } }])],
  ])("refuses %s before anything is signed", (_what, bad) => {
    expect(() => withdrawPayload({ standard: "erc191", payload: bad }, expected)).toThrow(/nothing was signed/);
  });

  it("refuses a non-ERC-191 payload", () => {
    expect(() => withdrawPayload({ standard: "nep413", payload: good }, expected)).toThrow("ERC-191 expected");
  });
});

describe("small readiness fixes", () => {
  it("RH-10: a missing e2e blob tells the human to upload it to the blob base (runbook step 12), not to commit it", async () => {
    const host = repoBlobHost("http://127.0.0.1:9/blobs/", work);
    const err = await host(new Uint8Array([1, 2, 3]), "ab".repeat(32)).catch((e: Error) => e.message);
    expect(err).toContain(`upload ${join(work, "fixtures/blobs/e2e", `${"ab".repeat(32)}.bin`)}`);
    expect(err).toContain("to http://127.0.0.1:9/blobs/ (runbook step 12), then rerun");
    expect(err).not.toContain("commit");
  });

  it("S12: the L2 listing says its demo purchase key is public, within the contract's 280-char limit", async () => {
    const t = setup();
    await t.run({ only: 3 });
    const l2 = [...t.w.listings.values()].find((l) => l.title.includes("wallet labels"));
    expect(l2.public_desc).toContain("public demo viewing key, so anyone can already decrypt this file");
    expect([...l2.public_desc].length).toBeLessThanOrEqual(280);
  });
});
