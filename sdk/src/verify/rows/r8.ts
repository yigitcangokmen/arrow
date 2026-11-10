import { BITS_PER_EVAL_MILLI } from "../../bits.ts";
import { num, type VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "G1: leak_budget is consistent for every listing";

/** R8: spent = evals_used x bits_per_eval, budget = max_evals x bits_per_eval, left = budget - spent, rate fits the mode. */
export async function r8(ctx: VerifyCtx) {
  const listings = await ctx.listings();
  if (listings.length === 0) return row("R8", "NOT PROVEN", true, TITLE, `no listings on ${ctx.contract}`);
  const bad: string[] = [];
  let totalUsed = 0;
  for (const l of listings) {
    const id = num(l.id);
    const lb = await ctx.leakBudget(id);
    if (!lb) {
      bad.push(`listing #${id}: no leak_budget`);
      continue;
    }
    const p: string[] = [];
    if (lb.spent_milli !== lb.evals_used * lb.bits_per_eval_milli) p.push(`spent ${lb.spent_milli} != ${lb.evals_used} x ${lb.bits_per_eval_milli}`);
    if (lb.budget_milli !== lb.max_evals * lb.bits_per_eval_milli) p.push(`budget ${lb.budget_milli} != ${lb.max_evals} x ${lb.bits_per_eval_milli}`);
    if (lb.left_milli !== lb.budget_milli - lb.spent_milli) p.push(`left ${lb.left_milli} != budget - spent`);
    if (lb.bits_per_eval_milli !== BITS_PER_EVAL_MILLI[l.mode]) p.push(`${lb.bits_per_eval_milli} milli-bits per eval does not fit mode ${l.mode}`);
    if (lb.evals_used !== l.evals_used || lb.max_evals !== l.max_evals) p.push("leak_budget disagrees with the listing view");
    // STATE-6: the arithmetic above always holds for this contract; the counter itself is checked against the eval records.
    // mt_on_transfer increments evals_used and appends to evals_by_listing in the same receipt, so they must be equal.
    const evals = await ctx.evalsOf(id);
    if (evals.length !== lb.evals_used) p.push(`get_evals_by_listing has ${evals.length} evals, evals_used is ${lb.evals_used}`);
    const odd = evals.filter((e) => num(e.listing_id) !== id || !["pending", "done", "refunded"].includes(e.status));
    if (odd.length) p.push(`eval${odd.length === 1 ? "" : "s"} ${odd.map((e) => `#${e.id}`).join(", ")} with another listing id or an unknown status`);
    // Evidence knows a run per eval or refunded eval; the contract never counts fewer than that.
    const runs = new Set(ctx.runs("eval", "refund").filter((r) => r.listing_id !== null && num(r.listing_id) === id && r.eval_id !== null).map((r) => String(r.eval_id)));
    const anon = ctx.runs("eval").filter((r) => r.listing_id !== null && num(r.listing_id) === id && r.eval_id === null).length;
    if (runs.size + anon > lb.evals_used) p.push(`evidence has ${runs.size + anon} eval runs, contract counts ${lb.evals_used}`);
    totalUsed += lb.evals_used;
    if (p.length) bad.push(`listing #${id}: ${p.join(", ")}`);
  }
  if (bad.length) return row("R8", "NOT PROVEN", true, TITLE, bad.join("; "));
  return row("R8", "PROVEN", true, TITLE, `${listings.length} listing${listings.length === 1 ? "" : "s"}, ${totalUsed} evals counted, spent == evals_used x bits_per_eval`);
}
