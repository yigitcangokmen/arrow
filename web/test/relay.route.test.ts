import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRelay, realRelayDeps, type RelayDeps, type RelayerPort } from "../lib/server/relayHandler.ts";
import { tokenBucket } from "../lib/ratelimit.ts";
import { NOW, USDC, makeMp, post } from "./helpers.ts";

const URL_ = "http://localhost/api/relay";
const outcome = { transaction: { hash: "TXHASH1", signer_id: "arrow-relayer.arrowhq.near" }, transaction_outcome: { outcome: { logs: [] } }, receipts_outcome: [] };

function relayer(over: Partial<RelayerPort> = {}) {
  const calls: any[] = [];
  const port: RelayerPort = {
    accountId: "arrow-relayer.arrowhq.near",
    balance: async () => 10n ** 24n,
    caller: (wait) => ({ callFunction: async (a) => (calls.push({ ...a, wait }), outcome) }),
    ...over,
  };
  return { port, calls };
}

const deps = (over: Partial<RelayDeps> = {}): RelayDeps => ({
  limiter: tokenBucket({ capacity: 10, refillEveryMs: 6_000 }),
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
});
afterEach(() => vi.unstubAllGlobals());

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

  it("503 when the relayer balance is under 0.05 NEAR", async () => {
    const r = relayer({ balance: async () => 10n ** 22n });
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => r.port }));
    expect(res.status).toBe(503);
    expect(r.calls).toHaveLength(0);
  });

  it("422 SIMULATE_FAILED when intents.near rejects the simulation (fake RPC), nothing is sent", async () => {
    fetchMock.mockResolvedValue(rpcOk({ error: "wasm execution failed: nonce was already used", logs: [] }));
    const r = relayer();
    const res = await handleRelay(post(URL_, { multipayload: makeMp("eval") }), deps({ relayer: () => r.port, simulate: realRelayDeps.simulate }));
    expect(res.status).toBe(422);
    const b = await res.json();
    expect(b.code).toBe("SIMULATE_FAILED");
    expect(b.detail).toContain("nonce was already used");
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
