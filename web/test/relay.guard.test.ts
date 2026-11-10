// Relay guards: the contract's own refusals (E05, E06, E10, E13), the free-eval drain, the relayer's 0.6 NEAR lock, the key type.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketStateFrom } from "../lib/blockers.ts";
import { clientIp } from "../lib/ip.ts";
import { keyedDaily, tokenBucket } from "../lib/ratelimit.ts";
import { handleRelay, type ChainPort, type RelayDeps, type RelayerPort } from "../lib/server/relayHandler.ts";
import { RelayRuns } from "../lib/server/relayRuns.ts";
import { NOW, SIGNER, USDC, healthyMarket, listingFixture, makeMp, post } from "./helpers.ts";

const outcome = { transaction: { hash: "TX", signer_id: "r.near" }, transaction_outcome: { outcome: { logs: [] } }, receipts_outcome: [] };
const NEAR = 10n ** 24n;

function relayer(over: Partial<RelayerPort> = {}) {
  const calls: unknown[] = [];
  const balance = vi.fn(async () => 2n * NEAR);
  const port: RelayerPort = {
    accountId: "r.near",
    balance,
    keyIsFunctionCall: async () => true,
    caller: () => ({ callFunction: async (a) => (calls.push(a), outcome) }),
    ...over,
  };
  return { port, calls, balance };
}
const market = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) =>
  marketStateFrom({ paused: false, tank_available: "500000000000000000000000", payment_path: "notify", result_path: "chain", build: "mainnet", config: { tank_min: "50000000000000000000000", outlayer_deposit_eval: "20000000000000000000000", outlayer_deposit_release: "10000000000000000000000", program_wasm_hash: "aa", ...cfg }, ...over } as never, "04ab");
const chain = (m = healthyMarket, l = listingFixture()): ChainPort => ({ listing: async () => l, listingBond: async () => 100_000n, market: async () => m });

function deps(over: Partial<RelayDeps> = {}): RelayDeps {
  return {
    limiter: tokenBucket({ capacity: 1000, refillEveryMs: 1 }),
    signerLimiter: tokenBucket({ capacity: 1000, refillEveryMs: 1 }),
    evalLimiter: tokenBucket({ capacity: 1000, refillEveryMs: 1 }),
    evalDaily: keyedDaily({ max: 1000 }),
    store: new RelayRuns(),
    chain: chain(),
    waitMs: 1_000,
    cfg: { contract: "arrow-market.near", usdcToken: USDC, now: NOW },
    relayer: () => relayer().port,
    escrowCaller: () => null,
    paymentPath: async () => "notify",
    simulate: async () => ({}),
    ...over,
  };
}
const send = (d: RelayDeps, mp = makeMp("eval")) => handleRelay(post("http://localhost/api/relay", { multipayload: mp }), d);
const nonce = (n: string, signer?: string, op: "eval" | "buy" = "eval") => makeMp(op, { payload: { nonce: n, ...(signer ? { signer_id: signer } : {}) } });
const signerN = (i: number) => "0x" + i.toString(16).padStart(40, "0");

