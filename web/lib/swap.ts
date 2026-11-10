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
