import { num, type VerifyCtx } from "../context.ts";
import { txLink } from "../links.ts";
import { parseEvents, type NearEvent } from "../../rpc.ts";
import { row, why } from "./util.ts";

export const TITLE = "refunds: arrow_refund event + the USDC transfer back to the buyer, same amount";

const items = (e: NearEvent): any[] => (Array.isArray(e.data) ? e.data : [e.data]);
const isRefundMemo = (m: unknown): boolean => m === "refund" || (typeof m === "string" && m.startsWith("arrow:refund:"));

/** R5: every refund run shows both events, and the transfer goes to the buyer for the refunded amount. */
export async function r5(ctx: VerifyCtx) {
  const runs = ctx.runs("refund").filter((r) => r.tx);
  if (runs.length === 0) return row("R5", "NOT PROVEN", true, TITLE, "no refund run in evidence");
  const mainnet = ctx.network === "mainnet";
  const transferStandard = mainnet ? "nep245" : "nep141";
  const transferEvent = mainnet ? "mt_transfer" : "ft_transfer";
  const transferExecutor = mainnet ? ctx.cfg.intents : ctx.cfg.usdcToken;
  const good: string[] = [];
  const bad: string[] = [];
  const links: string[] = [];
  for (const run of runs) {
    try {
      const events = parseEvents(await ctx.tx(run.tx!));
      const refund = events
        .filter((e) => e.standard === "arrow" && e.event === "arrow_refund" && e.executorId === ctx.contract)
        .flatMap((e) => items(e))
        .find((d) => (run.eval_id === null && run.purchase_id === null) || num(d.id) === num((run.eval_id ?? run.purchase_id)!));
      if (!refund) {
        bad.push(`${run.id}: no arrow_refund event from ${ctx.contract}`);
        continue;
      }
      const record = refund.kind === "eval" ? await ctx.eval(refund.id) : await ctx.purchase(refund.id);
      if (!record) {
        bad.push(`${run.id}: ${refund.kind} #${refund.id} not found`);
        continue;
      }
      const amount = String(refund.amount);
      const transfer = events
        .filter((e) => e.standard === transferStandard && e.event === transferEvent && e.executorId === transferExecutor)
        .flatMap((e) => items(e))
        .find((d) => isRefundMemo(d.memo) && d.new_owner_id === record.buyer);
      if (!transfer) {
        bad.push(`${run.id}: no ${transferEvent} with a refund memo to ${record.buyer}`);
        continue;
      }
      const moved = String(Array.isArray(transfer.amounts) ? transfer.amounts[0] : transfer.amount);
      const token = Array.isArray(transfer.token_ids) ? transfer.token_ids[0] : undefined;
      if (moved !== amount) bad.push(`${run.id}: refunded ${moved}, arrow_refund says ${amount}`);
      else if (mainnet && token !== ctx.cfg.usdcToken) bad.push(`${run.id}: refund token ${String(token)} is not USDC`);
      else {
        good.push(`${run.id}: ${refund.kind} #${refund.id} ${refund.reason}, ${amount} units back to ${record.buyer}`);
        links.push(txLink(ctx.network, "near", run.tx!));
      }
    } catch (e) {
      bad.push(`${run.id}: ${why(e)}`);
    }
  }
  if (bad.length) return row("R5", "NOT PROVEN", true, TITLE, bad.join("; "), links);
  return row("R5", "PROVEN", true, TITLE, `${good.length} refund${good.length === 1 ? "" : "s"}: ${good.slice(0, 2).join(" | ")}`, links.slice(0, 3));
}
