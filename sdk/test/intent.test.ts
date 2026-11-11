// WS4-T04 acceptance: the ERC-191 transfer intent (offline), plus the live unfunded simulate (ARROW_E2E=1).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  arrowTransferIntent, buildAndSignTransfer, buildPayload, MIN_GAS_NOTIFY, NETWORKS, scalarFromLabel, signPayloadViem, signRawErc191, simulateIntents,
} from "../src/index.ts";
import { decodeNonce } from "./helpers/nonce.ts";

const account = privateKeyToAccount(`0x${scalarFromLabel("arrow:test:intent:v1")}`);
const signer = account.address.toLowerCase();
const SALT = Uint8Array.of(0x25, 0x28, 0x12, 0xb3);
const NONCE_BYTES = Uint8Array.from({ length: 15 }, (_, i) => i + 1);
const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const USDC = NETWORKS.mainnet.usdcToken;
const MSG = JSON.stringify({ op: "buy", listing_id: 7, buyer_pk: "04" + "ab".repeat(64) });
const transfer = () => arrowTransferIntent({ receiverId: "arrow-market.near", tokenId: USDC, amount: "250000", msg: MSG });

describe("intent builder", () => {
  it("transfer_payload_shape", async () => {
    const payload = buildPayload({ signer: account.address, intents: [transfer()], salt: SALT, now: NOW, nonceRandomBytes: NONCE_BYTES });
    const mp = await signPayloadViem(payload, account);
    const signed = JSON.parse(mp.payload);
    expect(signed.signer_id).toBe(signer);
    expect(signed.signer_id).toBe(signed.signer_id.toLowerCase());
    expect(signed.verifying_contract).toBe("intents.near");
    expect(signed.deadline).toBe(new Date(NOW + 600_000).toISOString());
    expect(signed.intents).toEqual([
      { intent: "transfer", receiver_id: "arrow-market.near", tokens: { [USDC]: "250000" }, msg: MSG, min_gas: "300000000000000" },
    ]);
    expect(Object.keys(signed)).toEqual(["signer_id", "verifying_contract", "deadline", "nonce", "intents"]);
  });

  it("nonce is salted, outlives the intent by a minute and keeps the given random bytes", () => {
    const payload = buildPayload({ signer: signer, intents: [transfer()], salt: SALT, now: NOW, nonceRandomBytes: NONCE_BYTES });
    const n = decodeNonce(payload.nonce);
    expect(Array.from(n.salt)).toEqual(Array.from(SALT));
    expect(n.deadlineMs).toBe(NOW + 600_000 + 60_000);
    expect(Array.from(n.random)).toEqual(Array.from(NONCE_BYTES));
    const again = buildPayload({ signer: signer, intents: [transfer()], salt: SALT, now: NOW, nonceRandomBytes: NONCE_BYTES });
    expect(again).toEqual(payload);
  });

  it("every build gets a fresh nonce unless the bytes are pinned", () => {
    const a = buildPayload({ signer, intents: [transfer()], salt: SALT });
    const b = buildPayload({ signer, intents: [transfer()], salt: SALT });
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("lowercases a checksum address for signer_id", () => {
    expect(account.address).not.toBe(signer); // the test account has mixed-case checksum letters
    expect(buildPayload({ signer: account.address, intents: [transfer()], salt: SALT }).signer_id).toBe(signer);
  });

  it("erc191_signature_recovers_signer", async () => {
    let raw = "" as `0x${string}`;
    const capturing = {
      address: account.address,
      signMessage: async (a: { message: string }) => (raw = await account.signMessage(a as any)),
    } as typeof account;
    const payload = buildPayload({ signer, intents: [transfer()], salt: SALT });
    const mp = await signPayloadViem(payload, capturing);
    expect(raw).toMatch(/^0x[0-9a-f]{130}$/);
    expect(await recoverMessageAddress({ message: mp.payload, signature: raw })).toBe(account.address);
  });

  it("multipayload_standard_is_erc191", async () => {
    const mp = await signPayloadViem(buildPayload({ signer, intents: [transfer()], salt: SALT }), account);
    expect(mp.standard).toBe("erc191");
    expect(mp.signature.startsWith("secp256k1:")).toBe(true);
    expect(typeof mp.payload).toBe("string");
  });

  it("sign_raw_signs_the_given_string_byte_for_byte", async () => {
    let seen: unknown;
    const capturing = { address: account.address, signMessage: async (a: { message: string }) => ((seen = a.message), account.signMessage(a as any)) } as typeof account;
    const payload = '{ "signer_id" : "x",  "intents":[] }'; // odd spacing must survive: no JSON round trip
    const mp = await signRawErc191(payload, capturing);
    expect(seen).toBe(payload);
    expect(mp).toMatchObject({ standard: "erc191", payload });
    expect(mp.signature.startsWith("secp256k1:")).toBe(true);
  });

  it("deadline_default_10min", () => {
    const before = Date.now();
    const p = buildPayload({ signer, intents: [transfer()], salt: SALT });
    const secs = (Date.parse(p.deadline) - before) / 1000;
    expect(secs).toBeGreaterThanOrEqual(599);
    expect(secs).toBeLessThanOrEqual(601);
  });

  it("transfer intent fields: msg brings min_gas, no msg brings none, minGas overrides", () => {
    expect(MIN_GAS_NOTIFY).toBe("300000000000000");
    const plain = arrowTransferIntent({ receiverId: "x.near", tokenId: USDC, amount: "1" });
    expect(plain).toEqual({ intent: "transfer", receiver_id: "x.near", tokens: { [USDC]: "1" } });
    expect(arrowTransferIntent({ receiverId: "x.near", tokenId: USDC, amount: "1", msg: "{}", minGas: "50000000000000" }).min_gas).toBe("50000000000000");
  });
});

// Live, free: a view call on mainnet with a throwaway unfunded key (never written anywhere). Run with ARROW_E2E=1.
describe.skipIf(!process.env.ARROW_E2E)("simulate (network)", () => {
  it("simulate_unfunded_balance_error_only", async () => {
    const fresh = privateKeyToAccount(generatePrivateKey());
    const intent = arrowTransferIntent({ receiverId: "arrow-spike.arrowhq.near", tokenId: USDC, amount: "10000", msg: '{"op":"probe","n":1}' });
    const { multipayload } = await buildAndSignTransfer({ signer: fresh, intents: [intent] });
    const err = await simulateIntents([multipayload]).then(() => "", (e: Error) => e.message);
    expect(err).toMatch(/insufficient balance or overflow|account '0x[0-9a-f]{40}' not found/);
    expect(err).not.toMatch(/invalid signature|public key|invalid nonce|invalid salt|deadline|wrong verifying_contract|JSON:/);
  }, 60_000);
});

describe("X12-T06: deadlines from chain time", () => {
  it("a computer clock 15 min slow still signs a deadline 10 min past the chain's time", async () => {
    const chain = Date.UTC(2026, 10, 12, 10, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(chain - 15 * 60_000);
    const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      const result = method === "block" ? { header: { timestamp_nanosec: (BigInt(chain) * 1_000_000n).toString() } } : { result: bytes("252812b3") };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result }));
    }));
    try {
      const { payload } = await buildAndSignTransfer({ signer: account, intents: [transfer()] });
      expect(Date.parse(payload.deadline)).toBeGreaterThan(chain + 9 * 60_000);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe("R2-7: no list intent pays out to the market contract", () => {
  it("throws before signing when payout is the receiver; another payout is fine", () => {
    const msg = (payout: string) => JSON.stringify({ op: "list", payout });
    const p = { receiverId: NETWORKS.mainnet.contract, tokenId: NETWORKS.mainnet.usdcToken, amount: "100000" };
    expect(() => arrowTransferIntent({ ...p, msg: msg(NETWORKS.mainnet.contract) })).toThrow(/payout/);
    expect(arrowTransferIntent({ ...p, msg: msg("seller.near") }).receiver_id).toBe(NETWORKS.mainnet.contract);
  });
});
