import { afterEach, describe, expect, it, vi } from "vitest";
import { FailoverRpcError, FailoverRpcProvider } from "near-api-js";
import { NETWORKS } from "@arrow/sdk/config";
import { nearErrorMessage, provider } from "../lib/server/near.ts";

afterEach(() => vi.unstubAllGlobals());

const rpcResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("server near provider", () => {
  it("wraps every RPC URL of the network in a failover provider", () => {
    const p = provider("testnet");
    expect(p).toBeInstanceOf(FailoverRpcProvider);
    expect((p as FailoverRpcProvider).providers).toHaveLength(NETWORKS.testnet.rpc.length);
  });

  it("moves to the next URL when the first answers 429", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return url === NETWORKS.testnet.rpc[0]
        ? rpcResponse(429, { error: "DEPRECATED" })
        : rpcResponse(200, { jsonrpc: "2.0", id: 1, result: { chain_id: "testnet" } });
    });
    expect(await provider("testnet").getNetworkId()).toBe("testnet");
    expect(urls).toEqual([NETWORKS.testnet.rpc[0], NETWORKS.testnet.rpc[1]]);
  });

  it("reports the per-URL causes when every URL fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => rpcResponse(429, { error: "DEPRECATED" }));
    const e = await provider("testnet").getNetworkId().catch((x) => x);
    expect(e).toBeInstanceOf(FailoverRpcError);
    expect(nearErrorMessage(e)).toContain("DEPRECATED");
    expect(nearErrorMessage(e)).not.toContain("Exceeded");
    expect(nearErrorMessage(new Error("plain"))).toBe("plain");
  });
});
