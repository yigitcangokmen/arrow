// Idempotency for /api/relay (RELAY-3): the same signed payload is executed once and always gets the same answer.
// In memory, per server instance. intents.near rejects a used nonce anyway, so another instance can never execute it
// a second time; this store makes the answer repeatable, and shares one execution between concurrent requests.
export interface Snap {
  status: number;
  body: string;
  headers: Record<string, string>;
}

interface Entry {
  at: number;
  run: Promise<Snap>;
  settled?: Snap;
}

export class RelayRuns {
  private readonly m = new Map<string, Entry>();
  constructor(private readonly o: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {}

  /**
   * Runs `work` once per key. It resolves to the snapshot to remember and whether to keep it (an answer after the transaction
   * was broadcast is kept; an answer that proves nothing was sent is not, so the payload can be retried).
   * A caller waits at most `waitMs` for the result and gets `slow` if it is not there yet; the work carries on and a later
   * request for the same key gets its real result.
   */
  async run(key: string, work: () => Promise<{ snap: Snap; keep: boolean }>, waitMs: number, slow: Snap): Promise<Snap> {
    const now = this.o.now ?? Date.now;
    let e = this.m.get(key);
    if (e && now() - e.at >= (this.o.ttlMs ?? 70 * 60_000)) {
      this.m.delete(key);
      e = undefined;
    }
    if (!e) {
      const entry: Entry = { at: now(), run: undefined as unknown as Promise<Snap> };
      entry.run = work().then(
        ({ snap, keep }) => {
          if (keep) entry.settled = snap;
          else if (this.m.get(key) === entry) this.m.delete(key);
          return snap;
        },
        (err) => {
          if (this.m.get(key) === entry) this.m.delete(key);
          throw err;
        },
      );
      this.m.set(key, entry);
      if (this.m.size > (this.o.maxEntries ?? 2000)) this.m.delete(this.m.keys().next().value as string);
      e = entry;
    }
    if (e.settled) return e.settled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Snap>((res) => (timer = setTimeout(() => res(slow), waitMs)));
    try {
      return await Promise.race([e.run, late]);
    } finally {
      clearTimeout(timer);
    }
  }
}
