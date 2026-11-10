// "Copy evidence JSON": one PLAN A.3 run for scripts/src/evidence-add.ts --file. The tool fills id, commit, timestamp
// and block height. No keys, no data rows: only ids, tx hashes and the claim we want recorded.
import type { EvidenceRun } from "@arrow/sdk/schemas";

export type WebRunKind = "list" | "eval" | "buy" | "refund" | "inbound" | "outbound";

export interface WebRun {
  kind: WebRunKind;
  tx: string | null;
  chain: "near" | "base" | "solana";
  listing_id?: number | null;
  eval_id?: number | null;
  purchase_id?: number | null;
  oneclick_deposit?: string | null;
  expect: string;
  observed: string;
}

export function webRun(r: WebRun): Pick<EvidenceRun, "kind" | "tx" | "chain" | "listing_id" | "eval_id" | "purchase_id" | "oneclick_deposit" | "expect" | "observed" | "script"> {
  return {
    kind: r.kind,
    tx: r.tx,
    chain: r.chain,
    listing_id: r.listing_id ?? null,
    eval_id: r.eval_id ?? null,
    purchase_id: r.purchase_id ?? null,
    oneclick_deposit: r.oneclick_deposit ?? null,
    expect: r.expect,
    observed: r.observed,
    script: "web",
  };
}

export const evidenceJson = (r: WebRun): string => JSON.stringify(webRun(r), null, 2);
