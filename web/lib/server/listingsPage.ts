// Listings for server-rendered pages: same source and 30 s cache as /api/listings, read in-process (no HTTP hop).
import { ArrowViews } from "@arrow/sdk/contract";
import { CONTRACTS, type Network } from "../config.ts";
import { toListingView, ttlCache, type ListingView } from "./listingsCache.ts";
import { pageAllListings } from "./pageAll.ts";

const ORDER = { external: 0, unlabelled: 1, "team-made": 2, synthetic: 3 } as const;

/** Marks listings sealed to another program than `hash` (null = unknown, nothing is marked). */
export const markStale = (views: readonly ListingView[], hash: string | null): ListingView[] =>
  views.map((v) => (hash !== null && v.program_hash_at_list !== hash ? { ...v, stale: true } : v));

/** Listings that can still be bought first: external, then team-made, then synthetic; newest first inside each group (DEC L-10). Stale ones last. */
export function sortListingViews(views: readonly ListingView[]): ListingView[] {
  return [...views].sort((a, b) => {
    const st = Number(a.stale === true) - Number(b.stale === true);
    if (st !== 0) return st;
    const g = ORDER[a.label] - ORDER[b.label];
    if (g !== 0) return g;
    const t = BigInt(b.created_at_ns) - BigInt(a.created_at_ns);
    return t > 0n ? 1 : t < 0n ? -1 : Number(b.id) - Number(a.id);
  });
}

const cached = ttlCache<ListingView[]>(30_000);

export function loadListingViews(net: Network, teamAccounts: readonly string[]): Promise<ListingView[]> {
  return cached(net, async () => {
    const views = new ArrowViews(net, CONTRACTS[net]);
    const [listings, cv] = await Promise.all([pageAllListings(views), views.config().catch(() => null)]);
    const hash = typeof cv?.config.program_wasm_hash === "string" ? cv.config.program_wasm_hash : null;
    return sortListingViews(markStale(listings.map((l) => toListingView(l, teamAccounts)), hash));
  });
}
