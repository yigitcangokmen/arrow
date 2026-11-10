import { describe, expect, it } from "vitest";
import { explainRejection, findEventId, PaymentRefused, SettleTimeout, waitForRecord } from "../lib/settle.ts";

const ev = (event: string, data: object) => ({
  transaction_outcome: { id: "r0", outcome: { logs: [], executor_id: "x" } },
  receipts_outcome: [{ id: "r1", outcome: { executor_id: "arrow-market.near", logs: [`EVENT_JSON:${JSON.stringify({ standard: "arrow", version: "1.0.0", event, data })}`] } }],
});
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};
const tx = { txHash: "h", signerId: "relayer.near" };

describe("findEventId", () => {
  it("returns the id once the event shows up, retrying through a flaky RPC", async () => {
    let calls = 0;
    const c = clock();
    const id = await findEventId("mainnet", tx, "arrow_eval", "eval_id", {
      ...c, phase: "accepted",
      txStatusImpl: (async () => {
        calls++;
        if (calls === 1) throw new Error("UNKNOWN_TRANSACTION");
        if (calls === 2) return ev("arrow_eval", { phase: "done", eval_id: 9 }); // wrong phase: skipped
        return ev("arrow_eval", { phase: "accepted", eval_id: 7 });
      }) as never,
    });
    expect(id).toBe(7);
    expect(calls).toBe(3);
  });
  it("reads an event whose data is an array, and an id of 0", async () => {
    expect(await findEventId("mainnet", tx, "arrow_listed", "listing_id", { ...clock(), txStatusImpl: (async () => ev("arrow_listed", [{ listing_id: 0 }])) as never })).toBe(0);
  });
  it("throws PaymentRefused with the contract's text when the tx is final and has no event", async () => {
    const failed = { final_execution_status: "FINAL", status: { Failure: "x" }, receipts_outcome: [{ outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Arrow: E07 eval budget used up" } } } } } } }] };
    await expect(findEventId("mainnet", tx, "arrow_eval", "eval_id", { ...clock(), txStatusImpl: (async () => failed) as never })).rejects.toThrow(/Arrow: E07 eval budget used up/);
    expect(explainRejection({ status: "SuccessValue" })).toMatch(/did not accept/);
  });
  it("times out", async () => {
    await expect(findEventId("mainnet", tx, "arrow_eval", "eval_id", { ...clock(), timeoutMs: 10_000, txStatusImpl: (async () => ({})) as never })).rejects.toBeInstanceOf(SettleTimeout);
  });
  it("stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(findEventId("mainnet", tx, "arrow_eval", "eval_id", { ...clock(), signal: ac.signal, txStatusImpl: (async () => ({})) as never })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("PaymentRefused is its own class", () => {
    expect(new PaymentRefused("x").name).toBe("PaymentRefused");
  });
});

describe("waitForRecord", () => {
  it("polls until the record is done or refunded", async () => {
    const seq = [null, { status: "pending" }, { status: "done", v: 1 }];
    let i = 0;
    const rec = await waitForRecord("eval", async () => seq[i++] as never, clock());
    expect(rec).toEqual({ status: "done", v: 1 });
    const refunded = await waitForRecord("eval", async () => ({ status: "refunded" }), clock());
    expect(refunded.status).toBe("refunded");
  });
  it("times out when the record stays pending, and survives a throwing read", async () => {
    await expect(waitForRecord("eval", async () => ({ status: "pending" }), { ...clock(), timeoutMs: 9000 })).rejects.toBeInstanceOf(SettleTimeout);
    let n = 0;
    expect((await waitForRecord("eval", async () => { if (n++ === 0) throw new Error("rpc"); return { status: "done" }; }, clock())).status).toBe("done");
  });
});
