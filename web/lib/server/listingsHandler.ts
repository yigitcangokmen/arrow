import { ArrowViews } from "@arrow/sdk/contract";
import { RpcError } from "@arrow/sdk/rpc";
import type { Listing } from "@arrow/sdk/schemas";
import { CONTRACTS, DEFAULT_NETWORK, type Network } from "../config.ts";
import { apiError, json } from "./http.ts";
import { toListingView, ttlCache, type ListingView } from "./listingsCache.ts";

export interface ListingsDeps {
  views(net: Network): Pick<ArrowViews, "listing" | "listings">;
  teamAccounts: readonly string[];
  cached: (key: string, load: () => Promise<Listing[]>) => Promise<Listing[]>;
}

const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=30";

export const realListingsDeps = (teamAccounts: readonly string[]): ListingsDeps => ({
  views: (net) => new ArrowViews(net, CONTRACTS[net]),
  teamAccounts,
  cached: ttlCache<Listing[]>(30_000),
});

const int = (v: string | null, def: number, min: number, max: number): number | null => {
  if (v === null) return def;
  return /^\d{1,9}$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
};

export async function handleListings(req: Request, d: ListingsDeps): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const netParam = q.get("network");
  if (netParam !== null && netParam !== "mainnet" && netParam !== "testnet") return apiError(400, "BAD_REQUEST", "network must be mainnet or testnet");
  const net: Network = (netParam as Network | null) ?? DEFAULT_NETWORK;

  const id = q.get("id");
  const from = int(q.get("from"), 0, 0, 999_999_999);
  const limit = int(q.get("limit"), 50, 1, 50);
  if (id !== null && !/^\d{1,9}$/.test(id)) return apiError(400, "BAD_REQUEST", "id must be a listing number");
  if (from === null || limit === null) return apiError(400, "BAD_REQUEST", "from must be >= 0 and limit 1..50");

  const views = d.views(net);
  let listings: Listing[];
  try {
    listings = await d.cached(id !== null ? `${net}:id:${id}` : `${net}:${from}:${limit}`, async () =>
      id !== null ? [await views.listing(id)].filter((l): l is Listing => l !== null) : views.listings({ from, limit }),
    );
  } catch (e) {
    const detail = e instanceof RpcError ? e.message.slice(0, 300) : undefined;
    return apiError(502, "RPC_ERROR", "Could not read the listings from NEAR RPC.", { detail });
  }
  const out: ListingView[] = listings.map((l) => toListingView(l, d.teamAccounts));
  return json(200, { network: net, contract: CONTRACTS[net], listings: out }, { "cache-control": CACHE_CONTROL });
}
