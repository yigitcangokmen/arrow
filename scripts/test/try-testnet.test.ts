// WS4-T14 acceptance with fake faucet / sponsor / chain.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64, scalarFromLabel, unseal } from "@arrow/sdk";
import { type E2eDeps, runE2e } from "../src/e2e-testnet.ts";
import { repoRoot } from "../src/lib/env.ts";
import { isInsideRepo } from "../src/lib/repo.ts";
import { JUDGE_FILE, type TryDeps, runTry, TryStop } from "../src/try-testnet.ts";
import { BUYER, type Quirks, SELLER, world } from "./helpers/fakeChain.ts";

// built from parts so that the secret scanner does not mistake a test value for a key
const FAKE_KEY = ["ed25519", "SECRETKEYFORTESTS"].join(":");
const SEEDED_KEY = ["ed25519", "SEEDEDKEYFORTESTS"].join(":");
const JUDGE = "arrow-judge-0a1b2c3d.testnet";
const SPONSORED = "jabc123xyz9.arrow-judge.arrowhq.testnet";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arrow-try-"));
  process.env.ARROW_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.ARROW_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** A fake chain with the two demo listings already made by the e2e script's steps 0-2. */
async function fixture(q: Quirks = {}) {
  const w = world(q);
  const e2e: E2eDeps = {
    ctx: w.ctx, buyerId: BUYER, sellerId: SELLER, hasAi: true,
    balanceOf: async (id) => w.balances.get(id) ?? 0n,
    mint: async (id, amount) => {
      w.balances.set(id, (w.balances.get(id) ?? 0n) + amount);
      return { txHash: `mint-${id}`, signerId: id, url: "https://testnet.nearblocks.io/txns/mint" };
    },
    host: async (blob, sha) => {
      const url = `https://host.test/${sha}.bin`;
      w.blobs.set(url, blob);
      return url;
    },
    txEvents: async () => [],
    keys: (sha) => ({ key: Uint8Array.from(Buffer.from(sha, "hex")), nonce: Uint8Array.from(Buffer.from(sha, "hex")).subarray(0, 24) }),
    repo: repoRoot(), workDir: dir, sleep: async () => {}, stamp: "x", say: () => {},
  };
  const made = await runE2e(e2e, { steps: new Set([0, 1, 2]) });
  expect(made.results.every((r) => r.status === "PASS")).toBe(true);
  return { w, ids: made.listingIds as Record<"L1" | "L2" | "L3", number> };
}

async function setup(q: Quirks = {}, over: Partial<TryDeps> = {}) {
  const { w, ids } = await fixture(q);
  w.evidence.length = 0;
  const lines: string[] = [];
  const calls = { faucet: 0, sponsor: 0, mint: 0, newKey: 0 };
  const sentEvals: { listing_id: number; sealed_criteria: string }[] = [];
  const realPay = w.ctx.transport.pay;
  w.ctx.transport.pay = async (x) => {
    const m = JSON.parse(x.msg);
    if (m.op === "eval") sentEvals.push(m);
    return realPay(x);
  };
  const deps: TryDeps = {
    ctx: w.ctx,
    say: (l) => void lines.push(l),
    now: (() => { let t = 0; return () => (t += 62_000); })(),
    dir,
    nodeVersion: "24.15.0",
    listings: () => ({ contract: "arrow.arrowhq.testnet", program_wasm_sha256: "ab".repeat(32), pass_listing_id: ids.L1, buy_listing_id: ids.L2, created_utc: "2026-11-10T12:00:00Z" }),
    accountExists: async () => true,
    newKey: () => (calls.newKey++, { publicKey: "ed25519:PUBLICKEY", secret: FAKE_KEY }),
    faucet: async () => (calls.faucet++, { ok: true, status: 200 }),
    sponsor: async () => (calls.sponsor++, { ok: true, accountId: SPONSORED }),
    balanceOf: async (id) => w.balances.get(id) ?? 0n,
    mint: async (id, _s, amount) => {
      calls.mint++;
      w.balances.set(id, (w.balances.get(id) ?? 0n) + amount);
    },
    repo: repoRoot(),
    programHash: async () => "ab".repeat(32),
    ...over,
  };
  return { w, deps, lines, calls, ids, sentEvals };
}

const readJudge = () => JSON.parse(readFileSync(join(dir, JUDGE_FILE), "utf8"));
const seedJudge = (account = JUDGE) => writeFileSync(join(dir, JUDGE_FILE), JSON.stringify({ account_id: account, private_key: SEEDED_KEY, buyer_scalar_hex: "11".repeat(32) }), { mode: 0o600 });

