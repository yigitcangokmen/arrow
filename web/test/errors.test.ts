import { describe, expect, it } from "vitest";
import { PaymentRefused, SettleTimeout } from "../lib/settle.ts";
import { describeError } from "../lib/errors.ts";
import { suggestTopUp } from "../lib/topup.ts";
import { RelayRateLimited, RelayRejected, RelayUnavailable, SimulateFailed } from "@arrow/sdk/relay";
import { SellInputError } from "../lib/sell.ts";

describe("describeError", () => {
  it("maps a wallet rejection to a calm sentence", () => {
    expect(describeError(Object.assign(new Error("User rejected the request."), { code: 4001 })).message).toMatch(/rejected the request in your wallet/);
    const viem = Object.assign(new Error("denied"), { name: "UserRejectedRequestError" });
    expect(describeError(viem).message).toMatch(/Nothing was sent/);
  });
  it("keeps the relay fallback", () => {
    const d = describeError(new RelayUnavailable("relayer down", "send execute_intents yourself: <cmd>"));
    expect(d.fallback).toContain("execute_intents");
  });
  it("explains a balance failure of simulate_intents", () => {
    const d = describeError(new SimulateFailed("simulate failed", "insufficient balance of token"));
    expect(d.message).toMatch(/balance is too low/);
    expect(d.fallback).toMatch(/Add USDC/);
    expect(describeError(new SimulateFailed("simulate failed", "deadline expired")).message).toMatch(/deadline expired/);
  });
  it("covers rate limit, rejection, refusal, timeout and input errors", () => {
    expect(describeError(new RelayRateLimited("slow down", 30)).message).toMatch(/in 30 s/);
    expect(describeError(new RelayRejected("NOT_ARROW_INTENT: receiver", 403, "NOT_ARROW_INTENT")).message).toMatch(/NOT_ARROW_INTENT/);
    expect(describeError(new PaymentRefused("Arrow: E12 listing budget used up")).message).toMatch(/refused the payment/);
    expect(describeError(new SettleTimeout("eval")).message).toMatch(/may still finish/);
    expect(describeError(new SellInputError("Add a title.")).message).toBe("Add a title.");
    expect(describeError("boom").message).toBe("Something went wrong: boom");
  });
});

describe("RELAY-3 messages", () => {
  it("an unclear relay answer says do not pay again and points at Check payment, never at a pay button", () => {
    const d = describeError(new RelayRejected("long server text", 502, "RELAY_UNCLEAR"));
    expect(d.message).toMatch(/Do not pay again/);
    expect(d.message).toMatch(/Check payment/);
    expect(describeError(new RelayRejected("x", 409, "ALREADY_RELAYED")).message).toMatch(/Check payment/);
  });
  it("a busy relayer keeps its own retry text and fallback", () => {
    const d = describeError(new RelayUnavailable("The relayer is carrying another payment right now.", "self relay", "RELAYER_BUSY"));
    expect(d.message).toMatch(/carrying another payment/);
    expect(d.fallback).toBe("self relay");
  });
});

describe("suggestTopUp", () => {
  it("rounds the missing amount up to 0.50 and never goes below 0.50", () => {
    expect(suggestTopUp(100_000n, 0n)).toBe(500_000n);
    expect(suggestTopUp(350_000n, 0n)).toBe(500_000n);
    expect(suggestTopUp(1_000_001n, 0n)).toBe(1_500_000n);
    expect(suggestTopUp(350_000n, 300_000n)).toBe(500_000n);
    expect(suggestTopUp(100_000n, 5_000_000n)).toBe(500_000n);
  });
});
