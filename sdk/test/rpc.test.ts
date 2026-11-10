// WS4-T04 acceptance: fetch-based RPC (failover, error shapes) and NEP-297 / receipt parsing.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSalt, functionCallArgs, NETWORKS, parseEvents, RpcError, rpc, view } from "../src/index.ts";

const tx = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/tx-sample.json"), "utf8"));
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result }), { status: 200 });
const fail = (status: number) => new Response("down", { status });
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("rpc", () => {
  it("rpc_result_error_thrown", async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: "wasm execution failed", logs: [] }));
    await expect(rpc("mainnet", "query", {})).rejects.toThrowError(RpcError);
    fetchMock.mockResolvedValueOnce(ok({ error: "wasm execution failed", logs: [] }));
    await expect(rpc("mainnet", "query", {})).rejects.toThrow("wasm execution failed");
    expect(fetchMock).toHaveBeenCalledTimes(2); // a contract error is final: no failover
  });

  it("rpc_failover", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok({ block_height: 7 }));
    await expect(rpc("mainnet", "block", { finality: "final" })).resolves.toEqual({ block_height: 7 });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(NETWORKS.mainnet.rpc);
  });

  it("fails over on 429 and on a network error", async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok(1));
    await expect(rpc("testnet", "status", [])).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three rounds over every URL", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(fail(502));
    const p = rpc("mainnet", "status", []).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await p;
    expect(err).toBeInstanceOf(RpcError);
    expect(fetchMock).toHaveBeenCalledTimes(3 * NETWORKS.mainnet.rpc.length);
  });

  it("a JSON-RPC error is thrown without retry, with the server message", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { name: "HANDLER_ERROR", message: "Server error", data: "account does not exist" } })));
    await expect(rpc("mainnet", "query", {})).rejects.toThrow("account does not exist");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("archival calls try the archival URL first", async () => {
    fetchMock.mockResolvedValueOnce(ok(1));
    await rpc("mainnet", "tx", [], { archival: true });
    expect(fetchMock.mock.calls[0][0]).toBe(NETWORKS.mainnet.archivalRpc);
  });

  it("view encodes args as base64 JSON and decodes the byte result", async () => {
    fetchMock.mockResolvedValueOnce(ok({ result: bytes({ id: 1 }) }));
    await expect(view("testnet", "arrow.arrowhq.testnet", "get_listing", { listing_id: 1 })).resolves.toEqual({ id: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toMatchObject({ request_type: "call_function", finality: "final", account_id: "arrow.arrowhq.testnet", method_name: "get_listing" });
    expect(JSON.parse(atob(body.params.args_base64))).toEqual({ listing_id: 1 });
  });

  it("currentSalt returns 4 bytes and rejects other shapes", async () => {
    fetchMock.mockResolvedValueOnce(ok({ result: bytes("252812b3") }));
    await expect(currentSalt()).resolves.toEqual(Uint8Array.of(0x25, 0x28, 0x12, 0xb3));
    fetchMock.mockResolvedValueOnce(ok({ result: bytes("zz") }));
    await expect(currentSalt()).rejects.toThrow("unexpected current_salt");
    await expect(currentSalt("testnet")).rejects.toThrow("no intents contract");
  });
});

describe("transaction parsing", () => {
  it("parse_events_nep297", () => {
    const events = parseEvents(tx);
    expect(events.map((e) => `${e.standard}:${e.event}`)).toEqual(["nep245:mt_transfer", "arrow:arrow_eval", "arrow:arrow_refund"]);
    const refund = events[0];
    expect(refund.data[0]).toMatchObject({ old_owner_id: "arrow-market.near", memo: "refund", amounts: ["350000"] });
    expect(refund).toMatchObject({ receiptId: "R1", executorId: "intents.near", version: "1.0.0" });
    expect(events[1].data).toMatchObject({ eval_id: 3, spent_milli: 5673 });
    expect(events[2].data.reason).toBe("hash_mismatch");
  });

  it("ignores malformed EVENT_JSON lines and txs without outcomes", () => {
    expect(parseEvents({})).toEqual([]);
    expect(parseEvents(null)).toEqual([]);
  });

  it("functionCallArgs reads transaction and receipt actions", () => {
    expect(functionCallArgs(tx, { receiverId: "intents.near", methodName: "execute_intents" })[0].signed).toHaveLength(1);
    const notified = functionCallArgs(tx, { receiverId: "arrow-market.near", methodName: "mt_on_transfer" });
    expect(notified).toHaveLength(1);
    expect(JSON.parse(notified[0].msg)).toEqual({ op: "buy", listing_id: 1 });
    expect(functionCallArgs(tx, { receiverId: "arrow-market.near", methodName: "nope" })).toEqual([]);
  });
});
