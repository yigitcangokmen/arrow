// @vitest-environment happy-dom
// The /buy page in a DOM with the network, the wallet and the enclave replaced by fakes: A11Y-1 (the verdict is announced by a
// region that already exists), A11Y-3 (focus), QA-04 / X12-tabs-4 (Buy exists on a buy-only listing and after a reload),
// QA-02 (a paid inspection comes back after a reload), QA-10 (balance exactly the price after the fee), RELAY-3 (a second
// click while a payment is unconfirmed never reaches the wallet).
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Eoa } from "../lib/wallet.ts";
import type { Listing } from "@arrow/sdk/schemas";
import { toListingView } from "../lib/server/listingsCache.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUYER_PK = "04" + "ab".repeat(64);
const eoa = { address: "0xB5EF360E42056049F584FD03BF0FB9B208E28387", intentsId: "0xb5ef360e42056049f584fd03bf0fb9b208e28387" } as unknown as Eoa;
const state = { balance: 5_000_000n, verdict: { verdict: "PASS" as const, fit: 2, novelty: 3 }, evalRecord: { status: "done", buyer_pk: BUYER_PK, sealed_result: "x", h: null as string | null, refund_reason: null }, paid: [] as unknown[] };

vi.mock("../lib/balance.ts", () => ({ intentsUsdcBalance: async () => state.balance }));
vi.mock("../lib/wallet.ts", async (orig) => ({ ...(await orig<typeof import("../lib/wallet.ts")>()), connectEoa: async () => eoa, watchAccounts: () => () => undefined }));
vi.mock("@arrow/sdk/viewingKey", () => ({ deriveViewingKeyEoa: async () => ({ buyerPk: BUYER_PK, scalarHex: "cd".repeat(32) }) }));
vi.mock("@arrow/sdk/contract", () => ({
  ArrowViews: class {
    eval = async () => state.evalRecord;
    purchase = async () => null;
  },
}));
vi.mock("@arrow/sdk/flows", async (orig) => ({ ...(await orig<typeof import("@arrow/sdk/flows")>()), decodeEvalResult: () => state.verdict, prepareBuy: () => "{}" }));
vi.mock("../lib/buy.ts", async (orig) => ({ ...(await orig<typeof import("../lib/buy.ts")>()), buildEvalMsg: () => "{}" }));
vi.mock("../lib/settle.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/settle.ts")>()),
  findEvent: async () => ({ eval_id: 5, left_milli: 40_000 }),
  waitForRecord: async (_w: string, read: () => Promise<unknown>) => read(),
}));
const pay = vi.hoisted(() => ({ calls: 0, fail: null as null | "unclear" }));
vi.mock("../lib/pay.ts", async (orig) => {
  const real = await orig<typeof import("../lib/pay.ts")>();
  const { browserStorage, historyStore, pendingStore } = await import("../lib/pending.ts");
  return {
    ...real,
    payWithIntent: async (e: Eoa, a: { kind: "list" | "eval" | "buy"; listingId: number | null; amount: bigint; msg: string; meta?: { hadList?: boolean } }) => {
      pay.calls++;
      const storage = browserStorage();
      const at = Date.now() + pay.calls;
      if (pay.fail === "unclear") {
        const pending = { v: 1 as const, kind: a.kind, listingId: a.listingId, signerId: e.intentsId, amount: a.amount.toString(), multipayload: { standard: "erc191" as const, payload: "{}", signature: "s" }, deadlineMs: Date.now() + 600_000, nonce: "n", createdAt: at };
        pendingStore(storage).put("mainnet", pending);
        throw new real.PaymentUnclear(pending, new Error("502"));
      }
      historyStore(storage).add("mainnet", e.intentsId, { v: 1, kind: a.kind, listingId: a.listingId ?? 0, tx: { txHash: "TX" + pay.calls, signerId: "r.near" }, resultId: null, at, ...(a.meta ? { meta: a.meta } : {}) });
      return { txHash: "TX" + pay.calls, signerId: "r.near", at };
    },
  };
});

