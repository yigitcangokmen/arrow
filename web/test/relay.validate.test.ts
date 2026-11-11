import { describe, expect, it } from "vitest";
import { validateArrowMultipayload } from "../lib/server/relayValidate.ts";
import { NOW, SIGNER, USDC, makeMp } from "./helpers.ts";

const cfg = { contract: "arrow-market.near", usdcToken: USDC, now: NOW };

describe("validateArrowMultipayload", () => {
  it.each(["list", "eval", "buy"] as const)("accepts a valid %s", (op) => {
    expect(validateArrowMultipayload(makeMp(op), cfg)).toMatchObject({ ok: true, signerId: SIGNER, op, amount: 2_000_000n, listingId: op === "list" ? null : 7 });
  });

  it("R2-7: a list whose payout is the market contract is refused (the contract would panic E04 after the gas is spent)", () => {
    const msg = { ...JSON.parse((JSON.parse(makeMp("list").payload).intents[0] as { msg: string }).msg), payout: "arrow-market.near" };
    expect(validateArrowMultipayload(makeMp("list", { msg }), cfg)).toMatchObject({ ok: false, status: 400, code: "BAD_REQUEST" });
  });

  it.each([
    ["wrong receiver_id", { intent: { receiver_id: "attacker.near" } }, 403],
    ["a second token", { intent: { tokens: { [USDC]: "1", "nep141:other.near": "1" } } }, 403],
    ["a different token", { intent: { tokens: { "nep141:other.near": "1" } } }, 403],
    ["op withdraw", { msg: { op: "withdraw", listing_id: 1 } }, 403],
    ["a non-transfer intent", { intent: { intent: "token_diff" } }, 403],
    ["no min_gas", { intent: { min_gas: undefined } }, 403],
    ["msg that is not JSON", { intent: { msg: "hello" } }, 403],
    ["no msg", { intent: { msg: undefined } }, 403],
    ["wrong verifying_contract", { payload: { verifying_contract: "evil.near" } }, 403],
    ["a past deadline", { payload: { deadline: new Date(NOW - 1000).toISOString() } }, 400],
    ["a deadline over 60 minutes out", { payload: { deadline: new Date(NOW + 61 * 60_000).toISOString() } }, 400],
    ["an upper-case signer_id", { payload: { signer_id: SIGNER.toUpperCase().replace("0X", "0x") } }, 400],
    ["standard nep413", { standard: "nep413" }, 400],
  ])("refuses %s", (_name, o, status) => {
    const mp = makeMp("eval", o as any);
    // `undefined` overrides must disappear from the JSON, which stringify does on its own
    const r = validateArrowMultipayload(mp, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(status);
  });

  it("refuses two intents", () => {
    const mp = makeMp("eval");
    const p = JSON.parse(mp.payload);
    p.intents.push(p.intents[0]);
    const r = validateArrowMultipayload({ ...mp, payload: JSON.stringify(p) }, cfg);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a msg with an unknown field (deny_unknown_fields on chain)", () => {
    const r = validateArrowMultipayload(makeMp("buy", { msg: { op: "buy", listing_id: 1, buyer_pk: "04" + "a".repeat(128), extra: 1 } }), cfg);
    expect(r).toMatchObject({ ok: false, status: 403, code: "NOT_ARROW_INTENT" });
  });
});
