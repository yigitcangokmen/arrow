import { describe, expect, it } from "vitest";
import { toListingView } from "../lib/server/listingsCache.ts";
import { sortListingViews } from "../lib/server/listingsPage.ts";
import type { Listing } from "@arrow/sdk/schemas";

const base = (over: Partial<Listing> & { id: number }): Listing => ({
  seller: "someone.near", title: "Sales", public_desc: "Daily units.", columns: ["a", "b", "c", "d", "e", "f"], rows_claimed: 1000,
  blob_url: "https://x.example/b.bin", blob_sha256: "ab".repeat(32), sealed_k: "k", price: "250000", eval_fee: "100000",
  max_evals: 50, evals_used: 0, bits_per_eval_milli: 5673, mode: "scored", created_at_ns: "1000", ...over,
});
const team = ["arrowhq.near"];

describe("sortListingViews", () => {
  it("orders external, team-made, synthetic, then newest first", () => {
    const views = [
      toListingView(base({ id: 1, title: "[synthetic] A", created_at_ns: "5" }), team),
      toListingView(base({ id: 2, title: "[team-made] B", seller: "arrowhq.near", created_at_ns: "9" }), team),
      toListingView(base({ id: 3, title: "C", created_at_ns: "1" }), team),
      toListingView(base({ id: 4, title: "D", created_at_ns: "7" }), team),
      toListingView(base({ id: 5, title: "[synthetic] E", created_at_ns: "8" }), team),
    ];
    expect(sortListingViews(views).map((v) => v.id)).toEqual([4, 3, 2, 5, 1]);
  });
});

describe("toListingView budget", () => {
  it("derives spent and budget bits from the chain fields", () => {
    const v = toListingView(base({ id: 1, evals_used: 2 }), team);
    expect(v.budget).toMatchObject({ spentBits: 11.346, budgetBits: 283.65 });
    expect(v.budget.leftBits).toBeCloseTo(272.304, 6);
    expect(toListingView(base({ id: 2, max_evals: 2, evals_used: 2 }), team).budget.leftBits).toBe(0);
  });
});
