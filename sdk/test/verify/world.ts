// Test-only fake network for the verify rows: an in-memory chain (views, txs, accounts), OutLayer attestations,
// 1Click statuses and plain files, served through one fetch. buildWorld() returns a world in which every REQUIRED row is
// PROVEN; tests then break one fact and check that exactly that row stops being PROVEN.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64, bytesToHex, demoViewingKey, encryptFile, NETWORKS, seal, type EvidenceFile, type EvidenceRun, type Network } from "../../src/index.ts";
import { expectedReportData, inputHashOf } from "../../src/verify/attestation.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => JSON.parse(readFileSync(resolve(HERE, "../fixtures", name), "utf8"));
const view = (name: string) => fixture(`views/${name}`);

export const hex = (b: Uint8Array) => bytesToHex(b);
export const sha = (s: string | Uint8Array) => hex(sha256(typeof s === "string" ? new TextEncoder().encode(s) : s));

/** Attestation record from the live testnet fixture with new fields; report_data is rewritten so the quote stays consistent. */
export function makeAttestation(over: Record<string, unknown>) {
  const a: any = { ...fixture("attestation-4000.json"), ...over };
  const quote = Uint8Array.from(Buffer.from(a.tdx_quote, "base64"));
  quote.set(Uint8Array.from(Buffer.from(expectedReportData(a, "V1"), "hex")), 568);
  a.tdx_quote = Buffer.from(quote).toString("base64");
  return a;
}

const event = (standard: string, name: string, data: unknown) =>
  "EVENT_JSON:" + JSON.stringify({ standard, version: "1.0.0", event: name, data });

export interface World {
  /** Block timestamps (ns) by block hash for the fake `block` RPC; any other block answers 1763000000000000000. */
  blockTimes?: Record<string, string>;
  network: Network;
  contract: string;
  buyer: string;
  wasm: Uint8Array;
  wasmUrl: string;
  config: any;
  listings: any[];
  evals: any[];
  purchases: any[];
  leak: Record<string, any>;
  txs: Record<string, any>;
  attestations: Record<string, any>;
  files: Record<string, Uint8Array>;
  oneclick: Record<string, any>;
  accessKeys: unknown[];
  /** intents.near public_keys_of(contract) */
  intentsKeys: string[];
  /** OutLayer list_user_secrets(contract) */
  secrets: any[];
  codeHash: string;
  evidence: EvidenceFile;
  /** every RPC call: [url, method] */
  calls: [string, string][];
  releaseSha256: string;
  plaintext: Uint8Array;
  demoKey: ReturnType<typeof demoViewingKey>;
}

const BLOB_URL = "https://blobs.test/1.bin";

