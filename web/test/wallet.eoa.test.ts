import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { suggestTopUp, topUpErrorMessage } from "../lib/topup.ts";
import { assertEoa, EOA_CHALLENGE, NotEoaError, watchAccounts } from "../lib/wallet.ts";

const acct = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("assertEoa (X12-accounts-1)", () => {
  it("accepts an account whose signature recovers to its address, and remembers it", async () => {
    const storage = memory();
    let prompts = 0;
    const sign = async (m: string) => (prompts++, acct.signMessage({ message: m }));
    await assertEoa({ address: acct.address, sign, storage });
    await assertEoa({ address: acct.address, sign, storage });
    expect(prompts).toBe(1);
  });
  it("rejects a signature from another key", async () => {
    await expect(assertEoa({ address: acct.address, sign: (m) => other.signMessage({ message: m }) })).rejects.toBeInstanceOf(NotEoaError);
  });
  it("rejects a 200-byte ERC-1271 style blob", async () => {
    await expect(assertEoa({ address: acct.address, sign: async () => ("0x" + "ab".repeat(200)) as `0x${string}` })).rejects.toBeInstanceOf(NotEoaError);
  });
  it("a user who rejects the prompt is not told their wallet is a contract", async () => {
    const rejected = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await expect(assertEoa({ address: acct.address, sign: async () => { throw rejected; } })).rejects.not.toBeInstanceOf(NotEoaError);
  });
  it("signs the fixed challenge", async () => {
    let seen = "";
    await assertEoa({ address: acct.address, sign: async (m) => ((seen = m), acct.signMessage({ message: m })) });
    expect(seen).toBe(EOA_CHALLENGE);
  });
});

describe("watchAccounts (QA-14)", () => {
  it("reports a switched account and a disconnect, and stops after unsubscribe", () => {
    const handlers: Array<(a: unknown) => void> = [];
    const eth = { on: (_e: string, h: (a: unknown) => void) => void handlers.push(h), removeListener: (_e: string, h: (a: unknown) => void) => void handlers.splice(handlers.indexOf(h), 1) };
    const seen: Array<string | null> = [];
    const off = watchAccounts((n) => seen.push(n), eth as never);
    handlers[0]!(["0xABCDEF0000000000000000000000000000000001"]);
    handlers[0]!([]);
    expect(seen).toEqual(["0xabcdef0000000000000000000000000000000001", null]);
    off();
    expect(handlers).toHaveLength(0);
  });
});

describe("suggestTopUp (QA-11)", () => {
  it("adds the swap's loss before rounding: sending exactly the missing amount would arrive short", () => {
    expect(suggestTopUp(1_000_000n, 0n)).toBeGreaterThan(1_000_000n);
    for (const missing of [1n, 250_000n, 495_000n, 500_000n, 1_000_000n, 1_999_999n]) {
      expect((suggestTopUp(missing, 0n) * 995n) / 1000n).toBeGreaterThanOrEqual(missing);
    }
  });
  it("keeps the 0.50 minimum and step", () => {
    expect(suggestTopUp(10n, 10n)).toBe(500_000n);
    expect(suggestTopUp(2_000_000n, 1_700_000n)).toBe(500_000n);
  });
});

describe("topUpErrorMessage (QA-17)", () => {
  it("names the missing Base ETH instead of the raw RPC text", () => {
    expect(topUpErrorMessage(new Error("insufficient funds for gas * price + value"), "x")).toMatch(/no ETH on Base/);
    expect(topUpErrorMessage(new Error("User rejected the request"), "x")).toMatch(/rejected/);
    expect(topUpErrorMessage(new Error("boom"), "The top-up did not complete.")).toBe("The top-up did not complete. (boom)");
  });
});
