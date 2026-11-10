import { txLink } from "../links.ts";
import type { VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "attestation binds the eval tx: transaction_hash == eval tx, caller == contract";

/** R2: OutLayer's record for this request names this transaction and this contract. */
export async function r2(ctx: VerifyCtx) {
  const all = await ctx.evalFacts();
  if (all.length === 0) return row("R2", "NOT PROVEN", true, TITLE, "no eval run with a tx in evidence");
  const good: string[] = [];
  const bad: string[] = [];
  const links: string[] = [];
  for (const f of all) {
    const a = f.attestation;
    if (!a) continue;
    // On mainnet the relayer's execute_intents tx is the one OutLayer saw, and that is the evidence tx.
    if (a.transaction_hash === f.run.tx && a.caller_account_id === ctx.contract) {
      good.push(`${f.run.id} (request ${f.requestId})`);
      links.push(txLink(ctx.network, "near", f.run.tx!));
    } else {
      bad.push(`${f.run.id}: attestation tx ${a.transaction_hash} / caller ${a.caller_account_id} vs evidence tx ${f.run.tx} / ${ctx.contract}`);
    }
  }
  if (bad.length) return row("R2", "NOT PROVEN", true, TITLE, bad.join("; "), links);
  if (good.length === 0) {
    const notes = [...new Set(all.map((f) => f.note))].join(", ");
    return row("R2", "NOT PROVEN", true, TITLE, `no eval has a stored attestation (${notes})`);
  }
  return row("R2", "PROVEN", true, TITLE, `${good.length} of ${all.length} evals: ${good.slice(0, 3).join(", ")}${good.length > 3 ? ", …" : ""}`, links.slice(0, 3));
}
