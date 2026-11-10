// RELAY-3 on the browser side: after a relay answer that does not prove "nothing was sent", the client never signs again.
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

describe("locateLatest", () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: i, pk: i === 17 ? "mine" : "other" }));
  it("finds the newest matching record without reading every id", async () => {
    let reads = 0;
    const found = await locateLatest(async (id) => (reads++, rows[id] ?? null), (r) => r.pk === "mine");
    expect(found?.id).toBe(17);
    expect(reads).toBeLessThan(23);
  });
  it("returns null for an empty space or no match", async () => {
    expect(await locateLatest(async () => null, () => true)).toBeNull();
    expect(await locateLatest(async (id) => rows[id] ?? null, (r) => r.pk === "nobody")).toBeNull();
  });
});
