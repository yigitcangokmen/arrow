// WS4-T05 acceptance: 1Click request shapes, retry/terminal-status behaviour (offline) and live dry quotes (ARROW_E2E=1).
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_USDC_ASSET, NETWORKS, SOL_USDC_ASSET } from "../src/config.ts";
import { oneclick } from "../src/index.ts";

const { inboundQuoteRequest, outboundQuoteRequest, quote, status, waitForStatus, generateIntent, submitIntent, submitDeposit, OneClickError } = oneclick;

const EVM = "0x1111111111111111111111111111111111111111" as const; // never a burn address: 1Click rejects refundTo 0x...dead
const SOLANA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // example address, used for dry quotes only
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};

afterEach(() => vi.restoreAllMocks());

describe("request shapes", () => {
  it("inbound_quote_request_shape", () => {
    const now = Date.parse("2026-11-10T08:00:00.000Z");
    const req = inboundQuoteRequest({ amount: "2000000", evm: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", dry: true, now });
    expect(req).toEqual({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 50,
      originAsset: BASE_USDC_ASSET,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: NETWORKS.mainnet.usdcToken,
      amount: "2000000",
      refundTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      refundType: "ORIGIN_CHAIN",
      recipient: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      recipientType: "INTENTS",
      deadline: "2026-11-10T08:30:00.000Z",
    });
    const live = inboundQuoteRequest({ amount: "1", evm: EVM, dry: false });
    expect(Math.abs(Date.parse(live.deadline) - (Date.now() + 30 * 60_000))).toBeLessThan(5000);
    expect(live.deadline).toBe(new Date(live.deadline).toISOString());
    expect(inboundQuoteRequest({ amount: "1", evm: EVM, dry: true, slippageBps: 100 }).slippageTolerance).toBe(100);
  });

  it("outbound_quote_request_shape", () => {
    const req = outboundQuoteRequest({ amount: "3000000", sellerEvm: "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa", solana: SOLANA, dry: true, now: 0 });
    expect(req).toEqual({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 50,
      originAsset: NETWORKS.mainnet.usdcToken,
      depositType: "INTENTS",
      destinationAsset: SOL_USDC_ASSET,
      amount: "3000000",
      refundTo: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      refundType: "INTENTS",
      recipient: SOLANA,
      recipientType: "DESTINATION_CHAIN",
      deadline: "1970-01-01T00:30:00.000Z",
    });
  });

  it("rejects_decimal_amount", () => {
    for (const amount of ["2.0", "2.5", "-1", "0", "", "1e6", "02", " 2"]) {
      expect(() => inboundQuoteRequest({ amount, evm: EVM, dry: true })).toThrow(/integer string/);
      expect(() => outboundQuoteRequest({ amount, sellerEvm: EVM, solana: SOLANA, dry: true })).toThrow(/integer string/);
    }
  });
});

describe("transport", () => {
  it("status_poll_stops_on_terminal", async () => {
    const seq = ["PENDING_DEPOSIT", "PROCESSING", "PROCESSING", "SUCCESS", "REFUNDED"];
    const fetchImpl = vi.fn(async () => json(200, { status: seq.shift(), updatedAt: "2026-11-10T08:00:00Z" })) as unknown as typeof fetch;
    const ticks: string[] = [];
    const out = await waitForStatus("0xdeposit", { fetchImpl, sleep: noSleep, everyMs: 1, onTick: (s) => ticks.push(s.status) });
    expect(out.status).toBe("SUCCESS");
    expect(ticks).toEqual(["PENDING_DEPOSIT", "PROCESSING", "PROCESSING", "SUCCESS"]);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // REFUNDED is never fetched
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("/v0/status?depositAddress=0xdeposit");
  });

  it("stops on REFUNDED and on FAILED, and times out otherwise", async () => {
    for (const terminal of ["REFUNDED", "FAILED"]) {
      const fetchImpl = vi.fn(async () => json(200, { status: terminal, updatedAt: "x" })) as unknown as typeof fetch;
      expect((await waitForStatus("d", { fetchImpl, sleep: noSleep })).status).toBe(terminal);
    }
    const stuck = vi.fn(async () => json(200, { status: "PROCESSING", updatedAt: "x" })) as unknown as typeof fetch;
    await expect(waitForStatus("d", { fetchImpl: stuck, sleep: noSleep, timeoutMs: 0, everyMs: 5 })).rejects.toThrow(/still PROCESSING/);
  });

  it("retries 429 and 5xx three times with growing waits, then gives up", async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(async () => json(503, { message: "busy" })) as unknown as typeof fetch;
    const err = await status("d", { fetchImpl, sleep: async (ms) => void waits.push(ms) }).catch((e) => e);
    expect(err).toBeInstanceOf(OneClickError);
    expect(err.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("a 4xx is final and carries the server message", async () => {
    const fetchImpl = vi.fn(async () => json(400, { message: "refundTo is not valid" })) as unknown as typeof fetch;
    const err = await quote(inboundQuoteRequest({ amount: "1", evm: EVM, dry: true }), { fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err.message).toContain("refundTo is not valid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recovers after one 429 and sends the JWT only when one is configured", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_u: unknown, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return seen.length === 1 ? json(429, {}) : json(200, { quote: { amountOut: "1" } });
    }) as unknown as typeof fetch;
    await quote(inboundQuoteRequest({ amount: "1", evm: EVM, dry: true }), { fetchImpl, sleep: noSleep, jwt: "jwt-value" });
    expect(seen.map((h) => h.authorization)).toEqual(["Bearer jwt-value", "Bearer jwt-value"]);
    const none = vi.fn(async (_u: unknown, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
      return json(200, {});
    }) as unknown as typeof fetch;
    await quote(inboundQuoteRequest({ amount: "1", evm: EVM, dry: true }), { fetchImpl: none, sleep: noSleep, jwt: "" });
  });

  it("posts the documented bodies for deposit/submit, generate-intent and submit-intent", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return json(200, {});
    }) as unknown as typeof fetch;
    const o = { fetchImpl, sleep: noSleep, base: "https://example.test/" };
    await submitDeposit({ txHash: "0xabc", depositAddress: "dep", nearSenderAccount: "a.near" }, o);
    await generateIntent({ signerId: EVM, depositAddress: "dep" }, o);
    await submitIntent({ standard: "erc191" }, o);
    expect(calls).toEqual([
      { url: "https://example.test/v0/deposit/submit", body: { txHash: "0xabc", depositAddress: "dep", nearSenderAccount: "a.near" } },
      { url: "https://example.test/v0/generate-intent", body: { type: "swap_transfer", standard: "erc191", signerId: EVM, depositAddress: "dep" } },
      { url: "https://example.test/v0/submit-intent", body: { type: "swap_transfer", signedData: { standard: "erc191" } } },
    ]);
  });
});

// Free: dry:true quotes do not create a deposit address.
describe.skipIf(!process.env.ARROW_E2E)("live dry quotes", () => {
  it("dry_inbound_quote_200", async () => {
    const r = await quote(inboundQuoteRequest({ amount: "2000000", evm: EVM, dry: true }));
    expect(Number(r.quote.amountOut)).toBeGreaterThan(1_900_000);
    expect(r.quote.depositAddress).toBeUndefined();
  }, 60_000);

  it("dry_outbound_quote_200", async () => {
    const r = await quote(outboundQuoteRequest({ amount: "3000000", sellerEvm: EVM, solana: SOLANA, dry: true }));
    expect(Number(r.quote.amountOut)).toBeGreaterThan(2_800_000);
    expect(r.quote.depositAddress).toBeUndefined();
  }, 60_000);
});
