// Fakes shared by the CLI and MCP tests: in-memory views, a recording transport and an "enclave" that answers evals.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { b64, demoViewingKey, encodeState, publicKeyHex, scalarFromLabel, seal, type State } from "@arrow/sdk";
import type { Ctx } from "../src/commands.ts";
import type { Transport } from "../src/transport.ts";
import type { ViewsLike } from "../src/views.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const VIEWS_DIR = resolve(ROOT, "sdk/test/fixtures/views");
export const fixture = (name: string) => JSON.parse(readFileSync(resolve(VIEWS_DIR, `${name}.json`), "utf8"));
export const PROGRAM_PK = publicKeyHex(scalarFromLabel("arrow:test:program:v1"));
export const DEMO = demoViewingKey();

export const NEAR_TX = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // shaped like a NEAR tx hash (base58)

export function eventTx(event: string, data: object) {
  return {
    final_execution_status: "NONE",
    transaction_outcome: { id: "r0", outcome: { executor_id: "x", logs: [] } },
    receipts_outcome: [{ id: "r1", outcome: { executor_id: "arrow.arrowhq.testnet", logs: [`EVENT_JSON:${JSON.stringify({ standard: "arrow", version: "1.0.0", event, data })}`] } }],
  };
}

export interface Fake {
  ctx: Ctx;
  payCalls: { amount: bigint; msg: string; actorId: string }[];
  transferCalls: { toId: string; amount: bigint; actorId: string }[];
  evidence: unknown[];
  progress: string[];
  state: { records: Record<string, any>; listing: any; budget: any; txEvents: any };
}

export function fakeCtx(o: { network?: "testnet" | "mainnet"; listing?: object; budget?: object; fetchImpl?: typeof fetch; verdict?: State; refund?: string; accepted?: { event: string; data: object } } = {}): Fake {
  const network = o.network ?? "testnet";
  const listing = { ...fixture("listing"), ...o.listing };
  const budget = { ...fixture("leak_budget"), ...o.budget };
  const records: Record<string, any> = {};
  const payCalls: Fake["payCalls"] = [];
  const transferCalls: Fake["transferCalls"] = [];
  const evidence: unknown[] = [];
  const progress: string[] = [];
  const txEvents: { current: any } = { current: eventTx("arrow_eval", { phase: "accepted", listing_id: 1, eval_id: 9, buyer: "x", fee: "100000", spent_milli: 0, left_milli: 0 }) };

  const views: ViewsLike = {
    config: async () => fixture("config"),
    version: async () => fixture("version"),
    programPubkey: async () => PROGRAM_PK,
    listing: async (id) => (Number(id) === Number(listing.id) ? listing : null),
    listings: async () => [listing],
    leakBudget: async () => budget,
    eval: async (id) => records[`eval:${id}`] ?? null,
    evalsByListing: async () => Object.entries(records).filter(([k]) => k.startsWith("eval:")).map(([, v]) => v),
    purchase: async (id) => records[`purchase:${id}`] ?? null,
  };
  const transport: Transport = {
    pay: async ({ actor, amount, msg }) => {
      payCalls.push({ amount, msg, actorId: actor.id });
      const parsed = JSON.parse(msg);
      if (parsed.op === "eval") {
        const state = o.verdict ?? { verdict: "PASS" as const, fit: 4, novelty: 1 };
        records["eval:9"] = o.refund
          ? { ...fixture("eval"), id: 9, status: "refunded", sealed_result: null, h: null, refund_reason: o.refund }
          : { ...fixture("eval"), id: 9, buyer_pk: parsed.buyer_pk, status: "done", sealed_result: b64.enc(seal(parsed.buyer_pk, Uint8Array.of(encodeState(state, listing.mode)))) };
      }
      return { txHash: NEAR_TX, signerId: actor.id, url: `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${NEAR_TX}` };
    },
    transfer: async ({ actor, toId, amount }) => {
      transferCalls.push({ toId, amount, actorId: actor.id });
      return { txHash: NEAR_TX, signerId: "arrow-relayer.arrowhq.near", url: `https://nearblocks.io/txns/${NEAR_TX}` };
    },
  };
  const ctx: Ctx = {
    network,
    contract: network === "mainnet" ? "arrow-market.near" : "arrow-v2.arrowhq.testnet",
    views,
    transport,
    actor: (role) => ({ network, id: network === "mainnet" ? (role === "buyer" ? "0x" + "b".repeat(40) : "0x" + "5".repeat(40)) : `e2e-${role}.arrowhq.testnet`, viewingKey: async () => DEMO }),
    confirm: async () => {},
    evidence: (run) => void evidence.push(run),
    fetchImpl: o.fetchImpl,
    progress: (l) => void progress.push(l),
    wait: {
      sleep: async () => {},
      everyMs: 0,
      txStatusImpl: (async () => (o.accepted ? eventTx(o.accepted.event, o.accepted.data) : txEvents.current)) as any,
    },
  };
  return { ctx, payCalls, transferCalls, evidence, progress, state: { records, listing, budget, txEvents } };
}
