// Following a 1Click swap and reading its result. Used by the Base top-up and the Solana withdrawal.
import { status as fetchStatus, TERMINAL_STATUSES, type StatusResponse } from "@arrow/sdk/oneclick";

export const POLL_MS = 5_000;
export const POLL_LIMIT_MS = 15 * 60_000; // INCOMPLETE_DEPOSIT may still resolve, so a non-terminal status is followed for a while

export interface WatchDeps {
  onTick?(s: StatusResponse): void;
  signal?: AbortSignal;
  everyMs?: number;
  limitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  statusImpl?: typeof fetchStatus;
}

/** Polls /v0/status until SUCCESS, REFUNDED or FAILED; returns the last status when the limit passes first. A failed poll is skipped. */
export async function watchSwap(depositAddress: string, d: WatchDeps = {}): Promise<StatusResponse | null> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.now ?? Date.now;
  const get = d.statusImpl ?? fetchStatus;
  const started = now();
  let last: StatusResponse | null = null;
  for (;;) {
    if (d.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const s = await get(depositAddress).catch(() => null);
    if (s) {
      last = s;
      d.onTick?.(s);
      if (TERMINAL_STATUSES.includes(s.status)) return s;
    }
    if (now() - started >= (d.limitMs ?? POLL_LIMIT_MS)) return last;
    await sleep(d.everyMs ?? POLL_MS);
  }
}

/** The first destination-chain transaction of a finished swap (the Solana signature of a withdrawal), if 1Click reported one. */
export function destinationTxHash(s: StatusResponse | null): string | null {
  const list = (s?.swapDetails as { destinationChainTxHashes?: { hash?: unknown }[] } | undefined)?.destinationChainTxHashes;
  const h = list?.[0]?.hash;
  return typeof h === "string" && h !== "" ? h : null;
}

/** The ERC-191 payload string of a generate-intent answer; any other signing scheme is an error. */
export function erc191Payload(intent: { standard: string; payload?: unknown }): string {
  if (intent.standard !== "erc191" || typeof intent.payload !== "string") throw new Error(`1Click returned a ${intent.standard} payload; this page signs ERC-191 only`);
  return intent.payload;
}

export class WithdrawPayloadError extends Error {
  constructor(message: string) {
    super(`1Click returned an intent that is not the withdrawal you asked for (${message}). Nothing was signed.`);
    this.name = "WithdrawPayloadError";
  }
}

const MAX_WITHDRAW_DEADLINE_MS = 7 * 24 * 3_600_000; // 1Click's own intents expired about 41 h ahead on 11 Nov and 72.5 h ahead on 14 Nov (measured); a week still refuses a far-future deadline
const TOP_KEYS = new Set(["verifying_contract", "signer_id", "deadline", "nonce", "intents"]);
const INTENT_KEYS = new Set(["intent", "receiver_id", "tokens"]);

/**
 * The payload 1Click built for a withdrawal is signed byte for byte, and intents.near also accepts add_public_key,
 * set_auth_by_predecessor_id and ft_withdraw. So it is parsed first and must be exactly one transfer of exactly the USDC
 * the user chose, from the user's account, to the deposit address of their own quote, with nothing else in it.
 */
export function assertWithdrawPayload(
  payload: string,
  want: { signerId: string; depositAddress: string; usdcToken: string; units: bigint; now?: number },
): void {
  let p: any;
  try {
    p = JSON.parse(payload);
  } catch {
    throw new WithdrawPayloadError("not JSON");
  }
  if (typeof p !== "object" || p === null || Array.isArray(p)) throw new WithdrawPayloadError("not an object");
  for (const k of Object.keys(p)) if (!TOP_KEYS.has(k)) throw new WithdrawPayloadError(`unexpected field ${k}`);
  if (p.signer_id !== want.signerId) throw new WithdrawPayloadError("another signer_id");
  if (p.verifying_contract !== "intents.near") throw new WithdrawPayloadError("another verifying contract");
  const now = want.now ?? Date.now();
  const deadline = typeof p.deadline === "string" ? Date.parse(p.deadline) : NaN;
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + MAX_WITHDRAW_DEADLINE_MS) throw new WithdrawPayloadError("deadline out of range");
  if (!Array.isArray(p.intents) || p.intents.length !== 1) throw new WithdrawPayloadError("not exactly one intent");
  const i = p.intents[0];
  if (typeof i !== "object" || i === null) throw new WithdrawPayloadError("bad intent");
  if (i.intent !== "transfer") throw new WithdrawPayloadError(`intent kind ${String(i.intent).slice(0, 30)}`);
  for (const k of Object.keys(i)) if (!INTENT_KEYS.has(k)) throw new WithdrawPayloadError(`unexpected intent field ${k}`);
  if (i.receiver_id !== want.depositAddress) throw new WithdrawPayloadError("another receiver");
  const keys = typeof i.tokens === "object" && i.tokens !== null ? Object.keys(i.tokens) : [];
  if (keys.length !== 1 || keys[0] !== want.usdcToken) throw new WithdrawPayloadError("another token");
  if (i.tokens[want.usdcToken] !== want.units.toString()) throw new WithdrawPayloadError("another amount");
}
