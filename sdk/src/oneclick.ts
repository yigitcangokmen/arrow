// 1Click (NEAR Intents swap API) client: Base USDC -> Intents account (inbound, DEC K-01) and Intents -> Solana (outbound,
// DEC K-02). fetch only. The package's global OpenAPI object is not used, so there is no hidden shared state; only types
// come from @defuse-protocol/one-click-sdk-typescript.
import type { MultiPayloadNarrowed, QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { BASE_USDC_ASSET, NETWORKS, SOL_USDC_ASSET } from "./config.ts";

export type { QuoteResponse };

export const ONECLICK_API_BASE = "https://1click.chaindefuser.com";
export const DEFAULT_SLIPPAGE_BPS = 50; // USDC -> USDC (DEC K-01); the fallback is 100
export const QUOTE_DEADLINE_MS = 30 * 60_000;

export type OneClickStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
export const TERMINAL_STATUSES: readonly OneClickStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "INTENTS" | "DESTINATION_CHAIN";
  deadline: string;
}

/** The parts of /v0/status that callers read; the response carries more (swapDetails with the transactions). */
export interface StatusResponse {
  status: OneClickStatus;
  updatedAt: string;
  swapDetails?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface OneClickOptions {
  base?: string;
  jwt?: string;
  fetchImpl?: typeof fetch;
  /** Waits between retries and polls; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class OneClickError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
    this.name = "OneClickError";
  }
}

const envOf = (name: string): string | undefined => (typeof process !== "undefined" ? process.env[name] : undefined);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRY_MS = [1000, 2000, 4000]; // 3 retries on 429 / 5xx / network errors (card WS4-T05)

/** Base units as digits only: "2000000" for 2 USDC. A decimal like "2.0" is a bug in the caller, so it throws. */
function assertIntegerAmount(amount: string): void {
  if (!/^[1-9]\d*$/.test(amount)) throw new Error(`amount must be a positive integer string in base units, got "${amount}"`);
}

const deadlineIso = (now: number) => new Date(now + QUOTE_DEADLINE_MS).toISOString();

/** Base USDC (EOA on Base) -> the same 0x address as a NEAR Intents account. amount is in USDC base units (6 decimals). */
export function inboundQuoteRequest(p: { amount: string; evm: `0x${string}`; dry: boolean; slippageBps?: number; now?: number }): QuoteRequest {
  assertIntegerAmount(p.amount);
  const evm = p.evm.toLowerCase();
  return {
    dry: p.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: BASE_USDC_ASSET,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NETWORKS.mainnet.usdcToken,
    amount: p.amount,
    refundTo: evm,
    refundType: "ORIGIN_CHAIN",
    recipient: evm,
    recipientType: "INTENTS",
    deadline: deadlineIso(p.now ?? Date.now()),
  };
}

/** The seller's Intents USDC -> USDC on Solana. depositAddress of the real quote is itself an Intents account. */
export function outboundQuoteRequest(p: { amount: string; sellerEvm: `0x${string}`; solana: string; dry: boolean; slippageBps?: number; now?: number }): QuoteRequest {
  assertIntegerAmount(p.amount);
  return {
    dry: p.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: NETWORKS.mainnet.usdcToken,
    depositType: "INTENTS",
    destinationAsset: SOL_USDC_ASSET,
    amount: p.amount,
    refundTo: p.sellerEvm.toLowerCase(),
    refundType: "INTENTS",
    recipient: p.solana,
    recipientType: "DESTINATION_CHAIN",
    deadline: deadlineIso(p.now ?? Date.now()),
  };
}

async function call<T>(method: "GET" | "POST", path: string, o: OneClickOptions, body?: unknown, query?: Record<string, string>): Promise<T> {
  const base = (o.base ?? envOf("ONECLICK_API_BASE") ?? ONECLICK_API_BASE).replace(/\/+$/, "");
  const jwt = o.jwt ?? envOf("ONECLICK_JWT");
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const url = base + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (jwt) headers.authorization = `Bearer ${jwt}`;

  let last: OneClickError | undefined;
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_MS[attempt - 1]);
    let res: Response;
    try {
      res = await f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      last = new OneClickError(`1Click ${path}: ${(e as Error).message}`, 0);
      continue;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text for the error message
    }
    if (res.ok) return parsed as T;
    const detail = typeof parsed === "object" && parsed && "message" in parsed ? String((parsed as { message: unknown }).message) : text.slice(0, 200);
    last = new OneClickError(`1Click ${path}: HTTP ${res.status} ${detail}`, res.status, parsed);
    if (res.status !== 429 && res.status < 500) throw last; // 4xx is final: the request itself is wrong
  }
  throw last!;
}

/** POST /v0/quote. With dry:true the answer has no depositAddress. */
export const quote = (req: QuoteRequest, o: OneClickOptions = {}) => call<QuoteResponse>("POST", "/v0/quote", o, req);

/** GET /v0/status?depositAddress= */
export const status = (depositAddress: string, o: OneClickOptions = {}) =>
  call<StatusResponse>("GET", "/v0/status", o, undefined, { depositAddress });

/** POST /v0/deposit/submit: tells 1Click about the deposit tx so it does not have to wait for its own scan. */
export const submitDeposit = (p: { txHash: string; depositAddress: string; nearSenderAccount?: string }, o: OneClickOptions = {}) =>
  call<StatusResponse>("POST", "/v0/deposit/submit", o, p);

/** POST /v0/generate-intent (swap_transfer, erc191): the unsigned transfer intent the signer must sign. */
export const generateIntent = (p: { signerId: string; depositAddress: string }, o: OneClickOptions = {}) =>
  call<{ intent: MultiPayloadNarrowed; correlationId: string }>("POST", "/v0/generate-intent", o, {
    type: "swap_transfer",
    standard: "erc191",
    signerId: p.signerId,
    depositAddress: p.depositAddress,
  });

/** POST /v0/submit-intent with the signed payload from generateIntent. */
export const submitIntent = (signedData: unknown, o: OneClickOptions = {}) =>
  call<{ intentHash: string; correlationId: string }>("POST", "/v0/submit-intent", o, { type: "swap_transfer", signedData });

/** Polls /v0/status until SUCCESS, REFUNDED or FAILED. Throws when timeoutMs passes first. */
export async function waitForStatus(
  depositAddress: string,
  p: { timeoutMs?: number; everyMs?: number; onTick?: (s: StatusResponse, elapsedMs: number) => void } & OneClickOptions = {},
): Promise<StatusResponse> {
  const { timeoutMs = 600_000, everyMs = 5_000, onTick, ...o } = p;
  const sleep = o.sleep ?? defaultSleep;
  const started = Date.now();
  for (;;) {
    const s = await status(depositAddress, o);
    onTick?.(s, Date.now() - started);
    if (TERMINAL_STATUSES.includes(s.status)) return s;
    if (Date.now() - started + everyMs > timeoutMs) throw new Error(`1Click status still ${s.status} after ${Math.round((Date.now() - started) / 1000)} s`);
    await sleep(everyMs);
  }
}
