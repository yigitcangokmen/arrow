// Getting a signed intent onto intents.near: through the hosted relay (/api/relay), or directly with a relayer account.
import { EXECUTE_INTENTS_GAS } from "./config.ts";
import { type MultiPayload, ApiError, RelayResponse } from "./schemas.ts";
import { parseEvents } from "./rpc.ts";

export const RELAY_PATH = "/api/relay";
const INTENTS_CONTRACT = "intents.near";
const REQUEST_GAS = 300_000_000_000_000n; // request_eval / request_release (escrow path): 150 TGas for OutLayer + callback

export class RelayError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "RelayError";
  }
}
export class RelayRateLimited extends RelayError {
  constructor(message: string, public readonly retryAfter: number | null) {
    super(message, 429, "RATE_LIMITED");
    this.name = "RelayRateLimited";
  }
}
export class RelayUnavailable extends RelayError {
  constructor(message: string, public readonly fallback: string | undefined, code = "RELAYER_UNAVAILABLE") {
    super(message, 503, code);
    this.name = "RelayUnavailable";
  }
}
export class SimulateFailed extends RelayError {
  constructor(message: string, public readonly detail: string | undefined) {
    super(message, 422, "SIMULATE_FAILED");
    this.name = "SimulateFailed";
  }
}
export class RelayRejected extends RelayError {
  constructor(message: string, status: number, code: string) {
    super(message, status, code);
    this.name = "RelayRejected";
  }
}

/**
 * The relay may have broadcast the payment but nobody confirmed it (RELAY-3): a RELAY_UNCLEAR answer, a lost connection,
 * a 5xx without the API's error body, or a 200 we cannot read. The caller must not sign a new intent for the same payment:
 * re-send the same signed multipayload (the relay dedupes it, intents.near refuses a used nonce) or check is_nonce_used.
 */
export class RelayUnclear extends RelayError {
  constructor(message: string, status: number) {
    super(message, status, "RELAY_UNCLEAR");
    this.name = "RelayUnclear";
  }
}
const UNCLEAR_TEXT = "Your payment may or may not have gone through. Do not sign a new payment: send the same signed payment again, or check it on NEAR Intents first.";

/** Accepts a site origin or the full relay URL (ARROW_RELAY_URL). */
export function relayUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  return b.endsWith(RELAY_PATH) ? b : b + RELAY_PATH;
}

export async function relayHosted(baseUrl: string, multipayload: MultiPayload, fetchImpl: typeof fetch = fetch): Promise<RelayResponse> {
  let res: Response;
  try {
    res = await fetchImpl(relayUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ multipayload }),
    });
  } catch (e) {
    throw new RelayUnclear(`the relay did not answer (${(e as Error).message}). ${UNCLEAR_TEXT}`, 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const ok = RelayResponse.safeParse(body);
    if (!ok.success) throw new RelayUnclear(`relay answered 200 with an unexpected body. ${UNCLEAR_TEXT}`, res.status);
    return ok.data;
  }
  const err = ApiError.safeParse(body);
  if (!err.success) {
    if (res.status >= 500) throw new RelayUnclear(`relay answered HTTP ${res.status} without an error body. ${UNCLEAR_TEXT}`, res.status);
    throw new RelayRejected(`relay answered HTTP ${res.status} without an error body`, res.status, "BAD_RESPONSE");
  }
  const { error, code, fallback, detail } = err.data;
  if (code === "RELAY_UNCLEAR") throw new RelayUnclear(error, res.status);
  if (res.status === 429) {
    const raw = res.headers.get("retry-after");
    throw new RelayRateLimited(error, raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null);
  }
  if (res.status === 503) throw new RelayUnavailable(error, fallback, code);
  if (res.status === 422) throw new SimulateFailed(error, detail);
  throw new RelayRejected(error, res.status, code);
}

/** A NEAR account that can sign function calls. The adapter around near-api-js lives in scripts/agent, not in the sdk. */
export interface NearCaller {
  callFunction(a: { contractId: string; methodName: string; args: object; gas: bigint; deposit: bigint }): Promise<any>; // final execution outcome
}

export interface DirectRelayResult {
  txHash: string;
  signerId: string;
  requestTxHash?: string;
}

/**
 * execute_intents from the relayer account. With `escrow` (only when the contract's payment_path is "escrow", DEC H-15)
 * it then reads the "accepted" event and calls request_eval / request_release with the escrow key.
 */
export async function relayDirect(
  relayer: NearCaller,
  multipayload: MultiPayload,
  escrow?: { caller: NearCaller; contractId: string },
): Promise<DirectRelayResult> {
  const outcome = await relayer.callFunction({
    contractId: INTENTS_CONTRACT,
    methodName: "execute_intents",
    args: { signed: [multipayload] },
    gas: EXECUTE_INTENTS_GAS,
    deposit: 0n,
  });
  const result: DirectRelayResult = { txHash: outcome.transaction.hash, signerId: outcome.transaction.signer_id };
  if (!escrow) return result;

  for (const e of parseEvents(outcome)) {
    const data = Array.isArray(e.data) ? e.data[0] : e.data;
    if (data?.phase !== "accepted") continue;
    const call =
      e.event === "arrow_eval" ? { methodName: "request_eval", args: { eval_id: data.eval_id } }
      : e.event === "arrow_purchase" ? { methodName: "request_release", args: { purchase_id: data.purchase_id } }
      : null;
    if (!call) continue;
    const req = await escrow.caller.callFunction({ contractId: escrow.contractId, ...call, gas: REQUEST_GAS, deposit: 0n });
    result.requestTxHash = req.transaction.hash;
  }
  return result;
}
