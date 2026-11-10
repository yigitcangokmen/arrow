import { describe, expect, it } from "vitest";
import { buyGate, canInspectAgain, neededFor, showBuy } from "../lib/buyState.ts";

const fee = 250_000n;
const price = 2_000_000n;
const base = { evalFee: fee, price, mayBuy: true, verdictIn: false, exhausted: false, bought: false };

describe("neededFor (QA-10)", () => {
  it("before the verdict: fee plus price when the buyer may buy", () => {
    expect(neededFor(base)).toBe(fee + price);
    expect(neededFor({ ...base, mayBuy: false })).toBe(fee);
  });
  it("after the verdict the fee is spent: a buyer holding exactly the price is not asked to top up", () => {
    expect(neededFor({ ...base, verdictIn: true })).toBe(price);
  });
  it("a buy-only listing needs the price only; after the purchase nothing", () => {
    expect(neededFor({ ...base, exhausted: true })).toBe(price);
    expect(neededFor({ ...base, bought: true, verdictIn: true })).toBe(0n);
  });
});

describe("showBuy (QA-04, X12-tabs-4)", () => {
  const ok = { vk: true, bought: false, readOnly: false, wrongDomain: false, locked: false };
  it("exists without a verdict from this tab: exhausted budget, refunded inspection, reload", () => {
    expect(showBuy(ok)).toBe(true);
  });
  it("needs the viewing key and a writable, matching, unlocked page; not after buying", () => {
    expect(showBuy({ ...ok, vk: false })).toBe(false);
    expect(showBuy({ ...ok, bought: true })).toBe(false);
    expect(showBuy({ ...ok, readOnly: true })).toBe(false);
    expect(showBuy({ ...ok, wrongDomain: true })).toBe(false);
    expect(showBuy({ ...ok, locked: true })).toBe(false);
  });
});

describe("buyGate", () => {
  it("BUY pays directly, PASS asks, no verdict asks with its own wording", () => {
    expect(buyGate({ verdict: "BUY" })).toBe("direct");
    expect(buyGate({ verdict: "PASS" })).toBe("pass");
    expect(buyGate(null)).toBe("unverified");
  });
});

describe("canInspectAgain (QA-04)", () => {
  it("is open after a refund or a refusal, closed after a verdict or while busy", () => {
    expect(canInspectAgain({ busy: false, verdictIn: false })).toBe(true);
    expect(canInspectAgain({ busy: false, verdictIn: true })).toBe(false);
    expect(canInspectAgain({ busy: true, verdictIn: false })).toBe(false);
  });
});

import { announceText, whyNotInspect } from "../lib/buyState.ts";

describe("whyNotInspect (A11Y-6)", () => {
  const ready = { readOnly: false, programKeyMissing: false, wrongDomain: false, vk: true, lowBalance: false, exhausted: false, criteriaEmpty: false, busy: false, verdictIn: false, paymentPending: false, blockers: [] };
  it("is empty when Inspect is on", () => {
    expect(whyNotInspect(ready)).toEqual([]);
  });
  it("names the missing criteria text, the key and an unconfirmed payment", () => {
    expect(whyNotInspect({ ...ready, criteriaEmpty: true }).join(" ")).toMatch(/step 3/);
    expect(whyNotInspect({ ...ready, vk: false }).join(" ")).toMatch(/viewing key/);
    expect(whyNotInspect({ ...ready, paymentPending: true }).join(" ")).toMatch(/not confirmed/);
    expect(whyNotInspect({ ...ready, blockers: ["The market is paused."] })).toEqual(["The market is paused."]);
  });
});

describe("announceText (A11Y-1)", () => {
  const idle = { waiting: null, slow: false, outcome: null, purchaseRefund: false, saved: false, error: null };
  it("says the verdict, the refund, the wait and the saved file in words", () => {
    expect(announceText(idle)).toBe("");
    expect(announceText({ ...idle, outcome: { kind: "verdict", line: "PASS · fit 2 · novelty n/a" } })).toBe("Result: PASS · fit 2 · novelty n/a");
    expect(announceText({ ...idle, outcome: { kind: "refunded" } })).toMatch(/refunded/);
    expect(announceText({ ...idle, waiting: "inspect" })).toMatch(/45 to 120 seconds/);
    expect(announceText({ ...idle, saved: true })).toMatch(/ready to save/);
    expect(announceText({ ...idle, error: "boom" })).toBe("That step did not finish: boom");
  });
});
