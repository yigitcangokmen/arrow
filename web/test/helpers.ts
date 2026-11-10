import { readFileSync } from "node:fs";
import type { MultiPayload } from "@arrow/sdk/schemas";
import { NETWORKS } from "@arrow/sdk/config";
import { marketStateFrom } from "../lib/blockers.ts";
import type { Listing } from "@arrow/sdk/schemas";

export const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
export const USDC = NETWORKS.mainnet.usdcToken;
export const SIGNER = "0xb5ef360e42056049f584fd03bf0fb9b208e28387";

const vectors = JSON.parse(readFileSync(new URL("../../fixtures/msg-vectors.json", import.meta.url), "utf8"));
/** A valid msg object from fixtures/msg-vectors.json by name. */
export const vectorMsg = (name: string): Record<string, unknown> => vectors.valid.find((v: any) => v.name === name).msg;
export const MSGS = { list: "list_scored_full", eval: "eval_min", buy: "buy_min", rehost: "rehost_min" } as const;

export interface Overrides {
  payload?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  msg?: unknown;
  standard?: string;
}

/** A multipayload that passes validateArrowMultipayload; each override breaks exactly one thing. */
export function makeMp(op: keyof typeof MSGS = "eval", o: Overrides = {}): MultiPayload {
  const intent = {
    intent: "transfer",
    receiver_id: "arrow-market.near",
    tokens: { [USDC]: "2000000" },
    msg: JSON.stringify(o.msg ?? vectorMsg(MSGS[op])),
    min_gas: "300000000000000",
    ...o.intent,
  };
  const payload = {
    signer_id: SIGNER,
    verifying_contract: "intents.near",
    deadline: new Date(NOW + 10 * 60_000).toISOString(),
    nonce: "AAAA",
    intents: [intent],
    ...o.payload,
  };
  return { standard: (o.standard ?? "erc191") as "erc191", payload: JSON.stringify(payload), signature: "secp256k1:AAAA" };
}

export const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

export const listingFixture = (over: Partial<Listing> = {}): Listing =>
  ({
    id: 1,
    seller: "someone.near",
    title: "[synthetic] Sales sample",
    public_desc: "d",
    columns: ["a"],
    rows_claimed: 100,
    blob_url: "https://example.com/blobs/x.bin",
    blob_sha256: "a".repeat(64),
    sealed_k: "x",
    price: "2000000",
    eval_fee: "250000",
    max_evals: 50,
    evals_used: 3,
    bits_per_eval_milli: 5673,
    mode: "scored",
    program_hash_at_list: "aa",
    created_at_ns: 1,
    ...over,
  }) as Listing;

/** A market that accepts everything: not paused, key set, plenty of tank, program hash "aa" (the listing fixture's). */
export const healthyMarket = marketStateFrom(
  {
    paused: false,
    tank_available: "500000000000000000000000",
    payment_path: "notify",
    result_path: "chain",
    build: "mainnet",
    config: { tank_min: "50000000000000000000000", outlayer_deposit_eval: "20000000000000000000000", outlayer_deposit_release: "10000000000000000000000", program_wasm_hash: "aa" },
  } as never,
  "04ab",
);