export function buildWorld(network: Network = "testnet"): World {
  const cfg = NETWORKS[network];
  const mainnet = network === "mainnet";
  const contract = cfg.contract;
  const buyer = mainnet ? "0xb5ef360e42056049f584fd03bf0fb9b208e28387" : "e2e-buyer.arrowhq.testnet";
  const relayer = mainnet ? "arrow-relayer.arrowhq.near" : "relayer.arrowhq.testnet";
  const wasm = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 255);
  const wasmHash = sha(wasm);
  const demoKey = demoViewingKey();

  // listing 1: encrypted blob, a release key sealed to the demo viewing key
  const plaintext = new TextEncoder().encode("date,region,sku\n2025-01-01,eu,a-1\n2025-01-02,us,b-2\n");
  const { key, blob, blobSha256 } = encryptFile(plaintext);
  const sealedKBuyer = b64.enc(seal(demoKey.buyerPk, key));

  const listing = { ...view("listing.json"), id: 1, seller: "seller.arrowhq.testnet", blob_url: BLOB_URL, blob_sha256: blobSha256, evals_used: 3, max_evals: 50, mode: "scored", bits_per_eval_milli: 5673, created_at_ns: 1_762_761_600_000_000_000, program_hash_at_list: wasmHash };
  const base = { listing_id: 1, buyer, buyer_pk: demoKey.buyerPk, rail: mainnet ? "mt" : "ft", sealed_result: "A".repeat(132) };
  const evals = [
    { ...base, id: 1, status: "done", h: blobSha256, refund_reason: null, settled_at_ns: 1 },
    { ...base, id: 2, status: "done", h: blobSha256, refund_reason: null, settled_at_ns: 1 },
    { ...base, id: 3, status: "refunded", h: null, sealed_result: null, refund_reason: "not_ok", paid: "100000", settled_at_ns: 1 },
  ];
  const purchases = [{ id: 1, listing_id: 1, buyer, buyer_pk: demoKey.buyerPk, status: "done", sealed_k_buyer: sealedKBuyer, h: blobSha256, refund_reason: null, rail: base.rail }];

  // OutLayer records the signer of the tx as the caller: the buyer on testnet, the relayer on mainnet (never the contract)
  const signer = mainnet ? relayer : buyer;
  const inputData = (evalId: number) => JSON.stringify({ v: 1, action: "eval", listing: { id: 1, blob_sha256: blobSha256, mode: "scored" }, eval: { id: evalId } });
  const evalTx = (hash: string, requestId: number, evalId: number) => ({
    transaction: { hash, signer_id: signer, receiver_id: contract, actions: [] },
    transaction_outcome: { id: hash, outcome: { logs: [], executor_id: signer } },
    receipts: [{ predecessor_id: contract, receiver_id: cfg.outlayer, receipt: { Action: { actions: [{ FunctionCall: { method_name: "request_execution", args: b64.enc(new TextEncoder().encode(JSON.stringify({ input_data: inputData(evalId) }))) } }] } } }],
    receipts_outcome: [{ id: "r1", outcome: { executor_id: cfg.outlayer, logs: [event("near-outlayer", "execution_requested", [{ request_data: JSON.stringify({ request_id: requestId, sender_id: signer, predecessor_id: contract, data_id: "x" }) }])] } }],
    status: { SuccessValue: "" },
  });
  const att = (hash: string, requestId: number, evalId: number, e: any) =>
    makeAttestation({
      request_id: requestId, transaction_hash: hash, caller_account_id: signer, wasm_hash: wasmHash, executed_wasm_sha256: wasmHash,
      input_hash: inputHashOf(inputData(evalId)),
      output_hash: sha(JSON.stringify({ v: 1, ok: true, r: e.sealed_result, h: e.h })),
    });

  const refundTx = {
    transaction: { hash: "REFUND1", signer_id: relayer, receiver_id: contract, actions: [] },
    transaction_outcome: { id: "REFUND1", outcome: { logs: [], executor_id: relayer } },
    receipts: [],
    receipts_outcome: [
      { id: "a", outcome: { executor_id: contract, logs: [event("arrow", "arrow_refund", { kind: "eval", listing_id: 1, id: 3, reason: "not_ok", amount: "100000" })] } },
      mainnet
        ? { id: "b", outcome: { executor_id: cfg.intents, logs: [event("nep245", "mt_transfer", [{ old_owner_id: contract, new_owner_id: buyer, token_ids: [cfg.usdcToken], amounts: ["100000"], memo: "refund" }])] } }
        : { id: "b", outcome: { executor_id: cfg.usdcToken, logs: [event("nep141", "ft_transfer", [{ old_owner_id: contract, new_owner_id: buyer, amount: "100000", memo: "refund" }])] } },
    ],
    status: { SuccessValue: "" },
  };
  const buyTx = { transaction: { hash: "BUY1", signer_id: relayer, receiver_id: contract, actions: [] }, transaction_outcome: { id: "BUY1", outcome: { logs: [], executor_id: relayer } }, receipts: [], receipts_outcome: [], status: { SuccessValue: "" } };
  // set_program of the current hash in block SETBLOCK (the fake block timestamp is 1763000000000000000 ns)
  const setProgramTx = {
    transaction: { hash: "SETPROG1", signer_id: contract, receiver_id: contract, actions: [{ FunctionCall: { method_name: "set_program", args: b64.enc(new TextEncoder().encode(JSON.stringify({ url: "https://wasm.test/arrow-tee.wasm", hash: wasmHash }))) } }] },
    transaction_outcome: { id: "SETPROG1", block_hash: "SETBLOCK", outcome: { logs: [], executor_id: contract } },
    receipts: [], receipts_outcome: [], status: { SuccessValue: "" },
  };
  const lockTx = { transaction: { hash: "LOCK1", signer_id: contract, receiver_id: contract, actions: [{ DeleteKey: { public_key: "ed25519:x" } }] }, transaction_outcome: { id: "LOCK1", outcome: { logs: [], executor_id: contract } }, receipts: [], receipts_outcome: [], status: { SuccessValue: "" } };

  const run = (o: Partial<EvidenceRun> & Pick<EvidenceRun, "id" | "kind">): EvidenceRun => ({
    tx: null, chain: "near", block_height: null, timestamp_utc: "2026-11-12T13:00:00.000Z", listing_id: null, eval_id: null, purchase_id: null,
    oneclick_deposit: null, expect: "", observed: "", script: "test", commit: "test", contract, ...o,
  });
  const runs: EvidenceRun[] = [
    run({ id: "l1", kind: "list", tx: "LIST1", listing_id: 1 }),
    run({ id: "e1", kind: "eval", tx: "EVAL1", listing_id: 1, eval_id: 1, observed: "PASS fit 2 novelty 1" }),
    run({ id: "e2", kind: "eval", tx: "EVAL2", listing_id: 1, eval_id: 2, observed: "BUY fit 5 novelty 4" }),
    run({ id: "f1", kind: "refund", tx: "REFUND1", listing_id: 1, eval_id: 3 }),
    run({ id: "b1", kind: "buy", tx: "BUY1", listing_id: 1, purchase_id: 1, observed: "hashes equal, decrypted (demo:true)" }),
    run({ id: "d1", kind: "deploy", tx: "SETPROG1", expect: `set_program ${wasmHash}` }),
    ...(mainnet
      ? [
          run({ id: "in1", kind: "inbound", tx: "0xbase1", chain: "base", oneclick_deposit: "dep-in" }),
          run({ id: "out1", kind: "outbound", tx: "solsig1", chain: "solana", oneclick_deposit: "dep-out" }),
        ]
      : []),
  ];

  const evidence: EvidenceFile = {
    network, contract, contract_wasm_sha256: null, program_wasm_sha256: wasmHash, program_wasm_url: "https://wasm.test/arrow-tee.wasm",
    lock: mainnet ? { tx: "LOCK1", block_height: 100, timestamp_utc: "2026-11-14T03:00:00.000Z" } : { tx: null, block_height: null, timestamp_utc: null },
    accounts: mainnet ? { treasury: "arrowhq.near", relayer } : { relayer, e2e_buyer: buyer },
    runs, corrections: [],
  };

  const e12 = evals;
  return {
    network, contract, buyer, wasm, wasmUrl: "https://wasm.test/arrow-tee.wasm", plaintext, demoKey, releaseSha256: wasmHash,
    config: { config: { program_wasm_url: "https://wasm.test/arrow-tee.wasm", program_wasm_hash: wasmHash, outlayer: cfg.outlayer, usdc_token_id: cfg.usdcToken }, paused: false, tank_available: "1", payment_path: "notify", result_path: "chain", build: network },
    listings: [listing], evals, purchases,
    leak: { 1: { listing_id: 1, bits_per_eval_milli: 5673, max_evals: 50, evals_used: 3, budget_milli: 283650, spent_milli: 17019, left_milli: 266631 } },
    txs: { EVAL1: evalTx("EVAL1", 4001, 1), EVAL2: evalTx("EVAL2", 4002, 2), REFUND1: refundTx, BUY1: buyTx, LOCK1: lockTx, SETPROG1: setProgramTx },
    attestations: { 4001: att("EVAL1", 4001, 1, e12[0]), 4002: att("EVAL2", 4002, 2, e12[1]) },
    files: { [BLOB_URL]: blob, "https://wasm.test/arrow-tee.wasm": wasm },
    oneclick: {
      "dep-in": { status: "SUCCESS", updatedAt: "x", swapDetails: { originChainTxHashes: [{ hash: "0xbase1", explorerUrl: "https://basescan.org/tx/0xbase1" }], destinationChainTxHashes: [] } },
      "dep-out": { status: "SUCCESS", updatedAt: "x", swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [{ hash: "solsig1", explorerUrl: "https://solscan.io/tx/solsig1" }] } },
    },
    accessKeys: [], intentsKeys: [],
    secrets: [secretRow(wasmHash, contract)],
    codeHash: "BnQQU2PY3ngVwf1KixcYbxCVnYqzrwBAMk6eku5BKpMh", evidence, calls: [],
  };
}

