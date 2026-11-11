// RELAY-3 on the browser side: after a relay answer that does not prove "nothing was sent", the client never signs again.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RelayRejected, RelayUnavailable } from "@arrow/sdk/relay";
import { historyStore, memoryStorage, pendingStore } from "../lib/pending.ts";
import { locateLatest } from "../lib/locate.ts";
import { type PayDeps, PaymentPending, PaymentUnclear, payOnce, provablyNotSent, resumePending } from "../lib/payFlow.ts";
import { NOW, SIGNER, makeMp } from "./helpers.ts";

const unclear = () => new RelayRejected("may or may not have gone through", 502, "RELAY_UNCLEAR");

function harness(over: Partial<PayDeps> = {}) {
  const storage = memoryStorage();
  const calls = { sign: 0, relay: [] as string[] };
  let now = NOW;
  const deps: PayDeps = {
    network: "mainnet",
    store: pendingStore(storage),
    history: historyStore(storage),
    sign: async () => (calls.sign++, makeMp("eval", { payload: { nonce: `N${calls.sign}` } })),
    relay: async (mp) => (calls.relay.push(mp.payload), { txHash: "TX1", signerId: "relayer.near" }),
    isNonceUsed: async () => false,
    now: () => now,
    ...over,
  };
  return { deps, calls, advance: (ms: number) => (now += ms), storage };
}
const req = { kind: "eval" as const, listingId: 1, signerId: SIGNER, amount: 250_000n, msg: "{}" };

