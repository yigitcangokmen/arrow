import { describe, expect, it, vi } from "vitest";
import { toListingView, ttlCache } from "../lib/server/listingsCache.ts";
import { handleListings, type ListingsDeps } from "../lib/server/listingsHandler.ts";
import { listingFixture } from "./helpers.ts";

describe("toListingView", () => {
  it("budget.spentBits === evalsUsed * bitsPerEvalMilli / 1000", () => {
    const v = toListingView(listingFixture({ evals_used: 7, bits_per_eval_milli: 5673, max_evals: 50 }), []);
    expect(v.budget.spentBits).toBe((7 * 5673) / 1000);
    expect(v.budget.budgetBits).toBe((50 * 5673) / 1000);
    expect(v.budget.leftBits).toBeCloseTo(v.budget.budgetBits - v.budget.spentBits, 9);
    expect(v.budget).toMatchObject({ bitsPerEval: 5.673, maxEvals: 50, evalsUsed: 7 });
  });

  it("adds label and displayTitle", () => {
    const v = toListingView(listingFixture({ title: "[synthetic] Sales sample" }), []);
    expect(v).toMatchObject({ label: "synthetic", displayTitle: "Sales sample" });
    expect(toListingView(listingFixture({ title: "Real data", seller: "x.near" }), ["arrowhq.near"]).label).toBe("external");
  });
});

describe("ttlCache", () => {
  it("serves a value for 30 s and loads again after", async () => {
    let t = 0;
    const load = vi.fn(async () => t);
    const c = ttlCache<number>(30_000, () => t);
    expect(await c("k", load)).toBe(0);
    t = 29_999;
    expect(await c("k", load)).toBe(0);
    t = 30_000;
    expect(await c("k", load)).toBe(30_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/listings", () => {
  const mk = (listings = [listingFixture(), listingFixture({ id: 2 })]) => {
    const views = { listing: vi.fn(async (id: any) => listings.find((l) => String(l.id) === String(id)) ?? null), listings: vi.fn(async () => listings) };
    const d: ListingsDeps = { views: () => views as any, teamAccounts: [], cached: ttlCache(30_000) };
    return { d, views };
  };
  const get = (q = "") => new Request(`http://localhost/api/listings${q}`);

  it("200 with the contract, the views and the 30 s cache header", async () => {
    const { d } = mk();
    const res = await handleListings(get("?network=testnet"), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
    const b = await res.json();
    expect(b).toMatchObject({ network: "testnet", contract: "arrow.arrowhq.testnet" });
    expect(b.listings).toHaveLength(2);
    expect(b.listings[0].budget.spentBits).toBeCloseTo(3 * 5.673, 9);
  });

  it("?id= returns one listing or an empty list", async () => {
    const { d } = mk();
    expect((await (await handleListings(get("?id=2"), d)).json()).listings.map((l: any) => l.id)).toEqual([2]);
    expect((await (await handleListings(get("?id=77"), d)).json()).listings).toEqual([]);
  });

  it("reads the chain once per 30 s window", async () => {
    const { d, views } = mk();
    await handleListings(get(), d);
    await handleListings(get(), d);
    expect(views.listings).toHaveBeenCalledTimes(1);
  });

  it("400 for bad parameters, 502 when the RPC fails", async () => {
    const { d } = mk();
    for (const q of ["?network=evil", "?id=abc", "?limit=51", "?limit=0", "?from=-1"]) expect((await handleListings(get(q), d)).status).toBe(400);
    const failing: ListingsDeps = { ...d, views: () => ({ listing: async () => { throw new Error("x"); }, listings: async () => { throw new Error("x"); } }) as any, cached: ttlCache(30_000) };
    const res = await handleListings(get(), failing);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("RPC_ERROR");
  });
});
