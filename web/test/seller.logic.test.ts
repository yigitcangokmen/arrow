import { describe, expect, it, vi } from "vitest";
import { BASE_USDC_ASSET, NETWORKS, SOL_USDC_ASSET } from "@arrow/sdk/config";
import { outboundQuoteRequest, type StatusResponse } from "@arrow/sdk/oneclick";
import { fetchListings } from "../lib/listingsClient.ts";
import { isSolanaAddress, isSolanaWallet, listingsOf, looksLikeMissingTokenAccount, parseWithdrawal, WithdrawInputError } from "../lib/seller.ts";
import { assertWithdrawPayload, destinationTxHash, erc191Payload, watchSwap, WithdrawPayloadError } from "../lib/swap.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";

const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM = "0x1111111111111111111111111111111111111111" as const;

describe("isSolanaAddress", () => {
  it("accepts base58 of 32 to 44 characters", () => {
    expect(isSolanaAddress(SOL)).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
  });
  it("rejects 0, O, I, l, short and long strings and EVM addresses", () => {
    for (const bad of ["", "abc", SOL + "0", SOL.slice(0, 31), SOL + "AAAAAAAAAAAAA", "O" + SOL.slice(1), "l" + SOL.slice(1), EVM]) {
      expect(isSolanaAddress(bad)).toBe(false);
    }
  });
});

describe("parseWithdrawal", () => {
  it("returns base units and the trimmed address", () => {
    expect(parseWithdrawal({ solana: ` ${SOL} `, amount: "2.5", balance: 3_000_000n })).toEqual({ solana: SOL, units: 2_500_000n });
    expect(parseWithdrawal({ solana: SOL, amount: "3", balance: 3_000_000n }).units).toBe(3_000_000n);
  });
  it("refuses more than the balance by one base unit, zero, bad decimals and a bad address", () => {
    const fail = (p: Parameters<typeof parseWithdrawal>[0], re: RegExp) => {
      expect(() => parseWithdrawal(p)).toThrow(WithdrawInputError);
      expect(() => parseWithdrawal(p)).toThrow(re);
    };
    fail({ solana: SOL, amount: "3.000001", balance: 3_000_000n }, /more than your/);
    fail({ solana: SOL, amount: "0", balance: 3_000_000n }, /more than zero/);
    fail({ solana: SOL, amount: "1e3", balance: 3_000_000n }, /6 decimals/);
    fail({ solana: SOL, amount: "1.1234567", balance: 3_000_000n }, /6 decimals/);
    fail({ solana: EVM, amount: "1", balance: 3_000_000n }, /not a Solana address/);
  });
});

describe("quote shape", () => {
  it("the dry outbound quote asks for Intents USDC to Solana USDC and has no deposit address to wait for", () => {
    const req = outboundQuoteRequest({ amount: "2500000", sellerEvm: EVM, solana: SOL, dry: true });
    expect(req).toMatchObject({ dry: true, depositType: "INTENTS", recipientType: "DESTINATION_CHAIN", refundType: "INTENTS", originAsset: NETWORKS.mainnet.usdcToken, destinationAsset: SOL_USDC_ASSET, recipient: SOL, refundTo: EVM });
    expect(req.originAsset).not.toBe(BASE_USDC_ASSET);
    expect(outboundQuoteRequest({ amount: "1", sellerEvm: EVM, solana: SOL, dry: false }).dry).toBe(false);
  });
});

describe("listingsOf", () => {
  const l = (id: number, seller: string) => ({ id, seller }) as unknown as ListingView;
  it("matches the seller case-insensitively", () => {
    const all = [l(1, EVM.toUpperCase().replace("0X", "0x")), l(2, "someone.near"), l(3, EVM)];
    expect(listingsOf(all, EVM).map((x) => x.id)).toEqual([1, 3]);
    expect(listingsOf(all, "0x2222222222222222222222222222222222222222")).toEqual([]);
  });
});

