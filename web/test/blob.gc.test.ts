import { describe, expect, it, vi } from "vitest";
import { GC_GRACE_MS, GC_MARKETS, type GcDeps, handleBlobGc, realGcDeps } from "../lib/server/blobGc.ts";

const NOW = 10 * GC_GRACE_MS;
const sha = (c: string) => c.repeat(64);
const blob = (c: string, ageMs: number) => ({ pathname: `blobs/${sha(c)}.bin`, url: `https://x.public.blob.vercel-storage.com/blobs/${sha(c)}.bin`, uploadedAt: new Date(NOW - ageMs) });
const req = (auth?: string) => new Request("https://arrow.test/api/cron/blob-gc", { headers: auth ? { authorization: auth } : {} });

function deps(o: Partial<GcDeps> = {}): GcDeps & { del: ReturnType<typeof vi.fn> } {
  return {
    secret: () => "s3cret",
    token: () => "tok",
    blobs: async () => [blob("a", 2 * GC_GRACE_MS), blob("b", 2 * GC_GRACE_MS), blob("c", 2 * GC_GRACE_MS), blob("d", 1000)],
    listings: async (_net, contract) =>
      contract === "arrow-market.near" ? [{ blob_sha256: sha("a"), blob_url: "https://elsewhere.example/a.bin" }]
      : contract === "arrow.arrowhq.testnet" ? [{ blob_sha256: sha("e"), blob_url: blob("b", 0).url }]
      : [],
    now: () => NOW,
    ...o,
    del: vi.fn(async () => undefined),
  } as GcDeps & { del: ReturnType<typeof vi.fn> };
}

describe("X12-4: blob garbage collection", () => {
  it("deletes only blobs older than 24 h that no listing on either network points to", async () => {
    const d = deps();
    const res = await handleBlobGc(req("Bearer s3cret"), d);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toEqual([`blobs/${sha("c")}.bin`]); // a: bound hash on mainnet, b: URL path on the older testnet market, d: younger than 24 h
    expect(d.del).toHaveBeenCalledWith([blob("c", 0).url], "tok");
  });

  it("without CRON_SECRET, or with the wrong header, answers 401 and reads nothing", async () => {
    for (const [secret, auth] of [[undefined, "Bearer undefined"], ["s3cret", undefined], ["s3cret", "Bearer wrong"], ["s3cret", "s3cret"]] as const) {
      const blobs = vi.fn(async () => []);
      const d = deps({ secret: () => secret, blobs });
      expect((await handleBlobGc(req(auth), d)).status).toBe(401);
      expect(blobs).not.toHaveBeenCalled();
      expect(d.del).not.toHaveBeenCalled();
    }
  });

  it("fails closed: one unreadable network deletes nothing", async () => {
    const d = deps({ listings: async (_net, contract) => { if (contract === "arrow.arrowhq.testnet") throw new Error("rpc down"); return []; } });
    const res = await handleBlobGc(req("Bearer s3cret"), d);
    expect(res.status).toBe(503);
    expect(d.del).not.toHaveBeenCalled();
  });

  it("web/vercel.json runs the route once a day", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const web = new URL("..", import.meta.url);
    const crons = JSON.parse(readFileSync(new URL("vercel.json", web), "utf8")).crons as { path: string; schedule: string }[];
    expect(crons).toEqual([{ path: "/api/cron/blob-gc", schedule: expect.stringMatching(/^\d{1,2} \d{1,2} \* \* \*$/) }]);
    expect(existsSync(new URL("app/api/cron/blob-gc/route.ts", web))).toBe(true);
  });

  it("scans both mainnet markets and both testnet markets", () => {
    expect(GC_MARKETS.map((m) => m[1]).sort()).toEqual(["arrow-market-v2.near", "arrow-market.near", "arrow-v2.arrowhq.testnet", "arrow.arrowhq.testnet"]);
  });

  it("a market with no code yet counts as no listings, any other RPC error throws", async () => {
    const { RpcError } = await import("@arrow/sdk/rpc");
    const { ArrowViews } = await import("@arrow/sdk/contract");
    const spy = vi.spyOn(ArrowViews.prototype, "allListings").mockRejectedValueOnce(new RpcError("CompilationError(CodeDoesNotExist { account_id: \"arrow-market.near\" })"));
    await expect(realGcDeps.listings("mainnet", "arrow-market.near")).resolves.toEqual([]);
    spy.mockRejectedValueOnce(new RpcError("Server error"));
    await expect(realGcDeps.listings("mainnet", "arrow-market.near")).rejects.toThrow("Server error");
    spy.mockRestore();
  });
});
