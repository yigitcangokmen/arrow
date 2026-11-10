import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "@arrow/sdk/rpc";
import { handleRelay, realRelayDeps, type ChainPort, type RelayDeps, type RelayerPort } from "../lib/server/relayHandler.ts";
import { RelayRuns } from "../lib/server/relayRuns.ts";
import { keyedDaily, tokenBucket } from "../lib/ratelimit.ts";
import { NOW, USDC, healthyMarket, listingFixture, makeMp, post } from "./helpers.ts";

const URL_ = "http://localhost/api/relay";
const outcome = { transaction: { hash: "TXHASH1", signer_id: "arrow-relayer.arrowhq.near" }, transaction_outcome: { outcome: { logs: [] } }, receipts_outcome: [] };

function relayer(over: Partial<RelayerPort> = {}) {
  const calls: any[] = [];
  const port: RelayerPort = {
    accountId: "arrow-relayer.arrowhq.near",
    balance: async () => 10n ** 24n,
    keyIsFunctionCall: async () => true,
    caller: (wait) => ({ callFunction: async (a) => (calls.push({ ...a, wait }), outcome) }),
    ...over,
  };
  return { port, calls };
}

const chain = (over: Partial<ChainPort> = {}): ChainPort => ({
  listing: async () => listingFixture(), // eval_fee 250000, price 2000000, 3 of 50 evals used
  listingBond: async () => 100_000n,
  market: async () => healthyMarket,
  ...over,
});

const deps = (over: Partial<RelayDeps> = {}): RelayDeps => ({
  limiter: tokenBucket({ capacity: 10, refillEveryMs: 6_000 }),
  signerLimiter: tokenBucket({ capacity: 10, refillEveryMs: 6_000 }),
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
});

const rpcOk = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL", "1"); // the client address is read from x-forwarded-for only where a trusted proxy sets it
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/relay", () => {
  it("returns 200 {txHash, signerId} and sends execute_intents with 600 TGas, INCLUDED_FINAL", async () => {
    const r = relayer();
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => r.port }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: "TXHASH1", signerId: "arrow-relayer.arrowhq.near" });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ contractId: "intents.near", methodName: "execute_intents", gas: 600_000_000_000_000n, deposit: 0n, wait: "INCLUDED_FINAL" });
    expect(r.calls[0].args).toEqual({ signed: [makeMp("eval")] });
  });

  it("400 for a body that is not {multipayload}", async () => {
    for (const body of [{}, { multipayload: { standard: "nep413", payload: "x", signature: "y" } }, { multipayload: makeMp("eval"), extra: 1 }]) {
      const res = await handleRelay(post(URL_, body), deps());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("BAD_REQUEST");
    }
  });

  it("403 NOT_ARROW_INTENT for another receiver, and nothing is sent", async () => {
    const r = relayer();
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval", { intent: { receiver_id: "x.near" } }) }), deps({ relayer: () => r.port }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NOT_ARROW_INTENT");
    expect(r.calls).toHaveLength(0);
  });

  it("503 RELAYER_UNAVAILABLE with a self-relay fallback when the relayer env is missing", async () => {
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => null }));
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.code).toBe("RELAYER_UNAVAILABLE");
    expect(b.fallback).toContain("execute_intents");
  });

  it("503 when the relayer balance is under 0.65 NEAR", async () => {
    const r = relayer({ balance: async () => 10n ** 22n });
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => r.port }));
    expect(res.status).toBe(503);
    expect(r.calls).toHaveLength(0);
  });

  it("422 SIMULATE_FAILED when intents.near rejects the simulation (fake RPC), nothing is sent", async () => {
    fetchMock.mockResolvedValue(rpcOk({ error: "wasm execution failed: insufficient balance", logs: [] }));
    const r = relayer();
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => r.port, simulate: realRelayDeps.simulate }));
    expect(res.status).toBe(422);
    const b = await res.json();
    expect(b.code).toBe("SIMULATE_FAILED");
    expect(b.detail).toContain("insufficient balance");
    expect(JSON.stringify(b)).not.toContain("secp256k1");
    expect(r.calls).toHaveLength(0);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.params.method_name).toBe("simulate_intents");
    expect(JSON.parse(Buffer.from(sent.params.args_base64, "base64").toString())).toEqual({ signed: [makeMp("eval")] });
  });

  it("502 RPC_ERROR when the RPC itself is down during simulation", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    const p = handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ simulate: realRelayDeps.simulate }));
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(502);
    vi.useRealTimers();
  });

  it("the 11th request in a minute is 429 with Retry-After", async () => {
    const d = deps();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await handleRelay(post(URL_, {}, { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), d)).status);
    expect(codes).toEqual([...Array(10).fill(400), 429]);
    const res = await handleRelay(post(URL_, {}, { "x-forwarded-for": "9.9.9.9" }), d);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect((await handleRelay(post(URL_, {}, { "x-forwarded-for": "8.8.8.8" }), d)).status).toBe(400); // other IP unaffected
  });
});