describe("watchSwap", () => {
  const st = (status: StatusResponse["status"], extra: object = {}) => ({ status, updatedAt: "t", ...extra }) as StatusResponse;
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };
  it("polls to a terminal status, skipping failed polls", async () => {
    const seq: (StatusResponse | Error)[] = [new Error("net"), st("PENDING_DEPOSIT"), st("PROCESSING"), st("SUCCESS", { swapDetails: { destinationChainTxHashes: [{ hash: "5xSolSig", explorerUrl: "u" }] } })];
    let i = 0;
    const ticks: string[] = [];
    const done = await watchSwap("dep", { ...clock(), onTick: (s) => ticks.push(s.status), statusImpl: (async () => { const v = seq[i++]; if (v instanceof Error) throw v; return v; }) as never });
    expect(done?.status).toBe("SUCCESS");
    expect(ticks).toEqual(["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"]);
    expect(destinationTxHash(done)).toBe("5xSolSig");
  });
  it("stops on REFUNDED and FAILED too", async () => {
    for (const s of ["REFUNDED", "FAILED"] as const) expect((await watchSwap("dep", { ...clock(), statusImpl: (async () => st(s)) as never }))?.status).toBe(s);
  });
  it("keeps following INCOMPLETE_DEPOSIT until the limit and returns the last status", async () => {
    const c = clock();
    const done = await watchSwap("dep", { ...c, limitMs: 60_000, statusImpl: (async () => st("INCOMPLETE_DEPOSIT")) as never });
    expect(done?.status).toBe("INCOMPLETE_DEPOSIT");
    expect(c.now()).toBeGreaterThanOrEqual(60_000);
  });
  it("stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(watchSwap("dep", { ...clock(), signal: ac.signal, statusImpl: (async () => st("SUCCESS")) as never })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("destinationTxHash is null when 1Click reports none", () => {
    expect(destinationTxHash(st("SUCCESS"))).toBeNull();
    expect(destinationTxHash(null)).toBeNull();
  });
});

describe("erc191Payload", () => {
  it("returns the payload string and refuses other schemes", () => {
    expect(erc191Payload({ standard: "erc191", payload: '{"a":1}' })).toBe('{"a":1}');
    expect(() => erc191Payload({ standard: "nep413", payload: {} })).toThrow(/ERC-191 only/);
    expect(() => erc191Payload({ standard: "erc191" })).toThrow(/ERC-191 only/);
  });
});

describe("misc", () => {
  it("recognises a missing Solana token account in a quote error", () => {
    expect(looksLikeMissingTokenAccount("1Click /v0/quote: HTTP 400 recipient has no associated token account")).toBe(true);
    expect(looksLikeMissingTokenAccount("HTTP 429 slow down")).toBe(false);
  });
  it("fetchListings returns the listings array and surfaces the API error text", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ listings: [{ id: 1 }] }), { status: 200 }));
    expect(await fetchListings("testnet", ok as never)).toEqual([{ id: 1 }]);
    expect(ok).toHaveBeenCalledWith("/api/listings?network=testnet"); // no from/limit: the route answers with every listing (QA-06)
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: "Could not read", code: "RPC_ERROR" }), { status: 502 }));
    await expect(fetchListings("mainnet", bad as never)).rejects.toThrow("Could not read");
  });
});


describe("X12-accounts-4: a token account is not a wallet", () => {
  const ATA = "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B"; // the USDC token account of SOL (off the curve)
  it("isSolanaWallet is true for wallet keys and false for the token account", () => {
    expect(isSolanaWallet(SOL)).toBe(true);
    expect(isSolanaWallet(ATA)).toBe(false);
    expect(isSolanaWallet("short")).toBe(false);
    expect(isSolanaWallet("1".repeat(33))).toBe(false); // 33 bytes of zeros after decoding
  });
  it("parseWithdrawal refuses the ATA and still takes the owner", () => {
    expect(() => parseWithdrawal({ solana: ATA, amount: "1", balance: 3_000_000n })).toThrow(/token account/);
    expect(parseWithdrawal({ solana: SOL, amount: "1", balance: 3_000_000n }).solana).toBe(SOL);
  });
});

