// Listings for server-rendered pages: same source and 30 s cache as /api/listings, read in-process (no HTTP hop).
import { ArrowViews } from "@arrow/sdk/contract";
import { isTeamAccount } from "@arrow/sdk/team";
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

/**
 * The home page's split: a listing is featured when it can still be inspected, a team account made it, its shown title does not
 * start with "e2e" (end-to-end test runs) and its seller is not a throwaway /try account. Everything else goes into `more`, in the
 * order it came in.
 */
export function groupHomeListings(views: readonly ListingView[], teamAccounts: readonly string[]): { featured: ListingView[]; more: ListingView[] } {
  const featured: ListingView[] = [];
  const more: ListingView[] = [];
  const ok = (v: ListingView) => v.stale !== true && isTeamAccount(v.seller, teamAccounts) && !/^e2e/i.test(v.displayTitle.trim()) && !/^try/i.test(v.seller);
  // A test run that relists a demo file under the same title must not double the demo: one card per title, the first one listed
  // (the lowest id, which the recorded runs use); the copies go into more.
  const first = new Map<string, number>();
  for (const v of views) if (ok(v)) first.set(v.displayTitle, Math.min(first.get(v.displayTitle) ?? Infinity, Number(v.id)));
  for (const v of views) (ok(v) && first.get(v.displayTitle) === Number(v.id) ? featured : more).push(v);
  return { featured, more };
}

const cached = ttlCache<ListingView[]>(30_000);
const lastGood = new Map<Network, { at: number; views: ListingView[] }>();

export function loadListingViews(net: Network, teamAccounts: readonly string[]): Promise<ListingView[]> {
  return cached(net, async () => {
    const views = new ArrowViews(net, CONTRACTS[net]);
    const [listings, cv] = await Promise.all([pageAllListings(views), views.config().catch(() => null)]);
    const hash = typeof cv?.config.program_wasm_hash === "string" ? cv.config.program_wasm_hash : null;
    const out = sortListingViews(markStale(listings.map((l) => toListingView(l, teamAccounts)), hash));
    lastGood.set(net, { at: Date.now(), views: out });
    return out;
  });
}

/** The last listings this server instance read from the chain, with when; null when it has not read any yet. For a busy RPC. */
export function lastGoodListings(net: Network): { at: number; views: ListingView[] } | null {
  return lastGood.get(net) ?? null;
}
