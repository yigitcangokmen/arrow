import { DOD_TARGETS } from "../config.ts";
import { num, type VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "counts against the definition-of-done targets";

/** A team account is listed in team-accounts.json or is a subaccount of a team root (DEC H-07, Q-07). */
function isTeam(ctx: VerifyCtx, account: string): boolean {
  const t = ctx.opts.teamAccounts;
  const a = account.toLowerCase();
  if ((t?.near ?? []).some((n) => n.toLowerCase() === a)) return true;
  if ((t?.evm ?? []).some((e) => e.address.toLowerCase() === a)) return true;
  return a === "arrowhq.near" || a === "arrowhq.testnet" || a.endsWith(".arrowhq.near") || a.endsWith(".arrowhq.testnet");
}

const count = (ctx: VerifyCtx, kind: Parameters<VerifyCtx["runs"]>[0]) => ctx.runs(kind).length;

/** I4: no label; the counts are printed as PROVEN when every target is met and NOT PROVEN otherwise. Never REQUIRED. */
export async function i4(ctx: VerifyCtx) {
  const listings = await ctx.listings();
  let externalListings = 0;
  let externalEvals = 0;
  let totalEvals = 0;
  for (const l of listings) {
    if (!isTeam(ctx, l.seller)) externalListings++;
    for (const e of await ctx.evalsOf(num(l.id))) {
      totalEvals++;
      if (!isTeam(ctx, e.buyer)) externalEvals++;
    }
  }
  const evalRuns = ctx.runs("eval");
  const has = (word: string) => evalRuns.filter((r) => new RegExp(`\\b${word}\\b`).test(r.observed)).length;
  const c = {
    listing: Math.max(listings.length, count(ctx, "list")),
    eval: Math.max(totalEvals, evalRuns.length),
    pass: has("PASS"),
    buy: has("BUY"),
    purchase: count(ctx, "buy"),
    refund: count(ctx, "refund"),
    inbound: count(ctx, "inbound"),
    outbound: count(ctx, "outbound"),
  };
  const mainnet = ctx.network === "mainnet";
  const met =
    c.listing >= DOD_TARGETS.listings && c.eval >= DOD_TARGETS.evals && c.pass >= 1 && c.buy >= 1 && c.purchase >= DOD_TARGETS.purchases &&
    c.refund >= DOD_TARGETS.refunds && (!mainnet || (c.inbound >= DOD_TARGETS.inbound && c.outbound >= DOD_TARGETS.outbound));
  const money = mainnet ? ` · inbound ${c.inbound}/${DOD_TARGETS.inbound} · outbound ${c.outbound}/${DOD_TARGETS.outbound}` : "";
  const detail =
    `listings ${c.listing}/${DOD_TARGETS.listings} · evals ${c.eval}/${DOD_TARGETS.evals} (PASS ${c.pass}, BUY ${c.buy}; from the runs' observed text) · ` +
    `purchases ${c.purchase}/${DOD_TARGETS.purchases} · refunds ${c.refund}/${DOD_TARGETS.refunds}${money} · ` +
    `external: ${externalListings} listings, ${externalEvals} evals (sellers and buyers not in team-accounts.json)`;
  return row("I4", met ? "PROVEN" : "NOT PROVEN", false, TITLE, detail);
}
