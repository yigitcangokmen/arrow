// In-memory limiters, per server instance (DEC L-09). The real protection is the balance caps on the relayer and
// sponsor accounts; with several instances the combined limit is higher than the numbers below.
export type Limiter = { take(key: string): { ok: boolean; retryAfterSec: number } };

/** Starts full; one token returns every `refillEveryMs`. The oldest key is dropped beyond `maxKeys`. */
export function tokenBucket(opts: { capacity: number; refillEveryMs: number; now?: () => number; maxKeys?: number }): Limiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key) {
      const t = now();
      const prev = buckets.get(key);
      let tokens = opts.capacity;
      if (prev) {
        tokens = Math.min(opts.capacity, prev.tokens + (t - prev.at) / opts.refillEveryMs);
        buckets.delete(key); // re-insert below so Map order stays oldest-first
      }
      let result: { ok: boolean; retryAfterSec: number };
      if (tokens >= 1) {
        tokens -= 1;
        result = { ok: true, retryAfterSec: 0 };
      } else {
        result = { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - tokens) * opts.refillEveryMs) / 1000)) };
      }
      buckets.set(key, { tokens, at: t });
      if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value as string);
      return result;
    },
  };
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

/** At most `max` takes per UTC day. */
export function dailyCounter(opts: { max: number; now?: () => number }): { take(): boolean; used(): number } {
  const now = opts.now ?? Date.now;
  let day = utcDay(now());
  let n = 0;
  const roll = () => {
    const d = utcDay(now());
    if (d !== day) {
      day = d;
      n = 0;
    }
  };
  return {
    take() {
      roll();
      if (n >= opts.max) return false;
      n += 1;
      return true;
    },
    used() {
      roll();
      return n;
    },
  };
}

export interface KeyedDaily {
  take(key: string): boolean;
  /** Returns one take of today, for a request that ended before anything was sent. */
  giveBack(key: string): void;
}

/** At most `max` takes per key per UTC day. Beyond `maxKeys` the oldest key is dropped. */
export function keyedDaily(opts: { max: number; now?: () => number; maxKeys?: number }): KeyedDaily {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  let day = utcDay(now());
  const counts = new Map<string, number>();
  return {
    take(key) {
      const d = utcDay(now());
      if (d !== day) {
        day = d;
        counts.clear();
      }
      const n = counts.get(key) ?? 0;
      if (n >= opts.max) return false;
      counts.delete(key);
      counts.set(key, n + 1);
      if (counts.size > maxKeys) counts.delete(counts.keys().next().value as string);
      return true;
    },
    giveBack(key) {
      const n = counts.get(key) ?? 0;
      if (n > 0 && utcDay(now()) === day) counts.set(key, n - 1);
    },
  };
}

export const limits = {
  relay: tokenBucket({ capacity: 10, refillEveryMs: 60_000 / 10 }),
  blob: tokenBucket({ capacity: 10, refillEveryMs: 3_600_000 / 10 }),
  sponsor: tokenBucket({ capacity: 3, refillEveryMs: 3_600_000 / 3 }),
  sponsorDaily: dailyCounter({ max: Number(process.env.TESTNET_SPONSOR_DAILY_MAX ?? 20) }), // DEC L-09: 20 x 0.5 tNEAR
  x402: tokenBucket({ capacity: 60, refillEveryMs: 1_000 }),
};
