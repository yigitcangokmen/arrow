import { outputHashOrder } from "../attestation.ts";
import { num, type VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "attestation output_hash == sha256 of the eval output {v,ok,r,h}";

/** I1: rebuilds the output from the eval record (r = sealed_result, h) and compares it to OutLayer's output_hash. */
export async function i1(ctx: VerifyCtx) {
  const required = (ctx.opts.semantics ?? "source-read") === "confirmed-s1b";
  const facts = (await ctx.evalFacts()).filter((f) => f.attestation && f.run.eval_id !== null);
  if (facts.length === 0) return row("I1", "NOT PROVEN", required, TITLE, "no eval run with a stored attestation and an eval id");
  const orders = new Set<string>();
  const bad: string[] = [];
  for (const f of facts) {
    const e = await ctx.eval(num(f.run.eval_id!));
    if (!e || e.status !== "done" || !e.sealed_result || !e.h) {
      bad.push(`${f.run.id}: eval #${f.run.eval_id} is not a completed eval`);
      continue;
    }
    const order = outputHashOrder(f.attestation!, e.sealed_result, e.h);
    if (order) orders.add(order);
    else bad.push(`${f.run.id}: output_hash matches neither key order`);
  }
  if (bad.length || orders.size === 0) return row("I1", "NOT PROVEN", required, TITLE, bad.join("; ") || "no completed eval to compare");
  return row("I1", "PROVEN", required, TITLE, `matches on ${facts.length} eval${facts.length === 1 ? "" : "s"}; serde key order: ${[...orders].join(", ")}`);
}
