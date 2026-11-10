import { viewAccessKeyList, viewAccount } from "../../rpc.ts";
import type { VerifyCtx } from "../context.ts";
import { txLink } from "../links.ts";
import { row } from "./util.ts";

export const TITLE = "lock: the contract account has no access keys";

/** Mainnet only. Pre-lock the row is informational; with an unlocked reason it is RISKY. Neither counts as REQUIRED. */
export async function r6(ctx: VerifyCtx) {
  const lock = ctx.evidence.lock;
  if (ctx.opts.unlockedReason) {
    return row("R6", "RISKY", false, "contract not locked (keys held by arrowhq team)", ctx.opts.unlockedReason);
  }
  if (ctx.opts.preLock) {
    let now = "access keys unknown";
    try {
      const deployed = !/^1+$/.test((await viewAccount(ctx.network, ctx.contract, ctx.rpcOpts)).code_hash);
      const n = (await viewAccessKeyList(ctx.network, ctx.contract, ctx.rpcOpts)).keys.length;
      now = deployed ? `${n} access key${n === 1 ? "" : "s"} on ${ctx.contract} now` : `no contract deployed on ${ctx.contract} yet`;
    } catch {
      // the account may not exist yet; the row is not counted anyway
    }
    return row("R6", "NOT PROVEN", false, TITLE, `lock pending (H-16): ${now}`);
  }
  if (!lock.tx) return row("R6", "NOT PROVEN", true, TITLE, "no lock tx in evidence");
  // An account that does not exist (or has no contract) has no keys either, which proves nothing about a lock.
  const account = await viewAccount(ctx.network, ctx.contract, ctx.rpcOpts);
  if (/^1+$/.test(account.code_hash)) return row("R6", "NOT PROVEN", true, TITLE, `${ctx.contract} has no contract code deployed`);
  const keys = (await viewAccessKeyList(ctx.network, ctx.contract, ctx.rpcOpts)).keys;
  if (keys.length > 0) return row("R6", "NOT PROVEN", true, TITLE, `${ctx.contract} still has ${keys.length} access key${keys.length === 1 ? "" : "s"}`);
  const tx = await ctx.tx(lock.tx, [ctx.contract]);
  const actions: any[] = tx?.transaction?.actions ?? [];
  const succeeded = tx?.status && "SuccessValue" in tx.status;
  const deleteKeys = actions.filter((a) => a === "DeleteKey" || a?.DeleteKey !== undefined);
  if (tx?.transaction?.signer_id !== ctx.contract) return row("R6", "NOT PROVEN", true, TITLE, `lock tx signer is ${String(tx?.transaction?.signer_id)}, not ${ctx.contract}`);
  if (deleteKeys.length === 0 || !succeeded) return row("R6", "NOT PROVEN", true, TITLE, `lock tx has ${deleteKeys.length} DeleteKey action(s), ${succeeded ? "succeeded" : "did not succeed"}`);
  return row("R6", "PROVEN", true, TITLE, `0 access keys · ${deleteKeys.length} DeleteKey signed by ${ctx.contract}`, [txLink(ctx.network, "near", lock.tx)]);
}