const send = (d: RelayDeps, mp = makeMp("eval"), headers: Record<string, string> = {}) => handleRelay(post(URL_, { multipayload: mp }, headers), d);
const nonce = (n: string, op: "eval" | "buy" | "list" = "eval") => makeMp(op, { payload: { nonce: n } });

describe("RELAY-3: the same signed payload gets the same answer and is executed once", () => {
  it("a repeat after success returns the first answer without simulating or sending again", async () => {
    const r = relayer();
    const simulate = vi.fn(async () => ({}));
    const d = deps({ relayer: () => r.port, simulate });
    const first = await send(d);
    const second = await send(d);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(r.calls).toHaveLength(1);
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it("two requests at the same time share one execution", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const calls: any[] = [];
    const port = relayer({ caller: () => ({ callFunction: async (a) => (calls.push(a), await gate, outcome) }) }).port;
    const d = deps({ relayer: () => port });
    const a = send(d);
    const b = send(d);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(await rb.json()).toEqual(await ra.json());
    expect(calls).toHaveLength(1);
  });

  it("a failure after broadcast is RELAY_UNCLEAR, not a payment failure, and a repeat does not execute again", async () => {
    const calls: any[] = [];
    const port = relayer({ caller: () => ({ callFunction: async (a) => (calls.push(a), Promise.reject(new Error("socket hang up"))) }) }).port;
    const d = deps({ relayer: () => port });
    const first = await send(d);
    expect(first.status).toBe(502);
    const b = await first.json();
    expect(b.code).toBe("RELAY_UNCLEAR");
    expect(b.unclear).toBe(true);
    expect(b.error).toMatch(/may or may not have gone through/);
    expect(b.error).toMatch(/Do not pay again/);
    expect(b.error).toMatch(/Check payment/); // the page has that button; there is no "Arrow activity" page (X12-tabs-1)
    expect(b.error).not.toMatch(/Arrow activity/);
    expect(b.error.length).toBeLessThan(240); // the web UI shows the first 240 characters of a relay rejection
    expect(b.detail).toContain("socket hang up");
    const second = await send(d);
    expect(second.status).toBe(502);
    expect((await second.json()).code).toBe("RELAY_UNCLEAR");
    expect(calls).toHaveLength(1);
  });

  it("a relayer that outlasts the wait budget answers RELAY_UNCLEAR, and the real result is served on the next request", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((res) => (finish = res));
    const calls: any[] = [];
    const port = relayer({ caller: () => ({ callFunction: async (a) => (calls.push(a), await slow, outcome) }) }).port;
    const d = deps({ relayer: () => port, waitMs: 30 });
    const first = await send(d);
    expect(first.status).toBe(502);
    expect((await first.json()).code).toBe("RELAY_UNCLEAR");
    finish();
    await new Promise((r) => setTimeout(r, 20));
    const second = await send(d);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ txHash: "TXHASH1", signerId: "arrow-relayer.arrowhq.near" });
    expect(calls).toHaveLength(1);
  });

  it("failures before broadcast are not remembered: the same payload may be retried", async () => {
    const r = relayer();
    let n = 0;
    const simulate = vi.fn(async () => {
      if (n++ === 0) throw new RpcError("HTTP 503", true);
      return {};
    });
    const d = deps({ relayer: () => r.port, simulate });
    expect((await send(d)).status).toBe(502); // the RPC was down, nothing was sent
    expect((await send(d)).status).toBe(200);
    expect(r.calls).toHaveLength(1);
  });

  it("a new nonce is a new payment and is executed on its own", async () => {
    const r = relayer();
    const d = deps({ relayer: () => r.port });
    expect((await send(d, nonce("AAAA"))).status).toBe(200);
    expect((await send(d, nonce("BBBB"))).status).toBe(200);
    expect(r.calls).toHaveLength(2);
  });

  it("409 ALREADY_RELAYED when intents.near reports the nonce as used and this instance never saw the payload", async () => {
    fetchMock.mockResolvedValue(rpcOk({ error: "wasm execution failed: nonce was already used", logs: [] }));
    const r = relayer();
    const res = await send(deps({ relayer: () => r.port, simulate: realRelayDeps.simulate }));
    expect(res.status).toBe(409);
    const b = await res.json();
    expect(b.code).toBe("ALREADY_RELAYED");
    expect(b.error).toMatch(/already submitted/);
    expect(b.error).toMatch(/Do not pay again/);
    expect(b.error).not.toMatch(/Arrow activity/);
    expect(r.calls).toHaveLength(0);
  });
});

