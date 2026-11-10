// WS4-T07 acceptance: hosted relay error mapping, the API shapes, and the direct (relayer account) path.
import { describe, expect, it, vi } from "vitest";
import {
  ApiError, EXECUTE_INTENTS_GAS, type MultiPayload, type NearCaller, RelayRateLimited, RelayRejected, RelayRequest,
  RelayResponse, relayDirect, relayHosted, RelayUnavailable, relayUrl, SimulateFailed,
} from "../src/index.ts";

const mp: MultiPayload = { standard: "erc191", payload: '{"signer_id":"0xab"}', signature: "secp256k1:abc" };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const hosted = (res: Response) => relayHosted("https://arrow-market.vercel.app", mp, vi.fn().mockResolvedValue(res));

describe("api shapes", () => {
  it("relay_request_schema", () => {
    expect(RelayRequest.safeParse({ multipayload: mp }).success).toBe(true);
    expect(RelayRequest.safeParse({ multipayload: mp, extra: 1 }).success).toBe(false);
    expect(RelayRequest.safeParse({}).success).toBe(false);
    expect(RelayResponse.parse({ txHash: "H", signerId: "arrow-relayer.arrowhq.near" })).toEqual({ txHash: "H", signerId: "arrow-relayer.arrowhq.near" });
    expect(RelayResponse.safeParse({ tx_hash: "H" }).success).toBe(false);
    expect(ApiError.safeParse({ error: "x", code: "RATE_LIMITED", fallback: "f" }).success).toBe(true);
  });

  it("relayUrl takes an origin or the full relay URL", () => {
    expect(relayUrl("https://a.app")).toBe("https://a.app/api/relay");
    expect(relayUrl("https://a.app/")).toBe("https://a.app/api/relay");
    expect(relayUrl("https://a.app/api/relay")).toBe("https://a.app/api/relay");
  });
});

describe("relayHosted", () => {
  it("posts {multipayload} and returns the parsed 200", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { txHash: "H1", signerId: "arrow-relayer.arrowhq.near" }));
    await expect(relayHosted("https://arrow-market.vercel.app", mp, f)).resolves.toEqual({ txHash: "H1", signerId: "arrow-relayer.arrowhq.near" });
    expect(f.mock.calls[0][0]).toBe("https://arrow-market.vercel.app/api/relay");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ multipayload: mp }) });
  });

  it("relay_maps_429", async () => {
    const err = await hosted(json(429, { error: "slow down", code: "RATE_LIMITED" }, { "Retry-After": "42" })).catch((e) => e);
    expect(err).toBeInstanceOf(RelayRateLimited);
    expect(err.retryAfter).toBe(42);
    const noHeader = await hosted(json(429, { error: "slow down", code: "RATE_LIMITED" })).catch((e) => e);
    expect(noHeader.retryAfter).toBeNull();
  });

  it("relay_maps_503_fallback", async () => {
    const err = await hosted(json(503, { error: "no relayer", code: "RELAYER_UNAVAILABLE", fallback: "send execute_intents yourself: near contract call-function ..." })).catch((e) => e);
    expect(err).toBeInstanceOf(RelayUnavailable);
    expect(err.fallback).toContain("execute_intents");
  });

  it("maps 422 to SimulateFailed and other 4xx to RelayRejected with the code", async () => {
    const sim = await hosted(json(422, { error: "simulation failed", code: "SIMULATE_FAILED", detail: "insufficient balance" })).catch((e) => e);
    expect(sim).toBeInstanceOf(SimulateFailed);
    expect(sim.detail).toBe("insufficient balance");
    const nope = await hosted(json(403, { error: "not an Arrow intent", code: "NOT_ARROW_INTENT" })).catch((e) => e);
    expect(nope).toBeInstanceOf(RelayRejected);
    expect(nope.code).toBe("NOT_ARROW_INTENT");
    const rpc = await hosted(json(502, { error: "rpc", code: "RPC_ERROR" })).catch((e) => e);
    expect(rpc).toBeInstanceOf(RelayRejected);
  });

  it("rejects a body that does not match the schema", async () => {
    await expect(hosted(json(200, { ok: true }))).rejects.toThrow("unexpected body");
    await expect(hosted(new Response("<html>", { status: 500 }))).rejects.toThrow("without an error body");
  });
});

// ---------- direct path with a fake relayer account ----------
const log = (event: string, data: unknown) => "EVENT_JSON:" + JSON.stringify({ standard: "arrow", version: "1.0.0", event, data });
const outcome = (hash: string, logs: string[] = []) => ({
  transaction: { hash, signer_id: "arrow-relayer.arrowhq.near" },
  transaction_outcome: { id: hash, outcome: { logs: [], executor_id: "arrow-relayer.arrowhq.near" } },
  receipts_outcome: [{ id: "R1", outcome: { logs, executor_id: "arrow-market.near" } }],
});
const caller = (outcomes: any[]): NearCaller & { callFunction: ReturnType<typeof vi.fn> } => {
  const fn = vi.fn();
  for (const o of outcomes) fn.mockResolvedValueOnce(o);
  return { callFunction: fn };
};

describe("relayDirect", () => {
  it("calls intents.near execute_intents with 600 TGas and no deposit", async () => {
    const relayer = caller([outcome("TX1")]);
    await expect(relayDirect(relayer, mp)).resolves.toEqual({ txHash: "TX1", signerId: "arrow-relayer.arrowhq.near" });
    expect(relayer.callFunction).toHaveBeenCalledWith({
      contractId: "intents.near", methodName: "execute_intents", args: { signed: [mp] }, gas: EXECUTE_INTENTS_GAS, deposit: 0n,
    });
    expect(EXECUTE_INTENTS_GAS).toBe(600_000_000_000_000n);
  });

  it("relay_escrow_calls_request_eval", async () => {
    const relayer = caller([outcome("TX2", [log("arrow_eval", { listing_id: 1, eval_id: 9, phase: "accepted" })])]);
    const escrow = caller([outcome("REQ1")]);
    const r = await relayDirect(relayer, mp, { caller: escrow, contractId: "arrow-market.near" });
    expect(r).toEqual({ txHash: "TX2", signerId: "arrow-relayer.arrowhq.near", requestTxHash: "REQ1" });
    expect(escrow.callFunction).toHaveBeenCalledTimes(1);
    expect(escrow.callFunction.mock.calls[0][0]).toMatchObject({ contractId: "arrow-market.near", methodName: "request_eval", args: { eval_id: 9 }, deposit: 0n });
  });

  it("escrow: a purchase calls request_release; other phases and events are ignored", async () => {
    const relayer = caller([outcome("TX3", [log("arrow_purchase", { purchase_id: 4, phase: "accepted" }), log("arrow_eval", { eval_id: 5, phase: "done" }), log("arrow_refund", { reason: "stale" })])]);
    const escrow = caller([outcome("REQ2")]);
    await relayDirect(relayer, mp, { caller: escrow, contractId: "arrow-market.near" });
    expect(escrow.callFunction).toHaveBeenCalledTimes(1);
    expect(escrow.callFunction.mock.calls[0][0]).toMatchObject({ methodName: "request_release", args: { purchase_id: 4 } });
  });

  it("notify path: no escrow argument means no second call", async () => {
    const relayer = caller([outcome("TX4", [log("arrow_eval", { eval_id: 1, phase: "accepted" })])]);
    const r = await relayDirect(relayer, mp);
    expect(r.requestTxHash).toBeUndefined();
    expect(relayer.callFunction).toHaveBeenCalledTimes(1);
  });
});
