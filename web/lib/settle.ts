// Waiting for the contract's answer in the browser (same steps as agent/src/settle.ts, which cannot be imported here).
// The tx is included at once; the enclave answers 60-118 s later, so poll the tx for the event that names the new id,
// then poll the record until it leaves "pending".
import type { Network } from "@arrow/sdk/config";
import { parseEvents, txStatus } from "@arrow/sdk/rpc";

export const POLL_MS = 3_000;
export const EVENT_TIMEOUT_MS = 90_000;
export const RECORD_TIMEOUT_MS = 180_000;

export class SettleTimeout extends Error {
  constructor(what: string) {
    super(`${what} is still pending`);
    this.name = "SettleTimeout";
  }
}
export class PaymentRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRefused";
  }
}

export interface PollDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  everyMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  txStatusImpl?: typeof txStatus;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The first "Arrow: Exx ..." text in a failed outcome, else a generic reason. */
export function explainRejection(tx: unknown): string {
  const o = tx as { status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] } | null;
  const text = JSON.stringify([o?.status, ...(o?.receipts_outcome ?? []).map((r) => r?.outcome?.status)]);
  return /Arrow: E\d\d[^"\\]*/.exec(text)?.[0] ?? "the contract did not accept the payment";
}

/** Polls the tx until the event `eventName` (optionally of `phase`) shows up, and returns `data[idField]` as a number. */
export async function findEventId(
  network: Network,
  tx: { txHash: string; signerId: string },
  eventName: string,
  idField: string,
  d: PollDeps & { phase?: string } = {},
): Promise<number> {
  const sleep = d.sleep ?? realSleep;
  const now = d.now ?? Date.now;
  const status = d.txStatusImpl ?? txStatus;
  const deadline = now() + (d.timeoutMs ?? EVENT_TIMEOUT_MS);
  for (;;) {
    if (d.signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const out = await status(network, tx.txHash, tx.signerId, "NONE");
      for (const e of parseEvents(out)) {
        if (e.event !== eventName) continue;
        const data = Array.isArray(e.data) ? e.data[0] : e.data;
        if (d.phase && data?.phase !== d.phase) continue;
        if (data?.[idField] !== undefined) return Number(data[idField]);
      }
      if (out?.final_execution_status === "FINAL") throw new PaymentRefused(explainRejection(out));
    } catch (e) {
      if (e instanceof PaymentRefused) throw e;
      // UNKNOWN_TRANSACTION right after inclusion or a flaky RPC: try again until the deadline
    }
    if (now() >= deadline) throw new SettleTimeout(`${eventName} event`);
    await sleep(d.everyMs ?? POLL_MS);
  }
}

/** Polls a record view until its status is "done" or "refunded". */
export async function waitForRecord<T extends { status: string }>(what: string, read: () => Promise<T | null>, d: PollDeps = {}): Promise<T> {
  const sleep = d.sleep ?? realSleep;
  const now = d.now ?? Date.now;
  const deadline = now() + (d.timeoutMs ?? RECORD_TIMEOUT_MS);
  for (;;) {
    if (d.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const rec = await read().catch(() => null);
    if (rec && (rec.status === "done" || rec.status === "refunded")) return rec;
    if (now() >= deadline) throw new SettleTimeout(what);
    await sleep(d.everyMs ?? POLL_MS);
  }
}
