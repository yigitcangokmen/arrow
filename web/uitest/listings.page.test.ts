// /listings: every listing, newest first, each linked to its page, with outside and stale ones labelled rather than dropped.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Listing } from "@arrow/sdk/schemas";
import { toListingView } from "../lib/server/listingsCache.ts";
import { markStale } from "../lib/server/listingsPage.ts";

const base = (over: Partial<Listing> & { id: number }): Listing => ({
  seller: "arrowhq.testnet", title: "[synthetic] A", public_desc: "Daily units.", columns: ["a", "b", "c"], rows_claimed: 1000,
  blob_url: "https://x.example/b.bin", blob_sha256: "ab".repeat(32), sealed_k: "k", price: "250000", eval_fee: "100000",
  max_evals: 50, evals_used: 0, bits_per_eval_milli: 5673, mode: "scored", created_at_ns: "1000", program_hash_at_list: "aa", ...over,
});
const team = ["arrowhq.testnet"];
const views = markStale([
  toListingView(base({ id: 1, title: "[synthetic] Old file", program_hash_at_list: "old" }), team),
  toListingView(base({ id: 14, title: "[synthetic] Wallet labels" }), team),
  toListingView(base({ id: 16, seller: "someone.testnet", title: "Sales" }), team),
], "aa");

vi.mock("../lib/server/listingsPage.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/server/listingsPage.ts")>()),
  loadListingViews: () => Promise.resolve(views),
}));

describe("/listings", () => {
  it("shows every listing newest first, links each to its page and labels the outside and stale ones", async () => {
    const { default: Listings } = await import("../app/listings/page.tsx");
    const html = renderToStaticMarkup(await Listings({ searchParams: Promise.resolve({}) }));
    const ids = [...html.matchAll(/id="l-(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([16, 14, 1]);
    expect(html).toMatch(/<h3[^>]*><a[^>]*href="\/buy\/16"[^>]*><bdi>Sales<\/bdi>/);
    expect(html).toMatch(/href="\/buy\/14"/);
    expect(html).toContain("external seller");
    expect(html).toContain("Sealed to an older enclave program");
    expect(html).toContain("3 datasets on");
    expect(html).toContain("1 from outside sellers.");
  });
});
