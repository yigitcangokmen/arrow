import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toListingView, ttlCache } from "../lib/server/listingsCache.ts";
import { handleListings, type ListingsDeps } from "../lib/server/listingsHandler.ts";
import { tokenBucket } from "../lib/ratelimit.ts";
import { listingFixture } from "./helpers.ts";

beforeEach(() => vi.stubEnv("VERCEL", "1")); // x-forwarded-for is read only where a trusted proxy sets it
afterEach(() => vi.unstubAllEnvs());

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

  it("API-1: holds at most maxEntries keys, dropping the oldest, so arbitrary ?id= values cannot grow the Map", async () => {
    const load = vi.fn(async () => 1);
    const c = ttlCache<number>(30_000, () => 0, 3);
    for (const k of ["a", "b", "c", "d"]) await c(k, load);
    expect(load).toHaveBeenCalledTimes(4);
    await c("d", load);
    await c("c", load);
    await c("b", load);
    expect(load).toHaveBeenCalledTimes(4); // b, c, d are still cached
    await c("a", load);
    expect(load).toHaveBeenCalledTimes(5); // a was evicted
  });
});

describe("GET /api/listings", () => {
  const mk = (listings = [listingFixture(), listingFixture({ id: 2 })]) => {
    const views = { listing: vi.fn(async (id: any) => listings.find((l) => String(l.id) === String(id)) ?? null), listings: vi.fn(async () => listings) };
    const d: ListingsDeps = { views: () => views as any, teamAccounts: [], cached: ttlCache(30_000), limiter: tokenBucket({ capacity: 100, refillEveryMs: 60_000 }) };
    return { d, views };
  };
  const get = (q = "") => new Request(`http://localhost/api/listings${q}`);

  it("200 with the contract, the views and the 30 s cache header", async () => {
    const { d } = mk();
    const res = await handleListings(get("?network=testnet"), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
    const b = await res.json();
    expect(b).toMatchObject({ network: "testnet", contract: "arrow-v2.arrowhq.testnet" });
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

  it("API-1: the 6th request from one IP is 429 with Retry-After and no chain read; another IP is unaffected", async () => {
    const { d: base, views } = mk();
    const d: ListingsDeps = { ...base, limiter: tokenBucket({ capacity: 5, refillEveryMs: 60_000 }) };
    const ip = (a: string) => new Request("http://localhost/api/listings?id=1", { headers: { "x-forwarded-for": a } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await handleListings(ip("9.9.9.9"), d)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const res = await handleListings(ip("9.9.9.9"), d);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect((await handleListings(ip("8.8.8.8"), d)).status).toBe(200);
    expect(views.listing).toHaveBeenCalledTimes(1); // the 30 s cache served the rest
  });
});

describe("ttlCache: single flight and a negative cache (WEB-3)", () => {
  it("25 concurrent callers of a cold key run the loader once", async () => {
    let calls = 0;
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => (release = r));
    const get = ttlCache<number>(60_000, Date.now, 200, { maxWaiters: 100 });
    const all = Array.from({ length: 25 }, () => get("k", () => (calls++, gate)));
    release(7);
    expect(await Promise.all(all)).toEqual(Array(25).fill(7));
    expect(calls).toBe(1);
  });
  it("concurrent waiters share one rejection, and a failure is not reloaded inside the negative TTL", async () => {
    let t = 0;
    let calls = 0;
    const get = ttlCache<number>(60_000, () => t, 200, { failTtlMs: 60_000, maxWaiters: 100 });
    const load = async () => (calls++, Promise.reject(new Error("429 from the public RPC")));
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => get("k", load)));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(calls).toBe(1);
    t += 59_000;
    await expect(get("k", load)).rejects.toThrow(/429/);
    expect(calls).toBe(1);
    t += 2_000;
    await expect(get("k", load)).rejects.toThrow(/429/);
    expect(calls).toBe(2);
  });
  it("without a negative TTL a failure is retried at once (the listings behaviour)", async () => {
    let calls = 0;
    const get = ttlCache<number>(60_000);
    const load = async () => (calls++, Promise.reject(new Error("x")));
    await get("k", load).catch(() => undefined);
    await get("k", load).catch(() => undefined);
    expect(calls).toBe(2);
  });
  it("refuses callers beyond maxWaiters instead of holding every function open", async () => {
    const get = ttlCache<number>(60_000, Date.now, 200, { maxWaiters: 3 });
    const gate = new Promise<number>(() => undefined);
    const first = [get("k", () => gate), get("k", () => gate), get("k", () => gate)];
    await expect(get("k", () => gate)).rejects.toThrow(/Too many requests are waiting/);
    expect(first).toHaveLength(3);
  });
});