/** An OutLayer secret row as list_user_secrets returns it, created after the world's set_program block. */
export function secretRow(hash: string, contract: string, over: Record<string, unknown> = {}) {
  return {
    accessor: { WasmHash: { hash } }, profile: "arrow", created_at: 1763000100000000000, updated_at: 1763000100000000000, storage_deposit: "7460000000000000000000",
    access: { Logic: { operator: "And", conditions: [{ WasmHash: { hash } }, { Predecessor: { condition: { Whitelist: { accounts: [contract] } } } }] } },
    ...over,
  };
}

/** fetch for a World. Unknown URLs answer 404, unknown txs answer UNKNOWN_TRANSACTION. */
export function fakeFetch(w: World): typeof fetch {
  const cfg = NETWORKS[w.network];
  const rpcUrls = new Set([...cfg.rpc, cfg.archivalRpc]);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const rpcOk = (result: unknown) => json({ jsonrpc: "2.0", id: "arrow", result });
  const rpcErr = (name: string, data: string) => json({ jsonrpc: "2.0", id: "arrow", error: { name: "HANDLER_ERROR", cause: { name }, data } });
  const callView = (name: string, args: any) => {
    switch (name) {
      case "get_config": return w.config;
      case "get_listings": return w.listings.filter((l) => l.id >= Math.max(args.from_index, 1)).slice(0, args.limit); // from_index is an id, like views.rs
      case "get_listing": return w.listings.find((l) => l.id === args.listing_id) ?? null;
      case "get_evals_by_listing": return w.evals.filter((e) => e.listing_id === args.listing_id).slice(args.from_index, args.from_index + args.limit);
      case "get_eval": return w.evals.find((e) => e.id === args.eval_id) ?? null;
      case "get_purchase": return w.purchases.find((p) => p.id === args.purchase_id) ?? null;
      case "leak_budget": return w.leak[args.listing_id] ?? null;
      case "public_keys_of": return w.intentsKeys;
      case "list_user_secrets": return w.secrets;
      default: throw new Error(`unexpected view ${name}`);
    }
  };
  return (async (input: any, init?: any) => {
    const url = String(input);
    if (rpcUrls.has(url)) {
      const { method, params } = JSON.parse(init.body);
      w.calls.push([url, method === "query" ? `query:${params.request_type}` : method]);
      if (method === "EXPERIMENTAL_tx_status") {
        const t = w.txs[params.tx_hash];
        return t ? rpcOk(t) : rpcErr("UNKNOWN_TRANSACTION", `tx ${params.tx_hash} unknown`);
      }
      if (method === "block") return rpcOk({ header: { timestamp_nanosec: w.blockTimes?.[params.block_id] ?? "1763000000000000000" } });
      if (method === "query") {
        if (params.request_type === "call_function") {
          const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
          return rpcOk({ result: Array.from(new TextEncoder().encode(JSON.stringify(callView(params.method_name, args)))) });
        }
        if (params.request_type === "view_access_key_list") return rpcOk({ keys: w.accessKeys });
        if (params.request_type === "view_account") return rpcOk({ amount: "0", locked: "0", code_hash: w.codeHash, storage_usage: 1 });
      }
      return rpcErr("METHOD_NOT_FOUND", method);
    }
    const att = url.match(/\/attestations\/by-request\/(\d+)$/);
    if (att) return w.attestations[att[1]] ? json(w.attestations[att[1]]) : new Response("", { status: 404 });
    const status = url.match(/\/v0\/status\?depositAddress=(.+)$/);
    if (status) return w.oneclick[decodeURIComponent(status[1])] ? json(w.oneclick[decodeURIComponent(status[1])]) : json({ message: "not found" }, 404);
    if (url.startsWith("https://cloud-api.near.ai/v1/attestation/report")) return json({ gateway_attestation: { signing_address: "0xabc" }, model_attestations: [{}] });
    const file = w.files[url];
    return file ? new Response(file as unknown as BodyInit, { status: 200 }) : new Response("not found", { status: 404 });
  }) as typeof fetch;
}
