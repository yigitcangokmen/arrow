import { rpc } from "../../rpc.ts";
import type { VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "every listing is labelled pre-lock or post-lock";

/** Lock time in ns: the block header at the recorded height, else the recorded UTC time. */
async function lockNs(ctx: VerifyCtx): Promise<bigint | null> {
  const { block_height, timestamp_utc } = ctx.evidence.lock;
  if (block_height !== null) {
    try {
      const b = await rpc<{ header: { timestamp_nanosec: string } }>(ctx.network, "block", { block_id: block_height }, { ...ctx.rpcOpts, archival: true });
      return BigInt(b.header.timestamp_nanosec);
    } catch {
      // fall through to the recorded time
    }
  }
  return timestamp_utc ? BigInt(Date.parse(timestamp_utc)) * 1_000_000n : null;
}

/** R7 (mainnet): listing.created_at_ns < the lock block's time means the listing predates the lock. */
export async function r7(ctx: VerifyCtx) {
  if (ctx.opts.unlockedReason) {
    return row("R7", "RISKY", false, "listings cannot be labelled pre-lock: the contract was not locked", ctx.opts.unlockedReason);
  }
  const listings = await ctx.listings();
  if (listings.length === 0) return row("R7", "NOT PROVEN", true, TITLE, `no listings on ${ctx.contract}`);
  if (ctx.opts.preLock) {
    return row("R7", "PROVEN", true, TITLE, `${listings.length} listing${listings.length === 1 ? "" : "s"}: pre-lock (lock pending)`);
  }
  if (!ctx.evidence.lock.tx) return row("R7", "NOT PROVEN", true, TITLE, "no lock in evidence, so the lock time is unknown (run with --pre-lock before the lock)");
  const at = await lockNs(ctx);
  if (at === null) return row("R7", "NOT PROVEN", true, TITLE, "lock block time unavailable");
  const pre = listings.filter((l) => BigInt(String(l.created_at_ns)) < at).length;
  return row("R7", "PROVEN", true, TITLE, `${listings.length} listings: ${pre} pre-lock · ${listings.length - pre} post-lock`);
}
