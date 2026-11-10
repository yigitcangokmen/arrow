import { describe, expect, it, vi } from "vitest";
import { BASE_USDC_ASSET, NETWORKS, SOL_USDC_ASSET } from "@arrow/sdk/config";
import { outboundQuoteRequest, type StatusResponse } from "@arrow/sdk/oneclick";
import { fetchListings } from "../lib/listingsClient.ts";
import { isSolanaAddress, listingsOf, looksLikeMissingTokenAccount, parseWithdrawal, WithdrawInputError } from "../lib/seller.ts";
import { destinationTxHash, erc191Payload, watchSwap } from "../lib/swap.ts";
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
    expect(ok).toHaveBeenCalledWith("/api/listings?network=testnet&from=0&limit=50");
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: "Could not read", code: "RPC_ERROR" }), { status: 502 }));
    await expect(fetchListings("mainnet", bad as never)).rejects.toThrow("Could not read");
  });
});
