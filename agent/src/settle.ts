// Waiting for the contract's answer after a payment (DEC D4-07). The tx is included at once, but the enclave answers
// 60-118 s later, so one RPC call cannot wait for it: poll tx status for the event that names the new id, then poll the
// contract view until the record leaves "pending".
import { type Network, parseEvents, txStatus } from "@arrow/sdk";
import type { ViewsLike } from "./views.ts";
import type { PaidTx } from "./transport.ts";

export const POLL_MS = 3_000;
export const SETTLE_TIMEOUT_MS = 240_000;

export interface WaitDeps {
  network: Network;
  views: ViewsLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  everyMs?: number;
  timeoutMs?: number;
  txStatusImpl?: typeof txStatus;
}

export class SettleTimeout extends Error {
  constructor(what: string, public readonly id: number | undefined) {
    super(`${what} still pending after ${SETTLE_TIMEOUT_MS / 1000} s${id !== undefined ? ` (#${id})` : ""}: continue with \`status\``);
    this.name = "SettleTimeout";
  }
}
export class PaymentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRejected";
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The first "Arrow: Exx ..." failure text in a tx outcome, if any receipt panicked. */
export function explainRejection(tx: any): string | undefined {
  const text = JSON.stringify([tx?.status, ...(tx?.receipts_outcome ?? []).map((o: any) => o?.outcome?.status)]);
  return /Arrow: E\d\d[^"\\]*/.exec(text)?.[0];
}

/**
 * Polls EXPERIMENTAL_tx_status until an event `eventName` shows up and returns the number in `idField`.
 * Gives up (undefined) when the tx is final and no such event exists, which means the contract refused the payment.
 */
export async function findEventId(
  d: WaitDeps,
  tx: PaidTx,
  eventName: string,
  idField: string,
  phase?: string,
): Promise<{ id?: number; rejection?: string }> {
  const sleep = d.sleep ?? realSleep;
  const now = d.now ?? Date.now;
  const status = d.txStatusImpl ?? txStatus;
  const deadline = now() + (d.timeoutMs ?? SETTLE_TIMEOUT_MS);
  let lastError: unknown;
  for (;;) {
    try {
      const out = await status(d.network, tx.txHash, tx.signerId, "NONE");
      for (const e of parseEvents(out)) {
        if (e.event !== eventName) continue;
        const data = Array.isArray(e.data) ? e.data[0] : e.data;
        if (phase && data?.phase !== phase) continue;
        if (data?.[idField] !== undefined) return { id: Number(data[idField]) };
      }
      if (out?.final_execution_status === "FINAL") return { rejection: explainRejection(out) ?? "no arrow event in the transaction" };
    } catch (e) {
      lastError = e; // UNKNOWN_TRANSACTION right after inclusion, or a flaky RPC: try again
    }
    if (now() >= deadline) throw new SettleTimeout(`${eventName} event${lastError instanceof Error ? ` (${lastError.message})` : ""}`, undefined);
    await sleep(d.everyMs ?? POLL_MS);
  }
}

/** Polls a record view until its status is "done" or "refunded". */
export async function pollRecord<T extends { status: string }>(
  d: WaitDeps,
  what: string,
  id: number,
  read: () => Promise<T | null>,
): Promise<T> {
  const sleep = d.sleep ?? realSleep;
  const now = d.now ?? Date.now;
  const deadline = now() + (d.timeoutMs ?? SETTLE_TIMEOUT_MS);
  for (;;) {
    const rec = await read().catch(() => null);
    if (rec && (rec.status === "done" || rec.status === "refunded")) return rec;
    if (now() >= deadline) throw new SettleTimeout(what, id);
    await sleep(d.everyMs ?? POLL_MS);
  }
}