describe("RELAY-2: amount and listing are checked before any gas is spent", () => {
  const untouched = () => {
    const balance = vi.fn(async () => 10n ** 24n);
    const r = relayer({ balance });
    const simulate = vi.fn(async () => ({}));
    return { r, balance, simulate };
  };

  it.each([
    ["eval below eval_fee", makeMp("eval", { intent: { tokens: { [USDC]: "249999" } } }), chain(), 400, "AMOUNT_TOO_LOW"],
    ["buy below price", makeMp("buy", { intent: { tokens: { [USDC]: "1999999" } } }), chain(), 400, "AMOUNT_TOO_LOW"],
    ["list below the bond", makeMp("list", { intent: { tokens: { [USDC]: "99999" } } }), chain(), 400, "AMOUNT_TOO_LOW"],
    ["an unknown listing", makeMp("eval"), chain({ listing: async () => null }), 404, "LISTING_NOT_FOUND"],
    ["an exhausted leak budget", makeMp("eval"), chain({ listing: async () => listingFixture({ evals_used: 50, max_evals: 50 }) }), 409, "BUDGET_EXHAUSTED"],
  ] as const)("%s is refused, and neither the balance, the simulation nor the relayer is touched", async (_n, mp, ch, status, code) => {
    const { r, balance, simulate } = untouched();
    const res = await send(deps({ relayer: () => r.port, simulate, chain: ch }), mp);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(balance).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(0);
  });

  it("an exhausted budget does not block a buy, and exact amounts pass", async () => {
    const r = relayer();
    const d = deps({ relayer: () => r.port, chain: chain({ listing: async () => listingFixture({ evals_used: 50, max_evals: 50 }) }) });
    expect((await send(d, makeMp("buy", { intent: { tokens: { [USDC]: "2000000" } } }))).status).toBe(200);
    expect((await send(deps({ relayer: () => r.port }), makeMp("eval", { intent: { tokens: { [USDC]: "250000" } } }))).status).toBe(200);
  });

  it("502 RPC_ERROR when the contract cannot be read, and nothing is sent", async () => {
    const { r, simulate } = untouched();
    const res = await send(deps({ relayer: () => r.port, simulate, chain: chain({ listing: async () => { throw new Error("rpc down"); } }) }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("RPC_ERROR");
    expect(simulate).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(0);
  });

  it("a token amount that is not a decimal string is refused", async () => {
    const res = await send(deps(), makeMp("eval", { intent: { tokens: { [USDC]: "2e6" } } }));
    expect(res.status).toBe(403);
  });

  it("a signer gets a burst of new payloads, then 429; replays cost no token; another signer is unaffected", async () => {
    const r = relayer();
    const d = deps({ relayer: () => r.port, signerLimiter: tokenBucket({ capacity: 2, refillEveryMs: 60_000 }) });
    const ip = (n: number) => ({ "x-forwarded-for": `7.7.7.${n}` }); // different IPs: the signer limit is separate from the IP limit
    expect((await send(d, nonce("N1"), ip(1))).status).toBe(200);
    expect((await send(d, nonce("N1"), ip(2))).status).toBe(200); // a replay: free
    expect((await send(d, nonce("N2"), ip(3))).status).toBe(200);
    const limited = await send(d, nonce("N3"), ip(4));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).code).toBe("RATE_LIMITED");
    expect(r.calls).toHaveLength(2);
    const other = makeMp("eval", { payload: { signer_id: "0x" + "1".repeat(40), nonce: "N9" } });
    expect((await send(d, other, ip(5))).status).toBe(200);
  });
});
