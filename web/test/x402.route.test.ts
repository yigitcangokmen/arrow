import { describe, expect, it } from "vitest";
import { handleX402, type X402Deps } from "../lib/server/x402Handler.ts";
import { tokenBucket } from "../lib/ratelimit.ts";
import { RpcError } from "@arrow/sdk/rpc";
import { listingFixture } from "./helpers.ts";

const deps = (over: Partial<X402Deps> = {}): X402Deps => ({
  limiter: tokenBucket({ capacity: 60, refillEveryMs: 1_000 }),
  listing: async (_net, id) => (id === "1" ? listingFixture() : null),
  ...over,
});
const get = (path: string, method = "GET") => new Request(`http://localhost:3000${path}`, { method });

describe("x402-shaped 402", () => {
  it("402 with X-Arrow-Listing and no PAYMENT-REQUIRED header (testnet default)", async () => {
    const res = await handleX402(get("/api/x402/1"), "1", deps());
    expect(res.status).toBe(402);
    expect(res.headers.get("x-arrow-listing")).toBe("arrow.arrowhq.testnet/1");
    expect(res.headers.get("payment-required")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toBe("X-Arrow-Listing");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("body is the sdk builder's: x402Version 2, empty accepts, resource.url ends /l/1/data, info and schema", async () => {
    const b = await (await handleX402(get("/api/x402/1"), "1", deps())).json();
    expect(b.x402Version).toBe(2);
    expect(b.accepts).toEqual([]);
    expect(b.resource.url).toBe("http://localhost:3000/l/1/data");
    const ext = b.extensions["arrow-inspect"];
    expect(ext.info.listing).toBe("arrow.arrowhq.testnet/1");
    expect(ext.info.leak_budget_left_bits).toBeCloseTo((47 * 5673) / 1000, 6);
    expect(typeof ext.schema).toBe("object");
  });

  it("?network=mainnet uses the mainnet contract", async () => {
    let asked = "";
    const res = await handleX402(get("/api/x402/1?network=mainnet"), "1", deps({ listing: async (n) => ((asked = n), listingFixture()) }));
    expect(asked).toBe("mainnet");
    expect(res.headers.get("x-arrow-listing")).toBe("arrow-market.near/1");
  });

  it("HEAD returns the same status and headers without a body", async () => {
    const res = await handleX402(get("/api/x402/1", "HEAD"), "1", deps());
    expect(res.status).toBe(402);
    expect(res.headers.get("x-arrow-listing")).toBe("arrow.arrowhq.testnet/1");
    expect(await res.text()).toBe("");
  });

  it("404 for an unknown listing, 400 for a bad id or network, 502 when the RPC fails", async () => {
    expect((await handleX402(get("/api/x402/999999"), "999999", deps())).status).toBe(404);
    expect((await handleX402(get("/api/x402/abc"), "abc", deps())).status).toBe(400);
    expect((await handleX402(get("/api/x402/1?network=evil"), "1", deps())).status).toBe(400);
    const res = await handleX402(get("/api/x402/1"), "1", deps({ listing: async () => { throw new Error("rpc down"); } }));
    expect(res.status).toBe(502);
  });

  it("404 when the market contract is not deployed on that network", async () => {
    const notDeployed = new RpcError('wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "arrow.arrowhq.testnet" })');
    const res = await handleX402(get("/api/x402/1"), "1", deps({ listing: async () => { throw notDeployed; } }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("LISTING_NOT_FOUND");
  });

  it("429 after 60 requests", async () => {
    const d = deps();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await handleX402(get("/api/x402/1"), "1", d)).status;
    expect(last).toBe(429);
  });

  it("keeps the body free of forbidden wording (DEC M-05)", async () => {
    const text = await (await handleX402(get("/api/x402/1"), "1", deps())).text();
    expect(text).not.toMatch(/x402-compatible|x402 payment|standard|trustless|nothing leaks/i);
    expect(text).not.toMatch(/\bpayment\b/i);
  });
});
