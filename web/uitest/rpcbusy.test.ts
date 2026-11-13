// A rate-limited testnet RPC: the home page shows calm states (or the last listings it read) and /try waits and retries, with no raw
// RPC error and no "contract is not ready" title.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BUSY = "https://rpc.testnet.near.org: HTTP 429";
const state = vi.hoisted(() => ({ last: null as null | { at: number; views: unknown[] } }));

vi.mock("next/navigation", async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@arrow/sdk/contract", () => ({
  ArrowViews: class {
    config = () => Promise.reject(new Error(BUSY));
    programPubkey = () => Promise.reject(new Error(BUSY));
    listing = () => Promise.reject(new Error(BUSY));
    eval = () => Promise.reject(new Error(BUSY));
    purchase = () => Promise.reject(new Error(BUSY));
  },
}));
vi.mock("../lib/server/listingsPage.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/server/listingsPage.ts")>()),
  loadListingViews: () => Promise.reject(new Error(BUSY)),
  lastGoodListings: () => state.last,
}));

describe("busy testnet RPC", () => {
  beforeEach(() => {
    state.last = null;
  });
  it("/try says it is retrying and offers the recorded run, not an error box", async () => {
    const { default: Try } = await import("../app/try/page.tsx");
    const html = renderToStaticMarkup(await Try({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Testnet RPC is busy, retrying.");
    expect(html).toMatch(/href="\/try\/recorded"[^>]*>Watch a recorded run/);
    expect(html).not.toContain("not ready");
    expect(html).not.toContain("HTTP 429");
  });
  it("home shows a calm listings state without the raw RPC error", async () => {
    const { default: Home } = await import("../app/page.tsx");
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("NEAR testnet is busy right now.");
    expect(html).not.toContain("HTTP 429");
    expect(html).not.toContain("Could not read the listings");
  });
  it("home falls back to the last listings it read, with the time", async () => {
    const { toListingView } = await import("../lib/server/listingsCache.ts");
    const { teamAccounts } = await import("../generated/data.ts");
    const listing = {
      id: 14, seller: teamAccounts[0], payout: teamAccounts[0], title: "[synthetic] NEAR DeFi wallet labels (1,000 rows)", public_desc: "d",
      columns: ["account_id", "label", "confidence"], rows_claimed: 1000, blob_url: "https://x.invalid/a.bin", blob_sha256: "a".repeat(64),
      sealed_k: "k", price: "2000000", eval_fee: "250000", max_evals: 50, evals_used: 2, bits_per_eval_milli: 5672, mode: "scored",
      program_hash_at_list: "p", created_at_ns: "1", status: "active",
    };
    state.last = { at: Date.UTC(2026, 10, 13, 15, 2), views: [toListingView(listing as never, teamAccounts)] };
    const { default: Home } = await import("../app/page.tsx");
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("NEAR DeFi wallet labels");
    expect(html).toContain("Last read from the chain at 15:02 UTC; NEAR testnet is busy right now.");
    expect(html).not.toContain("HTTP 429");
  });
});