describe("payOnce", () => {
  it("signs once and sends the stored payload again after RELAY_UNCLEAR, byte for byte", async () => {
    let n = 0;
    const h = harness({ relay: async (mp) => (h.calls.relay.push(mp.payload), ++n === 1 ? Promise.reject(unclear()) : { txHash: "TX2", signerId: "r.near" }) });
    await expect(payOnce(h.deps, req)).rejects.toBeInstanceOf(PaymentUnclear);
    expect(h.calls.sign).toBe(1);
    // a second click must not reach the wallet
    await expect(payOnce(h.deps, req)).rejects.toBeInstanceOf(PaymentPending);
    expect(h.calls.sign).toBe(1);
    const r = await resumePending(h.deps, SIGNER);
    expect(r).toMatchObject({ state: "paid", paid: { txHash: "TX2" } });
    expect(h.calls.relay).toHaveLength(2);
    expect(h.calls.relay[1]).toBe(h.calls.relay[0]);
    expect(h.deps.store.get("mainnet", SIGNER)).toBeNull();
    expect(h.deps.history.list("mainnet", SIGNER, 1)).toHaveLength(1);
  });

  it("a network error (fetch threw) counts as unclear, not as a failed payment", async () => {
    const h = harness({ relay: async () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(payOnce(h.deps, req)).rejects.toBeInstanceOf(PaymentUnclear);
    expect(h.deps.store.get("mainnet", SIGNER)).not.toBeNull();
  });

  it("an answer that proves nothing was sent frees the next attempt", async () => {
    const h = harness({ relay: async () => Promise.reject(new RelayUnavailable("out of gas funds", undefined)) });
    await expect(payOnce(h.deps, req)).rejects.toBeInstanceOf(RelayUnavailable);
    expect(h.deps.store.get("mainnet", SIGNER)).toBeNull();
    expect(provablyNotSent(unclear())).toBe(false);
    expect(provablyNotSent(new RelayRejected("x", 409, "ALREADY_RELAYED"))).toBe(false);
    expect(provablyNotSent(new RelayRejected("x", 502, "BAD_RESPONSE"))).toBe(false);
  });
});

describe("resumePending", () => {
  const unclearHarness = async (isNonceUsed: PayDeps["isNonceUsed"]) => {
    const h = harness({ relay: async () => Promise.reject(unclear()), isNonceUsed });
    await payOnce(h.deps, req).catch(() => undefined);
    return h;
  };

  it("stays pending before the deadline while the nonce is unused", async () => {
    const h = await unclearHarness(async () => false);
    const r = await resumePending(h.deps, SIGNER);
    expect(r.state).toBe("waiting");
    expect(h.deps.store.get("mainnet", SIGNER)).not.toBeNull();
  });

  it("releases the signature only after the deadline, with the nonce unused", async () => {
    const h = await unclearHarness(async () => false);
    h.advance(11 * 60_000);
    expect((await resumePending(h.deps, SIGNER)).state).toBe("released");
    expect(h.deps.store.get("mainnet", SIGNER)).toBeNull();
  });

  it("a used nonce means the payment happened: it is recorded and never re-signed", async () => {
    const h = await unclearHarness(async () => true);
    h.advance(11 * 60_000);
    expect((await resumePending(h.deps, SIGNER)).state).toBe("paid-no-tx");
    expect(h.deps.history.list("mainnet", SIGNER, 1)).toMatchObject([{ kind: "eval", tx: null }]);
    expect(h.calls.sign).toBe(1);
  });

  it("when the nonce check itself fails it does not release, even after the deadline", async () => {
    const h = await unclearHarness(async () => Promise.reject(new Error("rpc down")));
    h.advance(11 * 60_000);
    expect((await resumePending(h.deps, SIGNER)).state).toBe("waiting");
  });
});

describe("W2-4: every code the relay answers before it broadcasts frees the wallet", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const relayCodes = [...src("../lib/server/relayHandler.ts").matchAll(/(?:apiError\(\d+, |rateLimited\([^,)]*, )"([A-Z_]+)"/g)].map((m) => m[1]);
  const blockerCodes = [...(src("../lib/blockers.ts").match(/code: "([A-Z_]+)"/g) ?? [])].map((m) => m.slice(7, -1));
  // A landed payload re-sent can also trip these chain-state refusals, so they never prove that nothing was sent (RELAY-3).
  // payOnce's one send is the first of a payload signed a moment ago, so there they do.
  const chainState = ["ALREADY_BOUGHT", "NOTHING_TO_CHANGE", "REHOST_COOLDOWN"];
  const sentOrMaybe = new Set(["ALREADY_RELAYED", "RELAY_UNCLEAR", ...chainState]);
  it.each([...new Set([...relayCodes, ...blockerCodes, "BAD_REQUEST", "NOT_ARROW_INTENT", "RATE_LIMITED"])].filter((c) => !sentOrMaybe.has(c)))("%s", async (code) => {
    expect(provablyNotSent(new RelayRejected("x Nothing was sent.", 409, code))).toBe(true);
    const h = harness({ relay: async () => { throw new RelayRejected("x Nothing was sent.", 409, code); } });
    await expect(payOnce(h.deps, req)).rejects.not.toBeInstanceOf(PaymentUnclear);
    expect(h.deps.store.get("mainnet", SIGNER)).toBeNull();
  });
  it.each(chainState)("%s on the first send of a fresh payload frees the wallet; on a re-send it proves nothing", async (code) => {
    expect(relayCodes).toContain(code);
    expect(provablyNotSent(new RelayRejected("x Nothing was sent.", 409, code))).toBe(false);
    let n = 0;
    const h = harness({ relay: async () => { if (++n === 1) throw new RelayRejected("x Nothing was sent.", 409, code); return { txHash: "TX2", signerId: "r.near" }; } });
    const first = await payOnce(h.deps, req).catch((e) => e);
    expect(first).toBeInstanceOf(RelayRejected);
    expect(first.code).toBe(code);
    expect(h.deps.store.get("mainnet", SIGNER)).toBeNull();
    // the next payment from this wallet is signed and sent, not held as PaymentPending until the old deadline
    await expect(payOnce(h.deps, req)).resolves.toMatchObject({ txHash: "TX2" });
    expect(h.calls.sign).toBe(2);
  });
  it.each(chainState)("%s on a Check payment re-send leaves the payment pending while the nonce is unused (RELAY-3)", async (code) => {
    let n = 0;
    const h = harness({ relay: async () => { throw ++n === 1 ? unclear() : new RelayRejected("x Nothing was sent.", 409, code); } });
    await expect(payOnce(h.deps, req)).rejects.toBeInstanceOf(PaymentUnclear);
    expect((await resumePending(h.deps, SIGNER)).state).toBe("waiting");
    expect(h.deps.store.get("mainnet", SIGNER)).not.toBeNull();
  });
  it("found the blocker codes", () => expect(blockerCodes).toEqual(expect.arrayContaining(["MARKET_PAUSED", "PROGRAM_KEY_MISSING", "LISTING_STALE", "TANK_LOW"])));
});

describe("locateLatest", () => {
  // W2-1 / W2-10: contract ids start at 1 (next_*_id: 1), so get_*(0) is always None.
  const chain = new Map(Array.from({ length: 23 }, (_, i) => [i + 1, { id: i + 1, pk: i + 1 === 17 ? "mine" : "other" }]));
  const read = async (id: number) => chain.get(id) ?? null;
  it("finds the newest matching record in a 1-based id space without reading every id", async () => {
    let reads = 0;
    const found = await locateLatest(async (id) => (reads++, read(id)), (r) => r.pk === "mine");
    expect(found?.id).toBe(17);
    expect(reads).toBeLessThan(23);
  });
  it("finds the only record (id 1) and the newest one (id 23)", async () => {
    expect((await locateLatest(async (id) => (id === 1 ? { pk: "mine" } : null), (r) => r.pk === "mine"))?.id).toBe(1);
    expect((await locateLatest(read, (r) => r.id === 23))?.id).toBe(23);
  });
  it("returns null for an empty space or no match, and never reads id 0", async () => {
    expect(await locateLatest(async () => null, () => true)).toBeNull();
    const seen: number[] = [];
    expect(await locateLatest(async (id) => (seen.push(id), read(id)), (r) => r.pk === "nobody")).toBeNull();
    expect(seen).not.toContain(0);
  });
});

describe("paid history (QA-02)", () => {
  it("keeps the newest 30 records per wallet and lists those of one listing; setResultId names the record by time", () => {
    const h = historyStore(memoryStorage());
    for (let i = 0; i < 35; i++) h.add("mainnet", SIGNER, { v: 1, kind: "eval", listingId: i % 2, tx: { txHash: `T${i}`, signerId: "r" }, resultId: null, at: 1000 + i });
    expect(h.list("mainnet", SIGNER, 0).length + h.list("mainnet", SIGNER, 1).length).toBe(30);
    expect(h.list("mainnet", SIGNER, 1).at(-1)!.tx!.txHash).toBe("T33");
    h.setResultId("mainnet", SIGNER, 1034, 99);
    expect(h.list("mainnet", SIGNER, 0).at(-1)).toMatchObject({ at: 1034, resultId: 99 });
    expect(h.list("testnet", SIGNER, 1)).toEqual([]); // per network
    expect(h.list("mainnet", "0x" + "1".repeat(40), 1)).toEqual([]); // per wallet
  });
  it("a blocked or corrupt storage never throws: resume is lost, the page still works", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    const h = historyStore(broken);
    expect(h.list("mainnet", SIGNER, 1)).toEqual([]);
    expect(() => h.add("mainnet", SIGNER, { v: 1, kind: "buy", listingId: 1, tx: null, resultId: null, at: 1 })).not.toThrow();
    const p = pendingStore(broken);
    expect(p.get("mainnet", SIGNER)).toBeNull();
    expect(() => p.clear("mainnet", SIGNER)).not.toThrow();
    const corrupt = memoryStorage();
    corrupt.setItem("arrow:pending-pay:v1:mainnet:" + SIGNER, "{not json");
    expect(pendingStore(corrupt).get("mainnet", SIGNER)).toBeNull();
  });
});