describe("CRY-1 / QA-08 / WEB-6: assertWithdrawPayload", () => {
  const USDC = NETWORKS.mainnet.usdcToken;
  const signerId = "0xb5ef360e42056049f584fd03bf0fb9b208e28387";
  const deposit = "2e821a255a4b2ca1b1cf745d3f959d9d8d009538871d2e20c3fb5fe4704b35e0";
  const now = Date.parse("2026-11-11T04:00:00Z");
  // The shape 1Click answered on mainnet (generate-intent, swap_transfer, erc191), read on 2026-11-11 without signing it.
  const recorded = () => ({
    verifying_contract: "intents.near",
    signer_id: signerId,
    deadline: "2026-11-13T21:17:31.399Z",
    nonce: "Vij2xgAlKBKzwK/mFmy35xhWd/VZtecZlZcl9II9S8o=",
    intents: [{ intent: "transfer", receiver_id: deposit, tokens: { [USDC]: "500000" } }],
  });
  const want = { signerId, depositAddress: deposit, usdcToken: USDC, units: 500_000n, now };
  const bad = (mutate: (p: any) => void, re: RegExp) => {
    const p = recorded();
    mutate(p);
    expect(() => assertWithdrawPayload(JSON.stringify(p), want)).toThrow(WithdrawPayloadError);
    expect(() => assertWithdrawPayload(JSON.stringify(p), want)).toThrow(re);
  };
  it("accepts the recorded 1Click shape", () => {
    expect(() => assertWithdrawPayload(JSON.stringify(recorded()), want)).not.toThrow();
  });
  it("accepts the 72.5 h deadline 1Click answered on mainnet on 2026-11-14 (read without signing)", () => {
    const p = recorded();
    p.deadline = new Date(now + 72.5 * 3_600_000).toISOString();
    expect(() => assertWithdrawPayload(JSON.stringify(p), want)).not.toThrow();
  });
  it("refuses an add_public_key intent (the account takeover)", () => {
    bad((p) => (p.intents = [{ intent: "add_public_key", public_key: "ed25519:attacker" }]), /intent kind add_public_key/);
  });
  it("refuses a second intent, another receiver, another amount, another token, another signer, another contract", () => {
    bad((p) => p.intents.push({ intent: "transfer", receiver_id: "evil.near", tokens: { [USDC]: "1" } }), /not exactly one intent/);
    bad((p) => (p.intents[0].receiver_id = "evil.near"), /another receiver/);
    bad((p) => (p.intents[0].tokens[USDC] = "3000000"), /another amount/);
    bad((p) => (p.intents[0].tokens = { "nep141:other.near": "500000" }), /another token/);
    bad((p) => (p.intents[0].tokens = { [USDC]: "500000", "nep141:other.near": "1" }), /another token/);
    bad((p) => (p.signer_id = "0x" + "1".repeat(40)), /another signer_id/);
    bad((p) => (p.verifying_contract = "evil.near"), /verifying contract/);
  });
  it("refuses a msg that would call a contract, an expired deadline and one far in the future", () => {
    bad((p) => (p.intents[0].msg = "{}"), /unexpected intent field msg/);
    bad((p) => (p.deadline = "2026-11-10T00:00:00Z"), /deadline/);
    bad((p) => (p.deadline = "2027-11-10T00:00:00Z"), /deadline/);
    bad((p) => (p.extra = 1), /unexpected field extra/);
  });
  it("refuses text that is not JSON", () => {
    expect(() => assertWithdrawPayload("nope", want)).toThrow(WithdrawPayloadError);
  });
});
