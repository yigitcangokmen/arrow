import type { Listing } from "@arrow/sdk/schemas";
import { isTeamAccount } from "@arrow/sdk/team";
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
    displayTitle: displayTitle(l.title, !isTeamAccount(l.seller, teamAccounts)),
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

export class CacheBusy extends Error {
  constructor() {
    super("Too many requests are waiting for the same load. Try again in a minute.");
    this.name = "CacheBusy";
  }
}

interface CacheEntry<T> {
  at: number;
  value?: T;
  failed?: { error: unknown };
  pending?: Promise<T>;
  waiters: number;
}

/**
 * Small time-based cache: a fresh entry is returned as is, the loader runs again once it is older than ttlMs.
 * It holds at most `maxEntries` keys (the oldest is dropped first), because /api/listings builds keys from the query string.
 * Concurrent callers of one key share a single load (single-flight), at most `maxWaiters` of them; a failed load is
 * remembered for `failTtlMs` so a slow, failing source is not hit again by every reload.
 */
export function ttlCache<T>(ttlMs: number, now: () => number = Date.now, maxEntries = 200, o: { failTtlMs?: number; maxWaiters?: number } = {}) {
  const m = new Map<string, CacheEntry<T>>();
  const touch = (key: string, e: CacheEntry<T>) => {
    m.delete(key); // re-insert so Map order stays oldest-first
    m.set(key, e);
    if (m.size > maxEntries) m.delete(m.keys().next().value as string);
  };
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = m.get(key);
    if (hit?.pending) {
      if (hit.waiters >= (o.maxWaiters ?? 16)) throw new CacheBusy();
      hit.waiters++;
      return hit.pending;
    }
    if (hit && hit.value !== undefined && now() - hit.at < ttlMs) return hit.value;
    if (hit?.failed && now() - hit.at < (o.failTtlMs ?? 0)) throw hit.failed.error;
    const entry: CacheEntry<T> = { at: now(), waiters: 1 };
    entry.pending = load().then(
      (value) => {
        touch(key, { at: now(), value, waiters: 0 });
        return value;
      },
      (error: unknown) => {
        if (o.failTtlMs) touch(key, { at: now(), failed: { error }, waiters: 0 });
        else if (m.get(key) === entry) m.delete(key);
        throw error;
      },
    );
    touch(key, entry);
    return entry.pending;
  };
}