beforeEach(() => vi.stubEnv("VERCEL", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("WEB-4: the relay refuses what the contract would panic on, before spending gas", () => {
  it.each([
    ["paused (E05)", market({ paused: true }), listingFixture(), 409, "MARKET_PAUSED"],
    ["tank under tank_min plus the deposit (E10)", market({ tank_available: "60000000000000000000000" }), listingFixture(), 409, "TANK_LOW"],
    ["a listing sealed to an old program (E13)", healthyMarket, listingFixture({ program_hash_at_list: "old" }), 409, "LISTING_STALE"],
  ] as const)("%s", async (_n, m, l, status, code) => {
    const r = relayer();
    const simulate = vi.fn(async () => ({}));
    const res = await send(deps({ relayer: () => r.port, simulate, chain: chain(m, l) }));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(r.balance).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(0);
  });
  it("a missing program key (E06) stops a list too", async () => {
    const r = relayer();
    const res = await send(deps({ relayer: () => r.port, chain: { ...chain(), market: async () => marketStateFrom({ paused: false, tank_available: "9".repeat(26), payment_path: "notify", result_path: "chain", build: "mainnet", config: {} } as never, null) } }), makeMp("list"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("PROGRAM_KEY_MISSING");
    expect(r.calls).toHaveLength(0);
  });
});

describe("WEB-2: a free, refunded eval cannot drain the gas tank through the relay", () => {
  it("52 distinct evals from one funded signer over 23 minutes: at most 10 reach the relayer", async () => {
    let t = NOW;
    const r = relayer();
    const d = deps({
      relayer: () => r.port,
      signerLimiter: tokenBucket({ capacity: 5, refillEveryMs: 30_000, now: () => t }),
      evalLimiter: tokenBucket({ capacity: 20, refillEveryMs: 3 * 60_000, now: () => t }),
      evalDaily: keyedDaily({ max: 10, now: () => t }),
    });
    for (let i = 0; i < 52; i++) {
      await send(d, nonce(`N${i}`));
      t += 26_500;
    }
    expect(r.calls.length).toBeLessThanOrEqual(10);
    expect(r.calls.length).toBeGreaterThan(0);
  });
  it("many signers together are held to the global eval bucket (20 an hour), buys are not", async () => {
    const t = NOW;
    const r = relayer();
    const d = deps({ relayer: () => r.port, evalLimiter: tokenBucket({ capacity: 20, refillEveryMs: 3 * 60_000, now: () => t }) });
    for (let i = 0; i < 30; i++) await send(d, nonce(`N${i}`, signerN(i)));
    expect(r.calls).toHaveLength(20);
    const limited = await send(d, nonce("X", signerN(99)));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await send(d, nonce("B1", signerN(98), "buy"))).status).toBe(200);
  });
  it("evals stop while the tank still holds ten evals of gas for purchases", async () => {
    const m = market({ tank_available: "200000000000000000000000" }, { tank_min: "50000000000000000000000" }); // 0.2 NEAR < 0.05 + 10 x 0.02
    const r = relayer();
    const evalRes = await send(deps({ relayer: () => r.port, chain: chain(m) }));
    expect(evalRes.status).toBe(409);
    expect((await evalRes.json()).code).toBe("TANK_LOW");
    expect((await send(deps({ relayer: () => r.port, chain: chain(m) }), nonce("B", undefined, "buy"))).status).toBe(200);
  });
});

describe("X12-OPS-1: one execute_intents locks 0.6 NEAR until its receipts finish", () => {
  it("a relayer at 0.40 NEAR (one payment in flight) answers 503 RELAYER_BUSY with Retry-After, nothing sent", async () => {
    const r = relayer({ balance: async () => (4n * NEAR) / 10n });
    const res = await send(deps({ relayer: () => r.port }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("RELAYER_BUSY");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(r.calls).toHaveLength(0);
  });
  it("a NotEnoughBalance refusal from the node is BUSY, not UNCLEAR, and the same payload can be retried", async () => {
    let n = 0;
    const r = relayer({ caller: () => ({ callFunction: async () => { if (n++ === 0) throw new Error("Sender arrow-relayer does not have enough balance 0.4 for operation costing 0.6 (NotEnoughBalance)"); return outcome; } }) });
    const d = deps({ relayer: () => r.port });
    const first = await send(d);
    expect(first.status).toBe(503);
    expect((await first.json()).code).toBe("RELAYER_BUSY");
    expect((await send(d)).status).toBe(200);
  });
});

describe("W2-3 / W2-8: the eval quotas are spent only on payments that can be sent", () => {
  it("a signer past its daily cap re-posting one payload does not drain the global bucket", async () => {
    const r = relayer();
    const d = deps({ relayer: () => r.port, evalLimiter: tokenBucket({ capacity: 20, refillEveryMs: 3 * 60_000, now: () => NOW }), evalDaily: keyedDaily({ max: 10, now: () => NOW }) });
    for (let i = 0; i < 10; i++) expect((await send(d, nonce(`A${i}`))).status).toBe(200);
    for (let i = 0; i < 12; i++) expect((await (await send(d, nonce("OVER"))).json()).code).toBe("EVAL_DAILY_CAP");
    expect((await send(d, nonce("H1", signerN(2)))).status).toBe(200); // an honest signer still gets through
  });
  it("RELAYER_BUSY (node NotEnoughBalance) and a missing escrow key give the daily eval back", async () => {
    const poor = relayer({ caller: () => ({ callFunction: async () => { throw new Error("does not have enough balance (NotEnoughBalance)"); } }) });
    const d = deps({ relayer: () => poor.port, evalDaily: keyedDaily({ max: 1, now: () => NOW }) });
    for (let i = 0; i < 3; i++) expect((await (await send(d, nonce(`P${i}`))).json()).code).toBe("RELAYER_BUSY");
    const noEscrow = deps({ evalDaily: d.evalDaily, paymentPath: async () => "escrow", escrowCaller: () => null });
    for (let i = 0; i < 3; i++) expect((await (await send(noEscrow, nonce(`E${i}`))).json()).code).toBe("RELAYER_UNAVAILABLE");
    expect((await send(deps({ evalDaily: d.evalDaily }), nonce("OK"))).status).toBe(200); // the one daily eval is still there
  });
});

describe("W2-7: a relayer that stays below one payment's gas says it is out of funds, not busy", () => {
  it("BUSY while a payment may be in flight, RELAYER_UNAVAILABLE once the balance stays low past the receipt window, and back to normal after a top-up", async () => {
    let t = NOW;
    let balance = (4n * NEAR) / 10n;
    const r = relayer({ balance: async () => balance });
    const d = deps({ relayer: () => r.port, now: () => t, lowBalance: { since: null } });
    expect((await (await send(d, nonce("B1"))).json()).code).toBe("RELAYER_BUSY");
    t += 2 * 60_000;
    expect((await (await send(d, nonce("B2"))).json()).code).toBe("RELAYER_BUSY");
    t += 4 * 60_000;
    const out = await send(d, nonce("B3"));
    expect(out.status).toBe(503);
    const body = await out.json();
    expect(body.code).toBe("RELAYER_UNAVAILABLE");
    expect(body.error).toMatch(/out of gas funds/);
    expect(r.calls).toHaveLength(0);
    balance = 2n * NEAR;
    expect((await send(d, nonce("B4"))).status).toBe(200);
    balance = (4n * NEAR) / 10n;
    expect((await (await send(d, nonce("B5"))).json()).code).toBe("RELAYER_BUSY"); // the low window starts again
  });
});

describe("R2-4: a seller can rehost a listing through the hosted relay", () => {
  it("the listing's seller gets 200; anyone else, a paused market or an unknown listing is refused before any gas", async () => {
    const r = relayer();
    const mine = chain(healthyMarket, listingFixture({ seller: SIGNER }));
    const ok = await send(deps({ relayer: () => r.port, chain: mine }), makeMp("rehost"));
    expect(ok.status).toBe(200);
    expect(r.calls).toHaveLength(1);
    for (const [d, code] of [
      [deps({ relayer: () => r.port, chain: chain(healthyMarket, listingFixture({ seller: "other.near" })) }), "NOT_SELLER"],
      [deps({ relayer: () => r.port, chain: chain(market({ paused: true }), listingFixture({ seller: SIGNER })) }), "MARKET_PAUSED"],
      [deps({ relayer: () => r.port, chain: { ...mine, listing: async () => null } }), "LISTING_NOT_FOUND"],
    ] as const) {
      expect((await (await send(d, makeMp("rehost"))).json()).code).toBe(code);
    }
    expect(r.calls).toHaveLength(1);
  });
});

describe("WEB-10: the relayer key must be the FunctionCall key", () => {
  it("a full-access key in the env gives 503 RELAYER_UNAVAILABLE and never calls the relayer", async () => {
    const r = relayer({ keyIsFunctionCall: async () => false });
    const res = await send(deps({ relayer: () => r.port }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("RELAYER_UNAVAILABLE");
    expect(r.calls).toHaveLength(0);
  });
});

describe("WEB-11: body size and the client address", () => {
  it("a body over 64 KiB is 413 before it is parsed, even when the header lies", async () => {
    const big = JSON.stringify({ multipayload: makeMp("eval"), pad: "x".repeat(70_000) });
    const res = await handleRelay(new Request("http://localhost/api/relay", { method: "POST", body: big }), deps());
    expect(res.status).toBe(413);
    const lying = await handleRelay(new Request("http://localhost/api/relay", { method: "POST", headers: { "content-length": "10" }, body: big }), deps());
    expect(lying.status).toBe(413);
  });
  it("x-forwarded-for is ignored where no trusted proxy sets it", () => {
    const req = new Request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientIp(req, { VERCEL: "1" })).toBe("1.2.3.4");
    expect(clientIp(req, { ARROW_TRUST_PROXY: "1" })).toBe("1.2.3.4");
    expect(clientIp(req, {})).toBe("unknown");
  });
});
