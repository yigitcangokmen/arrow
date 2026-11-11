// One payment, signed once (RELAY-3). The signed payload is stored before it is sent; after any answer that does not
// prove "nothing was broadcast" the only allowed move is to send the SAME bytes again. A fresh signature is possible
// only when the first one is provably dead: refused before broadcast, or past its deadline with an unused nonce.
import { RelayError } from "@arrow/sdk/relay";
import type { MultiPayload } from "@arrow/sdk/schemas";
import { BLOCKER_CODES } from "./blockers.ts";
import type { Network } from "./config.ts";
import type { HistoryStore, PayKind, PayMeta, PendingPayment, PendingStore } from "./pending.ts";

export interface PaidTx {
  txHash: string;
  signerId: string;
}

export interface PayDeps {
  network: Network;
  store: PendingStore;
  history: HistoryStore;
  sign(a: { amount: bigint; msg: string }): Promise<MultiPayload>;
  relay(mp: MultiPayload): Promise<PaidTx>;
  isNonceUsed(signerId: string, nonce: string): Promise<boolean>;
  now(): number;
}

/** An earlier payment of this wallet has no confirmed answer. Nothing was signed. */
export class PaymentPending extends Error {
  constructor(public readonly pending: PendingPayment) {
    super("An earlier payment from this wallet is not confirmed yet. Check it before paying again.");
    this.name = "PaymentPending";
  }
}

/** The relay could not say whether the payment went through. The signed payload is kept for a re-send. */
export class PaymentUnclear extends Error {
  constructor(public readonly pending: PendingPayment, public readonly cause: unknown) {
    super("Your payment may or may not have gone through. Do not pay again: use Check payment.");
    this.name = "PaymentUnclear";
  }
}

/** Codes /api/relay answers only before it broadcasts anything (the blocker codes come from blockers.ts, W2-4). */
const BEFORE_BROADCAST = new Set<string>([
  "BAD_REQUEST", "NOT_ARROW_INTENT", "TOO_LARGE", "AMOUNT_TOO_LOW", "LISTING_NOT_FOUND", "BUDGET_EXHAUSTED", "NOT_SELLER", "SIMULATE_FAILED",
  "RATE_LIMITED", "EVAL_RATE_LIMITED", "EVAL_DAILY_CAP", "RELAYER_UNAVAILABLE", "RELAYER_BUSY", "RPC_ERROR", ...BLOCKER_CODES,
]);

/** True only for an error that proves the relay sent nothing. A network error, RELAY_UNCLEAR and ALREADY_RELAYED do not. */
export const provablyNotSent = (e: unknown): boolean => e instanceof RelayError && BEFORE_BROADCAST.has(e.code);

/** Chain-state refusals the relay answers after it found the nonce unused. A landed payload re-sent can draw them too
 *  (RELAY-3), so they stay out of BEFORE_BROADCAST; on the first send of a payload signed a moment ago nothing can have
 *  landed, so payOnce frees the wallet on them. */
const FIRST_SEND_REFUSED = new Set<string>(["ALREADY_BOUGHT", "NOTHING_TO_CHANGE", "REHOST_COOLDOWN"]);

export function readPayload(mp: MultiPayload): { signerId: string; deadlineMs: number; nonce: string } {
  const p = JSON.parse(mp.payload) as { signer_id: string; deadline: string; nonce: string };
  return { signerId: p.signer_id.toLowerCase(), deadlineMs: Date.parse(p.deadline), nonce: p.nonce };
}

export interface PayRequest {
  kind: PayKind;
  listingId: number | null;
  signerId: string;
  amount: bigint;
  msg: string;
  meta?: PayMeta;
}

/** `at` names the payment in the paid history (setResultId). */
export async function payOnce(d: PayDeps, a: PayRequest): Promise<PaidTx & { at: number }> {
  const signer = a.signerId.toLowerCase();
  const existing = d.store.get(d.network, signer);
  if (existing) throw new PaymentPending(existing);

  const mp = await d.sign({ amount: a.amount, msg: a.msg });
  const { deadlineMs, nonce } = readPayload(mp);
  const pending: PendingPayment = {
    v: 1, kind: a.kind, listingId: a.listingId, signerId: signer, amount: a.amount.toString(), multipayload: mp, deadlineMs, nonce, createdAt: d.now(),
    ...(a.meta ? { meta: a.meta } : {}),
  };
  d.store.put(d.network, pending);
  try {
    const paid = await d.relay(mp);
    d.store.clear(d.network, signer);
    d.history.add(d.network, signer, { v: 1, kind: a.kind, listingId: a.listingId ?? 0, tx: paid, resultId: null, at: pending.createdAt, ...(a.meta ? { meta: a.meta } : {}) });
    return { txHash: paid.txHash, signerId: paid.signerId, at: pending.createdAt };
  } catch (e) {
    if (provablyNotSent(e) || (e instanceof RelayError && FIRST_SEND_REFUSED.has(e.code))) {
      d.store.clear(d.network, signer);
      throw e;
    }
    throw new PaymentUnclear(pending, e);
  }
}

export type ResumeResult =
  | { state: "none" }
  /** The relay answered with the transaction. */
  | { state: "paid"; pending: PendingPayment; paid: PaidTx; at: number }
  /** The nonce is used on intents.near: the payment happened, the transaction hash is unknown. */
  | { state: "paid-no-tx"; pending: PendingPayment; at: number }
  /** The signed intent is dead (deadline passed, nonce unused): signing again is safe. */
  | { state: "released"; pending: PendingPayment }
  /** Still unknown. `until` is when the intent expires. */
  | { state: "waiting"; pending: PendingPayment; until: number };

/** "Check payment": sends the stored payload again, and falls back to the nonce on intents.near. Never signs. */
export async function resumePending(d: PayDeps, signerId: string): Promise<ResumeResult> {
  const signer = signerId.toLowerCase();
  const pending = d.store.get(d.network, signer);
  if (!pending) return { state: "none" };
  const settle = (extra: { tx: PaidTx | null }) => {
    d.store.clear(d.network, signer);
    d.history.add(d.network, signer, { v: 1, kind: pending.kind, listingId: pending.listingId ?? 0, tx: extra.tx, resultId: null, at: pending.createdAt, ...(pending.meta ? { meta: pending.meta } : {}) });
    return pending.createdAt;
  };
  try {
    const paid = await d.relay(pending.multipayload);
    return { state: "paid", pending, paid, at: settle({ tx: paid }) };
  } catch {
    let used: boolean | null = null;
    try {
      used = await d.isNonceUsed(pending.signerId, pending.nonce);
    } catch {
      // the check itself failed: stay on the safe side
    }
    if (used === true) return { state: "paid-no-tx", pending, at: settle({ tx: null }) };
    if (used === false && d.now() > pending.deadlineMs) {
      d.store.clear(d.network, signer);
      return { state: "released", pending };
    }
    return { state: "waiting", pending, until: pending.deadlineMs };
  }
}
