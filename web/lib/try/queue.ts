// OutLayer's shared testnet queue, read before /try pays for a run (DEMO-1).
// The frozen program gives up on an inspection that starts more than 45 s after its request block (start-of-run guard:
// start + the 45 s pad must stay inside the 90 s deadline) and on a release that ends after 45 s; NEAR ends a yield after
// about 200 blocks, so a run that never starts refunds as `null`. When the queue is slow every run refunds, so the page
// measures it first and waits instead of paying into a refund.
import { NETWORKS } from "@arrow/sdk/config";
import { chainNowMs, parseEvents, rpc, view } from "@arrow/sdk/rpc";

/** A run that waited this long is close to the program's 45 s limit; leave room for the time between probe and payment. */
export const QUEUE_BUSY_SEC = 30;
/** The program's own limit on how late an inspection may start (frozen wasm: EVAL_DEADLINE 90 s minus T_PAD 45 s). */
export const PROGRAM_START_LIMIT_SEC = 45;
export const QUEUE_POLL_MS = 15_000;
/** Slow spells of the testnet queue measured on 13 Nov lasted 15-45 minutes, so the page keeps waiting a while; the visitor can cancel. */
export const QUEUE_WAIT_MAX_MS = 15 * 60_000;
const LOOK_BACK = 8;

export interface QueueReading {
  /** Seconds the newest jobs waited (or are still waiting) for a worker. */
  waitSec: number;
}

export interface QueueDeps {
  /** The newest request id on the OutLayer contract (get_stats[0]). */
  lastRequestId(): Promise<number>;
  /** OutLayer's stored record of a run, made when it starts; null when there is none (not started, or not stored). */
  attestation(id: number): Promise<{ timestamp: number; block_height: number } | null>;
  /** The request while it is still open on the OutLayer contract (get_request); null once it is resolved. */
  openRequest(id: number): Promise<{ timestamp: string | number } | null>;
  blockTimeSec(height: number): Promise<number>;
  chainNowSec(): Promise<number>;
}

/**
 * How long the newest jobs waited: the start lag of the newest job that started, or, when newer requests are still open
 * and have not started, how long the oldest of those has been waiting. Null when nothing could be read (then the page
 * goes ahead as before). A job that is running but has no stored record yet counts as waiting, which can only make the
 * page wait longer, never pay into a slow queue.
 */
export async function readQueue(d: QueueDeps): Promise<QueueReading | null> {
  try {
    const last = await d.lastRequestId();
    const ids = Array.from({ length: LOOK_BACK }, (_, i) => last - i).filter((id) => id > 0);
    const atts = await Promise.all(ids.map((id) => d.attestation(id).catch(() => null)));
    const newest = atts.findIndex((a) => a !== null);
    const notStarted = newest === -1 ? ids : ids.slice(0, newest);
    const [open, now] = await Promise.all([Promise.all(notStarted.map((id) => d.openRequest(id).catch(() => null))), d.chainNowSec()]);
    let wait = -1;
    for (const r of open) if (r) wait = Math.max(wait, now - Number(r.timestamp) / 1e9);
    if (newest !== -1) {
      const a = atts[newest]!;
      wait = Math.max(wait, a.timestamp - (await d.blockTimeSec(a.block_height)));
    }
    return wait < 0 ? null : { waitSec: Math.max(0, Math.round(wait)) };
  } catch {
    return null;
  }
}

/** The request id OutLayer gave the run started by this transaction (its near-outlayer execution_requested event). */
export function requestIdOf(tx: unknown): number | null {
  for (const e of parseEvents(tx)) {
    if (e.standard !== "near-outlayer" || e.event !== "execution_requested") continue;
    for (const item of Array.isArray(e.data) ? e.data : [e.data]) {
      let rd = item?.request_data;
      if (typeof rd === "string") {
        try {
          rd = JSON.parse(rd);
        } catch {
          continue;
        }
      }
      const id = Number(rd?.request_id);
      if (Number.isSafeInteger(id) && id >= 0) return id;
    }
  }
  return null;
}

/**
 * How long one run waited before it started: its stored record's start time minus its request block. `started: false`
 * when OutLayer has no record of it, which is how a run that never started (NEAR ended the wait) looks.
 */
export async function runStartLag(d: Pick<QueueDeps, "attestation" | "blockTimeSec">, requestId: number): Promise<{ started: true; lagSec: number } | { started: false } | null> {
  try {
    const a = await d.attestation(requestId);
    if (!a) return { started: false };
    return { started: true, lagSec: Math.max(0, Math.round(a.timestamp - (await d.blockTimeSec(a.block_height)))) };
  } catch {
    return null;
  }
}

/** The real reads: OutLayer testnet contract views, its public attestation API (CORS *) and testnet RPC. */
export function realQueueDeps(fetchImpl: typeof fetch = (...a) => fetch(...a)): QueueDeps {
  const net = NETWORKS.testnet;
  return {
    lastRequestId: async () => {
      const stats = await view<unknown[]>("testnet", net.outlayer, "get_stats", {});
      const id = Number(stats?.[0]);
      if (!Number.isSafeInteger(id)) throw new Error("get_stats answered without a request count");
      return id;
    },
    attestation: async (id) => {
      const res = await fetchImpl(`${net.outlayerApi}/attestations/by-request/${id}`, { signal: AbortSignal.timeout(8_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`attestation ${id}: HTTP ${res.status}`);
      const a = (await res.json()) as { timestamp?: unknown; block_height?: unknown };
      return typeof a?.timestamp === "number" && typeof a?.block_height === "number" ? { timestamp: a.timestamp, block_height: a.block_height } : null;
    },
    openRequest: (id) => view<{ timestamp: string | number } | null>("testnet", net.outlayer, "get_request", { request_id: id }),
    blockTimeSec: async (height) => {
      const b = await rpc<{ header?: { timestamp_nanosec?: string } }>("testnet", "block", { block_id: height });
      const ns = b?.header?.timestamp_nanosec;
      if (typeof ns !== "string" || !/^\d+$/.test(ns)) throw new Error("block answer has no timestamp");
      return Number(BigInt(ns) / 1_000_000n) / 1000;
    },
    chainNowSec: async () => (await chainNowMs("testnet")) / 1000,
  };
}
