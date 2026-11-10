import type { Listing } from "@arrow/sdk/schemas";
import { displayTitle, labelOf, type ListingLabel } from "../labels.ts";

export interface ListingView extends Listing {
  label: ListingLabel;
  displayTitle: string;
  budget: { bitsPerEval: number; maxEvals: number; evalsUsed: number; spentBits: number; budgetBits: number; leftBits: number };
}

/** DEC A.1 G1: bits = milli / 1000, spent = evals_used * bits_per_eval. The counter never decreases, not even on refunds. */
export function toListingView(l: Listing, teamAccounts: readonly string[]): ListingView {
  const per = l.bits_per_eval_milli;
  return {
    ...l,
    label: labelOf(l, teamAccounts),
    displayTitle: displayTitle(l.title),
    budget: {
      bitsPerEval: per / 1000,
      maxEvals: l.max_evals,
      evalsUsed: l.evals_used,
      spentBits: (l.evals_used * per) / 1000,
      budgetBits: (l.max_evals * per) / 1000,
      leftBits: (Math.max(0, l.max_evals - l.evals_used) * per) / 1000,
    },
  };
}

/**
 * Small time-based cache: a fresh entry is returned as is, the loader runs again once it is older than ttlMs.
 * It holds at most `maxEntries` keys (the oldest is dropped first), because /api/listings builds keys from the query string.
 */
export function ttlCache<T>(ttlMs: number, now: () => number = Date.now, maxEntries = 200) {
  const m = new Map<string, { at: number; value: T }>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = m.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    m.delete(key); // re-insert so Map order stays oldest-first
    m.set(key, { at: now(), value });
    if (m.size > maxEntries) m.delete(m.keys().next().value as string);
    return value;
  };
}
