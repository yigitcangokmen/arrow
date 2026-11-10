import { describe, expect, it } from "vitest";
import { handleRelay, type RelayDeps } from "../lib/server/relayHandler.ts";
import { tokenBucket } from "../lib/ratelimit.ts";
import { NOW, USDC, makeMp, post } from "./helpers.ts";

const event = (name: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "arrow", version: "1.0.0", event: name, data: [data] })}`;
const outcomeWith = (logs: string[]) => ({
  transaction: { hash: "EXEC1", signer_id: "arrow-relayer.arrowhq.near" },
  transaction_outcome: { id: "t", outcome: { logs: [], executor_id: "arrow-relayer.arrowhq.near" } },
  receipts_outcome: [{ id: "r1", outcome: { logs, executor_id: "arrow-market.near" } }],
});

function setup(path: "notify" | "escrow", logs: string[], escrow: boolean) {
  const execCalls: any[] = [];
  const reqCalls: any[] = [];
  const d: RelayDeps = {
    limiter: tokenBucket({ capacity: 10, refillEveryMs: 6_000 }),
    cfg: { contract: "arrow-market.near", usdcToken: USDC, now: NOW },
    relayer: () => ({
      accountId: "arrow-relayer.arrowhq.near",
      balance: async () => 10n ** 24n,
      caller: (wait) => ({ callFunction: async (a) => (execCalls.push({ ...a, wait }), outcomeWith(logs)) }),
    }),
    escrowCaller: () => (escrow ? { callFunction: async (a) => (reqCalls.push(a), { transaction: { hash: "REQ1", signer_id: "arrow-relayer.arrowhq.near" } }) } : null),
    paymentPath: async () => path,
    simulate: async () => ({}),
  };
  return { d, execCalls, reqCalls };
}

const send = (d: RelayDeps, op: "list" | "eval" | "buy") => handleRelay(post("http://localhost/api/relay", { multipayload: makeMp(op) }), d);

describe("escrow branch of /api/relay", () => {
  it("calls request_eval with the eval id from the accepted event", async () => {
    const s = setup("escrow", [event("arrow_eval", { phase: "accepted", eval_id: 12 })], true);
    const res = await send(s.d, "eval");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: "EXEC1", signerId: "arrow-relayer.arrowhq.near", requestTxHash: "REQ1" });
    expect(s.execCalls[0].wait).toBe("FINAL"); // the event is only in the receipts
    expect(s.reqCalls).toHaveLength(1);
    expect(s.reqCalls[0]).toMatchObject({ contractId: "arrow-market.near", methodName: "request_eval", args: { eval_id: 12 } });
  });

  it("calls request_release for a buy", async () => {
    const s = setup("escrow", [event("arrow_purchase", { phase: "accepted", purchase_id: 5 })], true);
    expect((await send(s.d, "buy")).status).toBe(200);
    expect(s.reqCalls[0]).toMatchObject({ methodName: "request_release", args: { purchase_id: 5 } });
  });

  it("503 with an escrow fallback when the escrow key is not configured, and execute_intents is not sent", async () => {
    const s = setup("escrow", [], false);
    const res = await send(s.d, "eval");
    expect(res.status).toBe(503);
    expect((await res.json()).fallback).toBe("escrow request key not configured");
    expect(s.execCalls).toHaveLength(0);
  });

  it("does not use the escrow key for a list, or on the notify path", async () => {
    const a = setup("escrow", [], true);
    expect((await send(a.d, "list")).status).toBe(200);
    expect(a.execCalls[0].wait).toBe("INCLUDED_FINAL");
    const b = setup("notify", [event("arrow_eval", { phase: "accepted", eval_id: 1 })], true);
    expect((await send(b.d, "eval")).status).toBe(200);
    expect(b.reqCalls).toHaveLength(0);
  });
});
