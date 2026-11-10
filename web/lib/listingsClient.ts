import type { Network } from "./config.ts";
import type { ListingView } from "./server/listingsCache.ts";

/** Listings from our own /api/listings (30 s cached on the server), for client components. */
export async function fetchListings(net: Network, fetchImpl: typeof fetch = fetch): Promise<ListingView[]> {
  const res = await fetchImpl(`/api/listings?network=${net}&from=0&limit=50`);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object" || !Array.isArray((body as { listings?: unknown }).listings)) {
    const msg = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof msg === "string" ? msg : `listings request failed (HTTP ${res.status})`);
  }
  return (body as { listings: ListingView[] }).listings;
}