describe("try-testnet", () => {
  it("faucet_then_sponsor_fallback", async () => {
    // the faucet answers 400 (the DEC V-06 field validation): the sponsor route creates the account
    const a = await setup({}, { faucet: async () => ({ ok: false, status: 400 }) });
    const r = await runTry(a.deps, {});
    expect(r.exit).toBe(0);
    expect(a.calls.sponsor).toBe(1);
    expect(readJudge().account_id).toBe(SPONSORED);
    expect(r.line).toContain(`account ${SPONSORED} (sponsor)`);

    // the faucet works: the sponsor is never called
    rmSync(join(dir, JUDGE_FILE));
    const b = await setup();
    const r2 = await runTry(b.deps, {});
    expect(b.calls.faucet).toBe(1);
    expect(b.calls.sponsor).toBe(0);
    expect(r2.line).toMatch(/account arrow-judge-[0-9a-f]{8}\.testnet \(faucet\) · minted 10 aUSD/);
  });

  it("when neither faucet nor sponsor works the message names the fallback and nothing is written", async () => {
    const a = await setup({}, {
      faucet: async () => ({ ok: false, status: 400 }),
      sponsor: async () => ({ ok: false, status: 429, message: "daily limit", fallback: "npm run verify && npm run bench:offline" }),
    });
    await expect(runTry(a.deps, {})).rejects.toThrow(/bench:offline/);
    expect(existsSync(join(dir, JUDGE_FILE))).toBe(false);
  });

  it("criteria_flag_overrides_pass_scene", async () => {
    const a = await setup();
    const custom = join(dir, "custom-criteria.json");
    writeFileSync(custom, JSON.stringify({ v: 1, text: "A custom PASS-scene criterion for the judge.", min_fit: 4 }));
    await runTry(a.deps, { criteria: custom });
    const scalar = scalarFromLabel("arrow:test:program:v1");
    const text = (m: { sealed_criteria: string }) => new TextDecoder().decode(unseal(scalar, b64.dec(m.sealed_criteria)));
    expect(a.sentEvals).toHaveLength(2);
    expect(a.sentEvals[0].listing_id).toBe(a.ids.L1);
    expect(text(a.sentEvals[0])).toContain("A custom PASS-scene criterion");
    expect(a.sentEvals[1].listing_id).toBe(a.ids.L2); // the BUY scene keeps fixtures/criteria/demo-buy.json
    expect(text(a.sentEvals[1])).toContain("Labelled NEAR DeFi wallets");
  });

  it("reuses_existing_judge_file", async () => {
    seedJudge();
    const a = await setup();
    const r = await runTry(a.deps, {});
    expect(a.calls.newKey + a.calls.faucet + a.calls.sponsor).toBe(0);
    expect(readJudge().account_id).toBe(JUDGE);
    expect(r.line).toContain(`account ${JUDGE} (reused)`);
  });

  it("--reset replaces the file", async () => {
    seedJudge();
    const a = await setup();
    await runTry(a.deps, { reset: true });
    expect(a.calls.faucet).toBe(1);
    expect(readJudge().account_id).not.toBe(JUDGE);
  });

  it("judge_file_mode_0600_outside_repo", async () => {
    const a = await setup();
    await runTry(a.deps, {});
    const f = join(dir, JUDGE_FILE);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(isInsideRepo(f)).toBe(false);
    expect(readJudge()).toMatchObject({ account_id: expect.stringMatching(/\.testnet$/), private_key: FAKE_KEY, buyer_scalar_hex: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("cap_message_points_to_bench_offline", async () => {
    seedJudge();
    const a = await setup();
    // the contract refuses the payment: the tx is final and carries the panic text but no arrow_eval event
    const real = a.deps.ctx.transport.pay;
    a.deps.ctx.transport.pay = async (x) => {
      if (JSON.parse(x.msg).op !== "eval") return real(x);
      a.w.txs.set("capped", { final_execution_status: "FINAL", status: { Failure: "Smart contract panicked: Arrow: E11 daily eval cap reached for account" }, receipts_outcome: [] });
      return { txHash: "capped", signerId: x.actor.id, url: "https://testnet.nearblocks.io/txns/capped" };
    };
    const err = await runTry(a.deps, {}).catch((e) => e);
    expect(err).toBeInstanceOf(TryStop);
    expect(err.message).toBe("Testnet cap reached (10 evals/account/day, 400/day). See recorded results: npm run bench:offline");
    expect(err.exit).toBe(2);
  });

  it("two refunds in a row point to bench:offline too", async () => {
    seedJudge();
    const a = await setup();
    for (const l of a.w.listings.values()) l.blob_url = "https://blob-host-missing.invalid/x.bin"; // the fake chain refunds these
    const err = await runTry(a.deps, {}).catch((e) => e);
    expect(err).toBeInstanceOf(TryStop);
    expect(err.message).toBe("Enclave could not complete (NEAR AI credit or OutLayer). See: npm run bench:offline");
    expect(err.exit).toBe(2);
  });

  it("a stale demo listing file is reported before any payment", async () => {
    seedJudge();
    const a = await setup({}, { programHash: async () => "cd".repeat(32) });
    await expect(runTry(a.deps, {})).rejects.toThrow(/stale; re-run e2e-testnet --publish-demo/);
    expect(a.sentEvals).toHaveLength(0);
  });

  it("old Node versions are told to nvm use", async () => {
    seedJudge();
    const a = await setup({}, { nodeVersion: "18.20.0" });
    await expect(runTry(a.deps, {})).rejects.toThrow(/nvm use/);
    expect(a.calls.faucet + a.calls.mint).toBe(0);
    const b = await setup({}, { nodeVersion: "22.22.2" });
    await expect(runTry(b.deps, {})).resolves.toMatchObject({ exit: 0 });
  });

  it("no_key_in_stdout", async () => {
    const a = await setup();
    const r = await runTry(a.deps, {});
    const out = [...a.lines, r.line].join("\n");
    const judge = readJudge();
    expect(out).not.toContain(judge.private_key);
    expect(out).not.toContain(judge.buyer_scalar_hex);
    expect(out).not.toMatch(/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/);
    expect(out).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  it("the happy path prints the one-line summary and the spend", async () => {
    seedJudge();
    const a = await setup();
    const r = await runTry(a.deps, {});
    expect(r.line).toMatch(new RegExp(`^account ${JUDGE} \\(reused\\) · minted 10 aUSD · PASS · fit 4/5 · novelty 1/5 · BUY · fit 4/5 · novelty 4/5 · bought #1 · sha256 match ✔ · \\d+m\\d+s$`));
    expect(a.lines.some((l) => l.startsWith("spent about 2.5 aUSD"))).toBe(true);
    expect(existsSync(join(dir, "try-testnet", `listing-${a.ids.L2}.csv`))).toBe(true);
  });
});