const { BuyFlow } = await import("../app/buy/[id]/BuyFlow.tsx");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  state.balance = 5_000_000n;
  state.verdict = { verdict: "PASS", fit: 2, novelty: 3 };
  state.evalRecord = { status: "done", buyer_pk: BUYER_PK, sealed_result: "x", h: null, refund_reason: null };
  pay.calls = 0;
  pay.fail = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (text: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")));
const click = async (b: Element | undefined) => {
  expect(b, "button exists").toBeDefined();
  await act(async () => (b as HTMLElement).click());
};
const typeInto = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const announcer = () => host.querySelector("[data-announcer]")!.textContent;

const listingFixture = (over: Partial<Listing>): Listing =>
  ({
    id: 7, seller: "someone.near", title: "[synthetic] Sales sample", public_desc: "d", columns: ["a", "b"], rows_claimed: 100,
    blob_url: "https://example.com/blobs/x.bin", blob_sha256: "a".repeat(64), sealed_k: "x", price: "2000000", eval_fee: "250000", max_evals: 50,
    evals_used: 3, bits_per_eval_milli: 5673, mode: "scored", program_hash_at_list: "aa", created_at_ns: 1, ...over,
  }) as Listing;

async function mount(over: Partial<Listing> = {}) {
  const listing = toListingView(listingFixture(over), []);
  root = createRoot(host);
  await act(async () => root.render(h(BuyFlow, { network: "testnet", listing, programPk: "04ab", readOnly: false, blockers: { inspect: [], buy: [] } })));
}
async function connectAndKey() {
  await click(button("Connect wallet"));
  await click(button("Sign to derive my viewing key"));
}
async function inspect() {
  await typeInto(host.querySelector("#crit-text") as HTMLTextAreaElement, "unlock schedule for Q1");
  await click(button(/^Inspect · /));
}

describe("/buy in a DOM", () => {
  it("A11Y-1: the verdict is spoken by the live region that was mounted before it, and focus moves to the result", async () => {
    await mount();
    expect(announcer()).toBe("");
    await connectAndKey();
    await inspect();
    expect(announcer()).toBe("Result: PASS · fit 2 · novelty n/a"); // no list was given, so novelty is not shown as measured (SCAM-4)
    expect(document.activeElement?.id).toBe("b5");
  });

  it("A11Y-3 / QA-04: after a PASS, Buy asks first, the prompt is a labelled group and Cancel has focus; Cancel returns focus to Buy", async () => {
    await mount();
    await connectAndKey();
    await inspect();
    await click(button(/^Buy · /));
    const group = host.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-labelledby")).toBe("b6-confirm");
    expect(host.querySelector("#b6-confirm")!.textContent).toMatch(/said PASS/);
    expect(document.activeElement?.textContent).toBe("Cancel");
    await click(button("Cancel"));
    expect(document.activeElement?.textContent).toMatch(/^Buy · /);
    expect(pay.calls).toBe(1); // only the inspection was paid
  });

  it("QA-04 / X12-tabs-4: a buy-only listing (budget used up) can be bought without a verdict from this page, after a warning", async () => {
    await mount({ evals_used: 50, max_evals: 50 });
    await connectAndKey();
    expect(host.textContent).toMatch(/buying blind/);
    expect(button(/^Inspect · /)!.getAttribute("aria-disabled")).toBe("true");
    await click(button(/^Buy · /));
    expect(host.querySelector("#b6-confirm")!.textContent).toMatch(/no verdict from this page/);
  });

  it("QA-10: holding exactly the price after the inspection is not asked to top up", async () => {
    state.balance = 2_250_000n; // fee + price
    await mount();
    await connectAndKey();
    state.balance = 2_000_000n; // the fee is gone after the inspection
    await inspect();
    await click(button("Refresh"));
    expect(host.textContent).not.toContain("Add USDC from Base");
    expect(button(/^Buy · /)!.getAttribute("aria-disabled")).toBe("false");
  });

  it("QA-02: after a reload the paid inspection is listed, and 'Show result' brings the verdict back without paying again", async () => {
    await mount();
    await connectAndKey();
    await inspect();
    expect(pay.calls).toBe(1);
    await act(async () => root.unmount()); // the reload: React state is gone, localStorage stays
    await mount();
    await connectAndKey();
    expect(host.querySelector("#hist")).not.toBeNull();
    expect(host.querySelector("#b5")).toBeNull();
    await click(button("Show result"));
    expect(announcer()).toMatch(/^Result: PASS/);
    expect(pay.calls).toBe(1);
  });

  it("RELAY-3: after an unclear relay answer the Inspect button never reaches the wallet again; Check payment is offered instead", async () => {
    pay.fail = "unclear";
    await mount();
    await connectAndKey();
    await inspect();
    expect(pay.calls).toBe(1);
    expect(host.querySelector("#pend")).not.toBeNull();
    expect(button("Check payment")).toBeDefined();
    pay.fail = null;
    await click(button(/^Inspect · /));
    expect(pay.calls).toBe(1); // the click was ignored: Inspect is aria-disabled while a payment is unconfirmed
    expect(host.textContent).toMatch(/not confirmed yet/);
  });
});
