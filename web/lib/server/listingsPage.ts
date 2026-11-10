// Listings for server-rendered pages: same source and 30 s cache as /api/listings, read in-process (no HTTP hop).
import { ArrowViews } from "@arrow/sdk/contract";
import { CONTRACTS, type Network } from "../config.ts";
import { toListingView, ttlCache, type ListingView } from "./listingsCache.ts";

const ORDER = { external: 0, unlabelled: 1, "team-made": 2, synthetic: 3 } as const;

/** external first, then team-made, then synthetic; newest first inside each group (DEC L-10). */
export function sortListingViews(views: readonly ListingView[]): ListingView[] {
  return [...views].sort((a, b) => {
    const g = ORDER[a.label] - ORDER[b.label];
    if (g !== 0) return g;
    const t = BigInt(b.created_at_ns) - BigInt(a.created_at_ns);
    return t > 0n ? 1 : t < 0n ? -1 : Number(b.id) - Number(a.id);
  });
}

const cached = ttlCache<ListingView[]>(30_000);

export function loadListingViews(net: Network, teamAccounts: readonly string[]): Promise<ListingView[]> {
  return cached(net, async () => {
    const listings = await new ArrowViews(net, CONTRACTS[net]).listings({ from: 0, limit: 50 });
    return sortListingViews(listings.map((l) => toListingView(l, teamAccounts)));
  });
}
