// Testnet chain access for the bench (WS6-T05, card section B). near-api-js 7.4.0 is used here (bench is not the SDK);
// reads go through the SDK's fetch-based ArrowViews. Sends are serialized by the caller (one nonce queue per key).
// NOT exercised against a live contract in WS6-T05: the testnet contract is deployed in WS1-T15. Log parsing is
// tested against bench/test/fixtures/tx-eval-done.json; live behaviour is checked in WS6-T06.
import { Account, JsonRpcProvider } from "near-api-js";
import { ArrowViews, decodeEvalResult, decodeState, encodeState, NETWORKS, prepareList, sealCriteria, view, type Criteria } from "@arrow/sdk";
import { benchBuyerKey, loadNearSigner } from "./keys.ts";
import type { LiveEval } from "./schema.ts";

export const GAS_300T = 300_000_000_000_000n;
export const POLL_MS = 5000;
export const WAIT_LIMIT_MS = 180_000;
const RPC = "https://rpc.testnet.fastnear.com";
const ARCHIVAL = "https://archival-rpc.testnet.fastnear.com";

export type Outcome = {
  eval_id: number | null;
  request_id: number | null;
  refund_reason: "null" | "bad_output" | "not_ok" | "hash_mismatch" | null;
  resources_used: { instructions: number | null; time_ms: number | null };
  output_bytes: number | null;
  success: boolean | null;
  error_message: string | null;
};

type TxLike = { receipts_outcome?: { outcome?: { logs?: string[] } }[]; transaction_outcome?: { outcome?: { logs?: string[] } } };

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
/** NEP-297 data is an object (near-sdk event_json) or a one-element array (OutLayer). */
const dataOf = (ev: Record<string, unknown>): Record<string, unknown> => asRecord(Array.isArray(ev.data) ? ev.data[0] : ev.data);

/**
 * Reads the arrow events (`arrow_eval` accepted -> eval_id, `arrow_refund` -> reason) and the OutLayer events
 * (`execution_requested` -> request_id inside the request_data JSON string, `execution_completed` -> resources_used,
 * success, error_message) plus the `Output: Json(N bytes)` line from every receipt of an eval transaction.
 */
export function parseOutcomeLogs(tx: TxLike): Outcome {
  const logs = [...(tx.transaction_outcome?.outcome?.logs ?? []), ...(tx.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? [])];
  const o: Outcome = { eval_id: null, request_id: null, refund_reason: null, resources_used: { instructions: null, time_ms: null }, output_bytes: null, success: null, error_message: null };
  for (const line of logs) {
    const out = /Output: [A-Za-z]+\((\d+) bytes\)/.exec(line);
    if (out) o.output_bytes = Number(out[1]);
    if (!line.startsWith("EVENT_JSON:")) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line.slice("EVENT_JSON:".length)) as Record<string, unknown>; } catch { continue; }
    const d = dataOf(ev);
    if (ev.standard === "arrow" && ev.event === "arrow_eval" && d.phase === "accepted") o.eval_id = Number(d.eval_id);
    else if (ev.standard === "arrow" && ev.event === "arrow_refund") {
      const r = String(d.reason);
      if (r === "null" || r === "bad_output" || r === "not_ok" || r === "hash_mismatch") o.refund_reason = r;
    } else if (ev.event === "execution_requested") {
      try { o.request_id = Number((JSON.parse(String(d.request_data)) as { request_id?: unknown }).request_id); } catch { /* keep null */ }
    } else if (ev.event === "execution_completed") {
      const ru = asRecord(d.resources_used);
      o.resources_used = { instructions: typeof ru.instructions === "number" ? ru.instructions : null, time_ms: typeof ru.time_ms === "number" ? ru.time_ms : null };
      o.success = typeof d.success === "boolean" ? d.success : null;
      o.error_message = typeof d.error_message === "string" ? d.error_message : null;
    }
  }
  return o;
}

/** idx 0..49 (scored) or 0..1 (verdict) back to the report string used in LiveEval.state. */
export function stateString(idx: number, mode: "scored" | "verdict"): string {
  const s = decodeState(idx, mode);
  return mode === "verdict" ? s.verdict : `${s.verdict}·${s.fit}·${s.novelty}`;
}
export { encodeState };

