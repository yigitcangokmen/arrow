import { isTeamAccount } from "../../team.ts";
import { DOD_TARGETS } from "../config.ts";
import { num, type VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "counts against the definition-of-done targets";

function isTeam(ctx: VerifyCtx, account: string): boolean {
  const t = ctx.opts.teamAccounts;
  return isTeamAccount(account, [...(t?.near ?? []), ...(t?.evm ?? []).map((e) => e.address)]);
}

/** "a, b, c (+2 more)": the ids behind a count, so a team account missing from team-accounts.json shows up. */
function ids(set: Set<string>): string {
  const all = [...set];
  return all.length === 0 ? "none" : all.slice(0, 5).join(", ") + (all.length > 5 ? ` (+${all.length - 5} more)` : "");
}

const count = (ctx: VerifyCtx, kind: Parameters<VerifyCtx["runs"]>[0]) => ctx.runs(kind).length;

/** I4: no label; the counts are printed as PROVEN when every target is met and NOT PROVEN otherwise. Never REQUIRED. */
export async function i4(ctx: VerifyCtx) {
  const listings = await ctx.listings();
  const externalSellers = new Set<string>();
  const externalBuyers = new Set<string>();
  let externalListings = 0;
  let externalEvals = 0;
  let totalEvals = 0;
  for (const l of listings) {
    if (!isTeam(ctx, l.seller)) {
      externalListings++;
      externalSellers.add(l.seller);
    }
    for (const e of await ctx.evalsOf(num(l.id))) {
      totalEvals++;
      if (!isTeam(ctx, e.buyer)) {
        externalEvals++;
        externalBuyers.add(e.buyer);
      }
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
    `external: ${externalListings} listings, ${externalEvals} evals (sellers and buyers not in team-accounts.json). External sellers: ${ids(externalSellers)}. External buyers: ${ids(externalBuyers)}`;
  return row("I4", met ? "PROVEN" : "NOT PROVEN", false, TITLE, detail);
}
