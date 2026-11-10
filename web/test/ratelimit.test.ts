import { describe, expect, it } from "vitest";
import { dailyCounter, tokenBucket } from "../lib/ratelimit.ts";

describe("tokenBucket", () => {
  it("relay_allows_10_then_429", () => {
    let t = 0;
    const l = tokenBucket({ capacity: 10, refillEveryMs: 6_000, now: () => t });
    for (let i = 0; i < 10; i++) expect(l.take("1.2.3.4").ok).toBe(true);
    const r = l.take("1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(l.take("5.6.7.8").ok).toBe(true); // another IP has its own bucket
  });

  it("refills_after_window", () => {
    let t = 0;
    const l = tokenBucket({ capacity: 3, refillEveryMs: 1_000, now: () => t });
    for (let i = 0; i < 3; i++) l.take("k");
    expect(l.take("k").ok).toBe(false);
    t += 1_000;
    expect(l.take("k").ok).toBe(true);
    expect(l.take("k").ok).toBe(false);
    t += 10_000; // never more than capacity
    for (let i = 0; i < 3; i++) expect(l.take("k").ok).toBe(true);
    expect(l.take("k").ok).toBe(false);
  });

  it("evicts_oldest_beyond_max_keys", () => {
    const l = tokenBucket({ capacity: 1, refillEveryMs: 1_000_000, now: () => 0, maxKeys: 2 });
    l.take("a");
    l.take("b");
    l.take("c"); // evicts a
    expect(l.take("b").ok).toBe(false); // still remembered
    expect(l.take("a").ok).toBe(true); // forgotten, starts full again
  });
});

describe("dailyCounter", () => {
  it("daily_counter_resets_at_utc_midnight", () => {
    let t = Date.UTC(2026, 10, 11, 23, 59, 0);
    const c = dailyCounter({ max: 2, now: () => t });
    expect(c.take()).toBe(true);
    expect(c.take()).toBe(true);
    expect(c.take()).toBe(false);
    expect(c.used()).toBe(2);
    t = Date.UTC(2026, 10, 12, 0, 0, 1);
    expect(c.used()).toBe(0);
    expect(c.take()).toBe(true);
  });
});