export function makeChain(accountId: string, network: "testnet" = "testnet") {
  const provider = new JsonRpcProvider({ url: RPC });
  const archival = new JsonRpcProvider({ url: ARCHIVAL });
  const account = new Account(accountId, provider, loadNearSigner(accountId, network));
  const cfg = NETWORKS[network];
  const views = new ArrowViews(network);
  const ftTransferCall = (amount: string, msg: string) =>
    account.callFunctionRaw({
      contractId: cfg.usdcToken, methodName: "ft_transfer_call", gas: GAS_300T, deposit: 1n, waitUntil: "INCLUDED_FINAL",
      args: { receiver_id: cfg.contract, amount, msg },
    });
  return {
    account, views,
    /** Registers the bench account and the market contract on the token and mints aUSD (public, capped per call). */
    async ensureSetup(wantUnits = 5_000_000n) {
      const token = cfg.usdcToken;
      const sb = await view<unknown>(network, token, "storage_balance_of", { account_id: accountId });
      if (sb === null) await account.callFunctionRaw({ contractId: cfg.usdcToken, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: 10n ** 22n, gas: 30_000_000_000_000n, waitUntil: "INCLUDED_FINAL" });
      let bal = sb === null ? 0n : BigInt(await view<string>(network, token, "ft_balance_of", { account_id: accountId }));
      while (bal < wantUnits) {
        await account.callFunctionRaw({ contractId: cfg.usdcToken, methodName: "mint", args: { receiver_id: accountId, amount: "10000000" }, gas: 30_000_000_000_000n, waitUntil: "INCLUDED_FINAL" });
        bal += 10_000_000n;
      }
      return { balance: bal };
    },
    async createListing(p: { plaintext: Uint8Array; title: string; publicDesc: string; columns: string[]; rowsClaimed: number; blobUrl: string; maxEvals: number; mode: "scored" | "verdict"; bond: string }) {
      const pk = await views.programPubkey();
      if (!pk) throw new Error("contract has no program key");
      const { msg, blobSha256 } = prepareList({ plaintext: p.plaintext, title: p.title, publicDesc: p.publicDesc, columns: p.columns, rowsClaimed: p.rowsClaimed, blobUrl: p.blobUrl, price: "100000", evalFee: "50000", maxEvals: p.maxEvals, mode: p.mode, programPk: pk });
      const tx = await ftTransferCall(p.bond, msg);
      return { tx, blobSha256, outcome: parseOutcomeLogs(tx as TxLike) };
    },
    /** Sends one eval. `raw` overrides pieces of the msg for the error-path attacks (they bypass the SDK's zod checks). */
    async submitEval(listingId: number, fee: string, criteria: Criteria | null, raw: { sealed_criteria_b64?: string; buyer_pk_hex?: string } | null) {
      const pk = await views.programPubkey();
      if (!pk) throw new Error("contract has no program key");
      const buyerPk = raw?.buyer_pk_hex ?? benchBuyerKey().pubHex;
      const sealed = raw?.sealed_criteria_b64 ?? sealCriteria(pk, criteria!);
      const msg = JSON.stringify({ op: "eval", listing_id: listingId, sealed_criteria: sealed, buyer_pk: buyerPk });
      const tx = await ftTransferCall(fee, msg);
      return String((tx as { transaction?: { hash?: string } }).transaction?.hash ?? "");
    },
    /** Polls until the callback has run or WAIT_LIMIT_MS passed. A TIMEOUT_ERROR from the RPC means "still waiting". */
    async waitEval(txHash: string, sender: string, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<{ done: boolean; outcome: Outcome }> {
      const t0 = Date.now();
      for (;;) {
        try {
          const p = Date.now() - t0 > 2 * 24 * 3600_000 ? archival : provider;
          const tx = await p.viewTransactionStatusWithReceipts({ txHash, accountId: sender, waitUntil: "EXECUTED_OPTIMISTIC" });
          const outcome = parseOutcomeLogs(tx as unknown as TxLike);
          if (outcome.success !== null || outcome.refund_reason !== null) return { done: true, outcome };
        } catch (e) {
          if (!/TIMEOUT/i.test(String((e as Error).message))) throw e;
        }
        if (Date.now() - t0 > WAIT_LIMIT_MS) return { done: false, outcome: parseOutcomeLogs({}) };
        await sleep(POLL_MS);
      }
    },
  };
}

/** `bench:offline --verify-chain`: re-reads each eval, decrypts `sealed_result` with the public bench key and compares idx. */
export async function verifyEvalsOnChain(evals: LiveEval[]): Promise<{ checked: number; proven: number; mismatch: number; skipped: number; note: string }> {
  const key = benchBuyerKey();
  let checked = 0, proven = 0, mismatch = 0, skipped = 0;
  for (const e of evals) {
    if (e.eval_id === null || e.idx === null) { skipped++; continue; }
    const views = new ArrowViews(e.network, e.contract);
    const row = await views.eval(e.eval_id);
    if (!row?.sealed_result) { skipped++; continue; }
    checked++;
    const st = decodeEvalResult(row.sealed_result, key.scalarHex, e.mode);
    if (encodeState(st, e.mode) === e.idx) proven++; else mismatch++;
  }
  return { checked, proven, mismatch, skipped, note: "evals without eval_id, idx or sealed_result" };
}
