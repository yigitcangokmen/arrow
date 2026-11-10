import type { ArrowViews } from "@arrow/sdk/contract";
import type { Listing } from "@arrow/sdk/schemas";

const PAGE = 50;

/**
 * Every listing, oldest first. get_listings(from_index) takes a listing id, not an offset, and returns at most 50, so the next
 * page starts after the last id seen. A single call (from 0) only ever showed ids 1 to 50 (QA-06, STATE-8).
 * `maxPages` bounds the work of one request (1000 listings).
 */
export async function pageAllListings(views: Pick<ArrowViews, "listings">, maxPages = 20): Promise<Listing[]> {
  const out: Listing[] = [];
  let from = 1;
  for (let i = 0; i < maxPages; i++) {
    const page = await views.listings({ from, limit: PAGE });
    out.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE || !last) break;
    from = Number(last.id) + 1;
  }
  return out;
}
