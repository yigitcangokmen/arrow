// The contract views the CLI and MCP read. ARROW_TEST_MOCK_RPC=<dir> swaps the network for JSON files (tests only).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ArrowViews, ConfigView, Eval, LeakBudget, Listing, type Network, publicKeyHex, Purchase, resolveNetwork, scalarFromLabel, VersionView,
} from "@arrow/sdk";

export type ViewsLike = Pick<ArrowViews, "config" | "programPubkey" | "listing" | "listings" | "eval" | "evalsByListing" | "purchase" | "leakBudget" | "version">;

/** The program key a mock run seals to (its scalar is derivable from this label, which only tests know). */
export const MOCK_PROGRAM_PK = publicKeyHex(scalarFromLabel("arrow:test:program:v1"));

export function mockViews(dir: string): ViewsLike {
  const read = <T>(name: string, schema: { parse(v: unknown): T }): T | null => {
    const f = resolve(dir, name);
    return existsSync(f) ? schema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
  };
  const same = (a: unknown, b: number | string) => Number(a) === Number(b);
  return {
    config: async () => read("config.json", ConfigView)!,
    version: async () => read("version.json", VersionView)!,
    programPubkey: async () => MOCK_PROGRAM_PK,
    listing: async (id) => {
      const l = read("listing.json", Listing);
      return l && same(l.id, id) ? l : null;
    },
    listings: async () => {
      const l = read("listing.json", Listing);
      return l ? [l] : [];
    },
    eval: async (id) => {
      const e = read("eval.json", Eval);
      return e && same(e.id, id) ? e : null;
    },
    evalsByListing: async (listingId) => {
      const e = read("eval.json", Eval);
      return e && same(e.listing_id, listingId) ? [e] : [];
    },
    purchase: async (id) => {
      const p = read("purchase.json", Purchase);
      return p && same(p.id, id) ? p : null;
    },
    leakBudget: async (id) => {
      const b = read("leak_budget.json", LeakBudget);
      return b && same(b.listing_id, id) ? b : null;
    },
  };
}

export function makeViews(network: Network, env: Record<string, string | undefined> = process.env): ViewsLike {
  const mock = env.ARROW_TEST_MOCK_RPC;
  return mock ? mockViews(resolve(mock)) : new ArrowViews(network, resolveNetwork(network, env).contract);
}
