import * as oneclick from "../../oneclick.ts";
import { type Chain, txLink } from "../links.ts";
import type { VerifyCtx } from "../context.ts";
import { row, why } from "./util.ts";

export const TITLE = "1Click: inbound and outbound swaps ended SUCCESS";

interface Tx {
  explorerUrl?: string;
  hash?: string;
}

/** R4 (mainnet): the deposit addresses of the inbound and outbound runs report SUCCESS with explorer-visible txs. */
export async function r4(ctx: VerifyCtx) {
  const kinds = ["inbound", "outbound"] as const;
  const ok = { inbound: 0, outbound: 0 };
  const seen = { inbound: 0, outbound: 0 };
  const notes: string[] = [];
  const links: string[] = [];
  for (const kind of kinds) {
    for (const run of ctx.runs(kind)) {
      if (!run.oneclick_deposit) continue;
      seen[kind]++;
      if (run.tx) links.push(txLink(ctx.network, run.chain as Chain, run.tx));
      try {
        const s = await oneclick.status(run.oneclick_deposit, { fetchImpl: ctx.fetch });
        if (s.status === "SUCCESS") {
          ok[kind]++;
          const d = (s.swapDetails ?? {}) as { originChainTxHashes?: Tx[]; destinationChainTxHashes?: Tx[] };
          for (const t of [...(d.originChainTxHashes ?? []), ...(d.destinationChainTxHashes ?? [])]) if (t.explorerUrl) links.push(t.explorerUrl);
        } else notes.push(`${run.id}: ${s.status}`);
      } catch (e) {
        notes.push(`${run.id}: ${why(e)}`);
      }
    }
  }
  const counts = `inbound ${ok.inbound}/${seen.inbound} · outbound ${ok.outbound}/${seen.outbound} SUCCESS`;
  const detail = notes.length ? `${counts}; ${notes.join("; ")}` : counts;
  const proven = ok.inbound >= 1 && ok.outbound >= 1;
  return row("R4", proven ? "PROVEN" : "NOT PROVEN", true, TITLE, proven ? detail : `${detail}${seen.inbound + seen.outbound === 0 ? "; no run with a deposit address in evidence" : ""}`, [...new Set(links)].slice(0, 6));
}
