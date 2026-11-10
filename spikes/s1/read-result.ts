// Usage: npx tsx spikes/s1/read-result.ts <tx_hash> <signer> [--network testnet|mainnet] [--no-callback]
//        [--input '<input string>'] [--wasm-sha <64hex>]
// Reads one S1-b (or S3c) run from archival RPC and prints a JSON summary:
//   S1B_RESULT log (or the tx's final value with --no-callback), OutLayer request_id,
//   chain time from the tx block to the result block, and the OutLayer attestation
//   compared against sha256(wasm), sha256(input) and sha256(output).
// Prints no secrets: the spike program never echoes secret values.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

type Net = "testnet" | "mainnet";
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [txHash, signer] = args;
if (!txHash || !signer || txHash.startsWith("--")) {
  console.error("usage: read-result.ts <tx_hash> <signer> [--network testnet|mainnet] [--no-callback] [--input s] [--wasm-sha h]");
  process.exit(2);
}
const network = (flag("--network") ?? "testnet") as Net;
const noCallback = args.includes("--no-callback");
const input = flag("--input") ?? '{"mode":"echo+ai"}';
const wasmSha = flag("--wasm-sha") ?? readFileSync(new URL("./release/sha256.txt", import.meta.url), "utf8").trim();

const RPC: Record<Net, string> = {
  testnet: process.env.TESTNET_ARCHIVAL_RPC_URL || "https://archival-rpc.testnet.fastnear.com",
  mainnet: process.env.MAINNET_ARCHIVAL_RPC_URL || "https://archival-rpc.mainnet.fastnear.com",
};
const API: Record<Net, string> = {
  testnet: process.env.OUTLAYER_API_TESTNET || "https://testnet-api.outlayer.ai",
  mainnet: process.env.OUTLAYER_API_MAINNET || "https://api.outlayer.ai",
};

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(RPC[network], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body: any = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}

const blockTs = async (blockHash: string): Promise<bigint> =>
  BigInt((await rpc("block", { block_id: blockHash })).header.timestamp_nanosec);

function findRequestId(logs: string[]): number | null {
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    try {
      const ev = JSON.parse(l.slice("EVENT_JSON:".length));
      if (ev.standard !== "near-outlayer" || ev.event !== "execution_requested") continue;
      // request_id sits inside data[0].request_data, a JSON string (escaped quotes).
      const found = l.match(/request_id\\?"\s*:\s*"?(\d+)/);
      if (found) return Number(found[1]);
    } catch {
      /* not an event */
    }
  }
  return null;
}

// Poll until the tx and its result receipt are visible (yield window ~118 s).
let tx: any;
let resultOutcome: any = null;
const deadline = Date.now() + 150_000;
for (;;) {
  try {
    tx = await rpc("tx", { tx_hash: txHash, sender_account_id: signer, wait_until: "NONE" });
  } catch {
    tx = null;
  }
  const outcomes: any[] = tx?.receipts_outcome ?? [];
  resultOutcome = outcomes.find((o) => o.outcome.logs.some((l: string) => l.startsWith("S1B_RESULT") || l.startsWith("S3C_RESULT")));
  const finalValue = tx?.status?.SuccessValue !== undefined || tx?.status?.Failure !== undefined;
  if ((noCallback && finalValue) || resultOutcome) break;
  if (Date.now() > deadline) break;
  await sleep(5_000);
}
if (!tx) {
  console.log(JSON.stringify({ tx: txHash, error: "tx not found" }));
  process.exit(1);
}

const allLogs: string[] = tx.receipts_outcome.flatMap((o: any) => o.outcome.logs);
const requestId = findRequestId(allLogs);
const resultLog: string | null = resultOutcome?.outcome.logs.find((l: string) => /^S(1B|3C)_RESULT/.test(l)) ?? null;

let out: string | null = null;
if (resultLog) {
  const m = resultLog.match(/ out=(.*)$/s);
  out = m ? m[1] : null;
} else if (noCallback && tx.status?.SuccessValue !== undefined) {
  out = Buffer.from(tx.status.SuccessValue, "base64").toString("utf8");
}
let parsed: any = null;
try {
  parsed = out ? JSON.parse(out) : null;
} catch {
  parsed = null;
}

const txTs = await blockTs(tx.transaction_outcome.block_hash);
let elapsedMsChain: number | null = null;
const lastOutcome = resultOutcome ?? tx.receipts_outcome[tx.receipts_outcome.length - 1];
if (lastOutcome) elapsedMsChain = Number((await blockTs(lastOutcome.block_hash)) - txTs) / 1e6;

let attestation: any = null;
if (requestId !== null) {
  const res = await fetch(`${API[network]}/attestations/by-request/${requestId}`);
  const body: any = res.ok ? await res.json().catch(() => null) : null;
  attestation = {
    http: res.status,
    id: body?.id ?? null,
    transaction_hash: body?.transaction_hash ?? null,
    tx_matches: body?.transaction_hash === txHash,
    wasm_hash: body?.wasm_hash ?? null,
    wasm_matches: body?.wasm_hash === wasmSha,
    input_hash: body?.input_hash ?? null,
    input_hash_is_sha256_input: body?.input_hash === sha256(input),
    input_hash_is_in_sha: parsed?.in_sha !== undefined && body?.input_hash === parsed.in_sha,
    output_hash: body?.output_hash ?? null,
    output_hash_is_sha256_output: out !== null && body?.output_hash === sha256(out),
    has_tdx_quote: typeof body?.tdx_quote === "string" && body.tdx_quote.length > 0,
  };
}

console.log(
  JSON.stringify(
    {
      network,
      tx: txHash,
      signer,
      tx_status: tx.status?.Failure ? "Failure" : tx.status?.SuccessValue !== undefined ? "SuccessValue" : "pending",
      request_id: requestId,
      result_log_prefix: resultLog ? resultLog.split(" out=")[0] : null,
      out,
      out_bytes: out === null ? null : Buffer.byteLength(out),
      out_parsed: parsed,
      elapsed_ms_chain: elapsedMsChain,
      attestation,
    },
    null,
    2,
  ),
);
