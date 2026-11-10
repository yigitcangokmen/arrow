import { txLink } from "../links.ts";
import { requestEvents, type EvalFacts, type VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "attestation binds the eval tx: transaction_hash == eval tx, request made through the market contract";

/** True when the tx has a request_execution receipt to OutLayer whose predecessor is the market contract. */
function requestedByContract(tx: any, outlayer: string, contract: string): boolean {
  for (const r of tx?.receipts ?? []) {
    if (r?.receiver_id !== outlayer || r?.predecessor_id !== contract) continue;
    if ((r.receipt?.Action?.actions ?? []).some((a: any) => a?.FunctionCall?.method_name === "request_execution")) return true;
  }
  return false;
}

/**
 * What is wrong with one eval, or [] when its attestation is bound to the evidence tx and the contract.
 * OutLayer's caller_account_id is the signer of the transaction (the buyer on testnet, the relayer on mainnet), never the
 * contract, so the contract is proven by the tx's own receipts: contract -> OutLayer request_execution.
 */
function problems(ctx: VerifyCtx, f: EvalFacts): string[] {
  const a = f.attestation!;
  const out: string[] = [];
  if (a.transaction_hash !== f.run.tx) out.push(`attestation names tx ${a.transaction_hash}, evidence tx is ${f.run.tx}`);
  const signer = f.tx?.transaction?.signer_id;
  if (a.caller_account_id !== signer) out.push(`attestation caller ${a.caller_account_id} is not the tx signer ${signer}`);
  if (!requestedByContract(f.tx, ctx.cfg.outlayer, ctx.contract)) out.push(`tx has no request_execution from ${ctx.contract} to ${ctx.cfg.outlayer}`);
  const ev = requestEvents(f.tx).find((e) => e.requestId === f.requestId);
  if (ev?.predecessorId && ev.predecessorId !== ctx.contract) out.push(`execution_requested predecessor is ${ev.predecessorId}, not ${ctx.contract}`);
  return out;
}

/** R2: OutLayer's record for this request names this transaction, and that transaction made the request through the contract. */
export async function r2(ctx: VerifyCtx) {
  const all = await ctx.evalFacts();
  if (all.length === 0) return row("R2", "NOT PROVEN", true, TITLE, "no eval run with a tx in evidence");
  const good: string[] = [];
  const bad: string[] = [];
  const links: string[] = [];
  for (const f of all) {
    if (!f.attestation) continue;
    const why = problems(ctx, f);
    if (why.length === 0) {
      good.push(`${f.run.id} (request ${f.requestId}, signed by ${f.attestation.caller_account_id})`);
      links.push(txLink(ctx.network, "near", f.run.tx!));
    } else {
      bad.push(`${f.run.id}: ${why.join(", ")}`);
    }
  }
  if (bad.length) return row("R2", "NOT PROVEN", true, TITLE, bad.join("; "), links);
  if (good.length === 0) {
    const notes = [...new Set(all.map((f) => f.note))].join(", ");
    return row("R2", "NOT PROVEN", true, TITLE, `no eval has a stored attestation (${notes})`);
  }
  return row("R2", "PROVEN", true, TITLE, `${good.length} of ${all.length} evals: ${good.slice(0, 3).join(", ")}${good.length > 3 ? ", …" : ""}`, links.slice(0, 3));
}
