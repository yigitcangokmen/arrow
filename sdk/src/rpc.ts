// fetch-based NEAR JSON-RPC client. No near-api-js here (bundle rule, RT B8): the same code runs in the browser.
import { type Network, NETWORKS } from "./config.ts";
import { b64 } from "./crypto.ts";

export class RpcError extends Error {
  constructor(message: string, public readonly retryable = false, public readonly raw?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcOptions {
  archival?: boolean;
  timeoutMs?: number;
  /** Replaces the global fetch (tests, verify). */
  fetchImpl?: typeof fetch;
}

const BACKOFF_MS = [500, 1000, 2000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a JSON-RPC call. Tries each URL of the network in turn; HTTP 429/5xx, network errors, timeouts and
 * RPC-side TIMEOUT_ERROR move on to the next URL (up to 3 rounds, waiting 500/1000/2000 ms between rounds).
 * A top-level `error` and a `result.error` (a failed call_function) throw an RpcError without retrying.
 */
export async function rpc<T>(network: Network, method: string, params: unknown, o: RpcOptions = {}): Promise<T> {
  const cfg = NETWORKS[network];
  const urls = o.archival ? [cfg.archivalRpc, ...cfg.rpc] : cfg.rpc;
  let last: unknown = new RpcError("no RPC URL configured");
  for (let round = 0; round < BACKOFF_MS.length; round++) {
    for (const url of urls) {
      try {
        const res = await (o.fetchImpl ?? fetch)(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "arrow", method, params }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        });
        if (res.status === 429 || res.status >= 500) throw new RpcError(`${url}: HTTP ${res.status}`, true);
        const body: any = await res.json();
        if (body.error) {
          const msg = String(body.error.data ?? body.error.message ?? "rpc error");
          throw new RpcError(msg, body.error.cause?.name === "TIMEOUT_ERROR", body.error);
        }
        if (body.result?.error) throw new RpcError(String(body.result.error), false, body.result);
        return body.result as T;
      } catch (e) {
        if (e instanceof RpcError && !e.retryable) throw e;
        last = e;
      }
    }
    if (round < BACKOFF_MS.length - 1) await sleep(BACKOFF_MS[round]);
  }
  throw last instanceof RpcError ? last : new RpcError(`rpc ${method} failed: ${(last as Error)?.message ?? last}`, true, last);
}

/** call_function view at finality "final"; JSON in, JSON out. */
export async function view<T>(network: Network, contractId: string, method: string, args: object = {}, o?: RpcOptions): Promise<T> {
  const r = await rpc<{ result: number[] }>(
    network,
    "query",
    {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: b64.enc(new TextEncoder().encode(JSON.stringify(args))),
    },
    o,
  );
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
}

export const viewAccount = (network: Network, accountId: string, o?: RpcOptions) =>
  rpc<{ amount: string; locked: string; code_hash: string; storage_usage: number }>(
    network, "query", { request_type: "view_account", finality: "final", account_id: accountId }, o);

export const viewAccessKey = (network: Network, accountId: string, publicKey: string, o?: RpcOptions) =>
  rpc<{ nonce: number; permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } } }>(
    network, "query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }, o);

export const viewAccessKeyList = (network: Network, accountId: string, o?: RpcOptions) =>
  rpc<{ keys: { public_key: string; access_key: { nonce: number; permission: unknown } }[] }>(
    network, "query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }, o);

export type TxWait = "NONE" | "INCLUDED_FINAL" | "FINAL";

/** EXPERIMENTAL_tx_status: the full receipt tree, including logs and receipts. */
export const txStatus = (network: Network, txHash: string, senderId: string, waitUntil: TxWait = "NONE", o?: RpcOptions) =>
  rpc<any>(network, "EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: waitUntil }, o);

export interface NearEvent {
  standard: string;
  version: string;
  event: string;
  data: any;
  receiptId: string;
  executorId: string;
}

/** NEP-297 events: every log line that starts with "EVENT_JSON:" in the transaction and receipt outcomes. */
export function parseEvents(tx: any): NearEvent[] {
  const outcomes = [tx?.transaction_outcome, ...(tx?.receipts_outcome ?? [])].filter(Boolean);
  const events: NearEvent[] = [];
  for (const o of outcomes) {
    for (const line of o.outcome?.logs ?? []) {
      if (typeof line !== "string" || !line.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(line.slice("EVENT_JSON:".length));
        events.push({ standard: e.standard, version: e.version, event: e.event, data: e.data, receiptId: o.id, executorId: o.outcome.executor_id });
      } catch {
        // a malformed log line is not an event
      }
    }
  }
  return events;
}

/** JSON args of every FunctionCall to receiverId.methodName in the transaction and its receipts. */
export function functionCallArgs(tx: any, { receiverId, methodName }: { receiverId: string; methodName: string }): any[] {
  const found: any[] = [];
  const take = (actions: any[] | undefined) => {
    for (const a of actions ?? []) {
      const fc = a?.FunctionCall;
      if (fc?.method_name !== methodName) continue;
      found.push(JSON.parse(new TextDecoder().decode(b64.dec(fc.args))));
    }
  };
  if (tx?.transaction?.receiver_id === receiverId) take(tx.transaction.actions);
  for (const r of tx?.receipts ?? []) if (r?.receiver_id === receiverId) take(r.receipt?.Action?.actions);
  return found;
}

/** intents.near current_salt ("252812b3") as 4 bytes. */
export async function currentSalt(network: Network = "mainnet", o?: RpcOptions): Promise<Uint8Array> {
  const intents = NETWORKS[network].intents;
  if (!intents) throw new Error(`no intents contract on ${network}`);
  const hex = await view<string>(network, intents, "current_salt", {}, o);
  if (!/^[0-9a-f]{8}$/.test(hex)) throw new RpcError(`unexpected current_salt "${hex}"`);
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** intents.near is_nonce_used: true once a signed intent with this nonce has executed (RELAY-3 recovery). `nonce` is the payload's base64. */
export async function isNonceUsed(accountId: string, nonce: string, network: Network = "mainnet", o?: RpcOptions): Promise<boolean> {
  const intents = NETWORKS[network].intents;
  if (!intents) throw new Error(`no intents contract on ${network}`);
  const used = await view<unknown>(network, intents, "is_nonce_used", { account_id: accountId, nonce }, o);
  if (typeof used !== "boolean") throw new RpcError(`unexpected is_nonce_used answer ${JSON.stringify(used)}`);
  return used;
}

/** intents.near simulate_intents (a view). It checks signature, nonce, deadline and balances, but does not run mt_on_transfer. */
export const simulateIntents = (signed: object[], network: Network = "mainnet", o?: RpcOptions) =>
  view<any>(network, NETWORKS[network].intents ?? "", "simulate_intents", { signed }, o);
