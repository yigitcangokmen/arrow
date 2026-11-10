// A fake testnet market for the script tests (e2e-steps, try-testnet): listings, evals, purchases, refunds and balances in memory.
import { b64, demoViewingKey, encodeState, NETWORKS, scalarFromLabel, seal, unseal } from "@arrow/sdk";
import type { Ctx } from "../../../agent/src/commands.ts";
import { MOCK_PROGRAM_PK, type ViewsLike } from "../../../agent/src/views.ts";
import { fixture } from "../../../agent/test/helpers.ts";

export const BUYER = "e2e-buyer.arrowhq.testnet";
export const SELLER = "e2e-seller.arrowhq.testnet";
const CONTRACT = NETWORKS.testnet.contract;
const USDC = NETWORKS.testnet.usdcToken;
const PROGRAM_SCALAR = scalarFromLabel("arrow:test:program:v1");
const DEMO = demoViewingKey();
const BITS = 5673;

export interface Quirks {
  /** which of the two refund events the "chain" leaves out */
  omit?: "arrow_refund" | "ft_transfer";
  keepFee?: boolean;
  purchaseHash?: string;
  l1Verdict?: "BUY" | "PASS";
  l2Verdict?: "BUY" | "PASS";
}

export function world(q: Quirks = {}) {
  const listings = new Map<number, any>();
  const evals = new Map<number, any>();
  const purchases = new Map<number, any>();
  const txs = new Map<string, any>();
  const blobs = new Map<string, Uint8Array>();
  const balances = new Map<string, bigint>([[SELLER, 0n], [BUYER, 0n]]);
  const evidence: any[] = [];
  let n = 0;

  const eventTx = (executor: string, standard: string, event: string, data: unknown) => ({
    final_execution_status: "FINAL",
    transaction_outcome: { id: "t0", outcome: { executor_id: "x", logs: [] } },
    receipts_outcome: [{ id: `r${++n}`, outcome: { executor_id: executor, logs: [`EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event, data })}`] } }],
  });
  const merge = (...parts: any[]) => ({ ...parts[0], receipts_outcome: parts.flatMap((p) => p.receipts_outcome) });
  const budget = (l: any) => ({ listing_id: l.id, bits_per_eval_milli: BITS, max_evals: l.max_evals, evals_used: l.evals_used, budget_milli: l.max_evals * BITS, spent_milli: l.evals_used * BITS, left_milli: (l.max_evals - l.evals_used) * BITS });

  const views: ViewsLike = {
    config: async () => ({ ...fixture("config"), tank_available: "7000000000000000000000000" }),
    version: async () => fixture("version"),
    programPubkey: async () => MOCK_PROGRAM_PK,
    listing: async (id) => listings.get(Number(id)) ?? null,
    listings: async () => [...listings.values()],
    eval: async (id) => evals.get(Number(id)) ?? null,
    evalsByListing: async (id) => [...evals.values()].filter((e) => e.listing_id === Number(id)),
    purchase: async (id) => purchases.get(Number(id)) ?? null,
    leakBudget: async (id) => (listings.has(Number(id)) ? budget(listings.get(Number(id))) : null),
  };

  const transport: Ctx["transport"] = {
    pay: async ({ actor, amount, msg }) => {
      const m = JSON.parse(msg);
      const hash = `tx${++n}`;
      balances.set(actor.id, (balances.get(actor.id) ?? 0n) - amount);
      if (m.op === "list") {
        const id = listings.size + 1;
        listings.set(id, { id, seller: actor.id, title: m.title, public_desc: m.public_desc, columns: m.columns, rows_claimed: m.rows_claimed, blob_url: m.blob_url, blob_sha256: m.blob_sha256, sealed_k: m.sealed_k, price: m.price, eval_fee: m.eval_fee, max_evals: m.max_evals, evals_used: 0, bits_per_eval_milli: BITS, mode: m.mode, created_at_ns: 1 });
        txs.set(hash, eventTx(CONTRACT, "arrow", "arrow_listed", { listing_id: id, seller: actor.id }));
      } else if (m.op === "eval") {
        const l = listings.get(m.listing_id);
        l.evals_used++;
        const id = evals.size + 1;
        const accepted = eventTx(CONTRACT, "arrow", "arrow_eval", { phase: "accepted", listing_id: l.id, eval_id: id, buyer: actor.id });
        const broken = l.blob_url.includes(".invalid");
        const rec: any = { id, listing_id: l.id, buyer: actor.id, buyer_pk: m.buyer_pk, fee: l.eval_fee, status: "done", sealed_result: null, h: l.blob_sha256, refund_reason: null };
        if (broken) {
          Object.assign(rec, { status: "refunded", h: null, refund_reason: "not_ok" });
          const parts = [accepted];
          if (q.omit !== "arrow_refund") parts.push(eventTx(CONTRACT, "arrow", "arrow_refund", { kind: "eval", listing_id: l.id, id, reason: "not_ok", amount: l.eval_fee }));
          if (q.omit !== "ft_transfer") parts.push(eventTx(USDC, "nep141", "ft_transfer", [{ old_owner_id: CONTRACT, new_owner_id: actor.id, amount: l.eval_fee, memo: "refund" }]));
          txs.set(hash, merge(...parts));
          if (!q.keepFee) balances.set(actor.id, (balances.get(actor.id) ?? 0n) + amount);
        } else {
          const verdict = (l.title.includes("unlock") ? q.l1Verdict ?? "PASS" : q.l2Verdict ?? "BUY") as "BUY" | "PASS";
          rec.sealed_result = b64.enc(seal(m.buyer_pk, Uint8Array.of(encodeState({ verdict, fit: 4, novelty: verdict === "PASS" ? 1 : 4 }, "scored"))));
          txs.set(hash, accepted);
        }
        evals.set(id, rec);
      } else {
        const l = listings.get(m.listing_id);
        const id = purchases.size + 1;
        const k = unseal(PROGRAM_SCALAR, b64.dec(l.sealed_k)).subarray(0, 32);
        purchases.set(id, { id, listing_id: l.id, buyer: actor.id, buyer_pk: m.buyer_pk, price: l.price, status: "done", sealed_k_buyer: b64.enc(seal(m.buyer_pk, k)), h: q.purchaseHash ?? l.blob_sha256, refund_reason: null });
        txs.set(hash, eventTx(CONTRACT, "arrow", "arrow_purchase", { phase: "accepted", listing_id: l.id, purchase_id: id, buyer: actor.id }));
      }
      return { txHash: hash, signerId: actor.id, url: `https://testnet.nearblocks.io/txns/${hash}` };
    },
    transfer: async () => {
      throw new Error("not used");
    },
  };

  const ctx: Ctx = {
    network: "testnet",
    views,
    transport,
    actor: (role) => ({ network: "testnet", id: role === "buyer" ? BUYER : SELLER, nearSecret: "ed25519:test" as any, viewingKey: async () => DEMO }),
    confirm: async () => {},
    evidence: (run) => void evidence.push({ ...run, script: "scripts/src/e2e-testnet.ts" }),
    fetchImpl: (async (url: string) => {
      const b = blobs.get(String(url));
      return b ? new Response(b as BodyInit) : new Response("nope", { status: 404 });
    }) as typeof fetch,
    wait: { sleep: async () => {}, everyMs: 0, txStatusImpl: (async (_n: string, hash: string) => txs.get(hash)) as any },
  };
  return { ctx, evidence, listings, balances, blobs, txs };
}
