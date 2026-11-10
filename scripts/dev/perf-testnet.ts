// Testnet enclave timing, instructions and output size (WS3-T11b) on the testnet market (ARROW_CONTRACT_TESTNET or the SDK default).
//   npx tsx scripts/dev/perf-testnet.ts --evals 10 [--listings <unlock id>,<labels id>] [--json <out.json>]
// Without --listings, the seller spike.arrowhq.testnet opens two scored listings of the synthetic demo data
// (unlock = PASS scene, labels = BUY scene): the blob goes to testnet FastFS, K is sealed to the live program key.
// Then bench.arrowhq.testnet (exempt from the daily cap, DEC D-08) runs the evals one at a time, half on each
// listing, each with a fresh buyer key and the demo criteria (fixtures/criteria/demo.json, demo-buy.json).
// Per eval: wall_ms (send → status seen settled, 2 s polls), chain_ms (settled_at − created_at), OutLayer
// resources_used from the execution_completed event, the output size from OutLayer's log, and the decoded state.
// Each eval is appended to the main checkout's evidence/testnet.json (kind eval).
// Transactions are signed by the near CLI (legacy keychain) and sent with plain JSON-RPC; no near-api-js.
// Prints no key: the buyer scalars live only in memory, the FastFS login uses a throwaway HOME.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  b64, type Criteria, decodeEvalResult, encryptFile, keccakScalarHex, ListMsg, parseEvents, prepareEval, publicKeyHex,
  resolveNetwork, rpc, seal, sealedKPayload, sha256Hex, txStatus, view,
} from "@arrow/sdk";
import { appendRun } from "../src/lib/evidence.ts";
import { loadEnv, repoRoot } from "../src/lib/env.ts";
import { explorerTx } from "../src/lib/log.ts";
import { SPECS } from "../src/make-demo-blobs.ts";

loadEnv();
const { values } = parseArgs({
  options: { evals: { type: "string", default: "10" }, listings: { type: "string" }, json: { type: "string" } },
});
const N = Number(values.evals);
const NET = "testnet" as const;
const CONTRACT = resolveNetwork(NET, process.env).contract; // ARROW_CONTRACT_TESTNET from .env, else the SDK default
const TOKEN = "arrow-usd.arrowhq.testnet";
const SELLER = "spike.arrowhq.testnet";
const BUYER = "bench.arrowhq.testnet";
const SCRIPT = "scripts/dev/perf-testnet.ts";
const root = repoRoot();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- signing (near CLI) and sending (JSON-RPC) ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(b: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(b).toString("hex") || "0"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x !== 0) break; s = "1" + s; }
  return s;
}

/** Signs a function call with the near CLI and returns the signed tx (base64) and its hash. Never sends. */
function sign(signer: string, receiver: string, method: string, args: object, gas: string, deposit: string): { b64: string; hash: string } {
  const r = spawnSync("near", [
    "contract", "call-function", "as-transaction", receiver, method, "json-args", JSON.stringify(args),
    "prepaid-gas", gas, "attached-deposit", deposit, "sign-as", signer, "network-config", NET, "sign-with-legacy-keychain", "display",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // The CLI prints the signed transaction on stderr and stdout depending on the section.
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = out.split("\n");
  const at = lines.findIndex((l) => l.includes("Signed transaction (serialized as base64)"));
  if (at < 0) throw new Error("near CLI printed no signed transaction");
  let tx = "";
  for (const l of lines.slice(at + 1)) {
    const t = l.trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(t)) break;
    tx += t;
  }
  const bytes = Buffer.from(tx, "base64");
  // SignedTransaction = borsh(Transaction) ‖ ed25519 signature (1-byte tag + 64): the hash covers the first part.
  const hash = base58(createHash("sha256").update(bytes.subarray(0, bytes.length - 65)).digest());
  return { b64: tx, hash };
}

async function send(signed: { b64: string; hash: string }): Promise<void> {
  await rpc(NET, "send_tx", { signed_tx_base64: signed.b64, wait_until: "INCLUDED_FINAL" }, { timeoutMs: 60_000 });
}

async function callAndWait(signer: string, receiver: string, method: string, args: object, gas: string, deposit: string): Promise<any> {
  const s = sign(signer, receiver, method, args, gas, deposit);
  await send(s);
  const tx = await txStatus(NET, s.hash, signer, "FINAL", { timeoutMs: 60_000 });
  if (tx.status?.Failure) throw new Error(`${method} failed: ${JSON.stringify(tx.status.Failure).slice(0, 300)} (${explorerTx(NET, "near", s.hash)})`);
  return { ...tx, hash: s.hash };
}

const blockHeight = async (blockHash: string): Promise<number> => (await rpc<any>(NET, "block", { block_id: blockHash })).header.height;

// ---- listings ----
type Dataset = "unlock" | "labels";
const CRIT: Record<Dataset, string> = { unlock: "fixtures/criteria/demo.json", labels: "fixtures/criteria/demo-buy.json" };

function fastfsUpload(file: string): string {
  const home = mkdtempSync(join(tmpdir(), "arrow-fastfs-"));
  try {
    const key = JSON.parse(readFileSync(join(homedir(), ".near-credentials", NET, `${SELLER}.json`), "utf8")).private_key as string;
    const env = { ...process.env, HOME: home, OUTLAYER_NETWORK: NET };
    execFileSync("outlayer", ["login", NET], { input: `${SELLER}\n${key}\n`, env, stdio: ["pipe", "ignore", "ignore"] });
    const r = spawnSync("outlayer", ["upload", file], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
    const url = /FastFS URL:\s*(\S+)/.exec(out)?.[1];
    if (!url) throw new Error(`outlayer upload printed no FastFS URL (exit ${r.status}): ${out.trim().split("\n").slice(-3).join(" | ")}`);
    return url;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function openListing(ds: Dataset, programPk: string, bond: string): Promise<number> {
  const spec = SPECS[ds];
  const plain = readFileSync(resolve(root, spec.file));
  const enc = encryptFile(new Uint8Array(plain));
  const sealedK = b64.enc(seal(programPk, sealedKPayload(enc.key, enc.blobSha256, SELLER)));
  enc.key.fill(0);
  const dir = mkdtempSync(join(tmpdir(), "arrow-blob-"));
  const file = join(dir, `${enc.blobSha256}.bin`);
  writeFileSync(file, enc.blob);
  const url = fastfsUpload(file);
  rmSync(dir, { recursive: true, force: true });
  // test.fastfs.io serves a new file only after its indexer catches up (about 2.5 min on 2026-11-10).
  for (let i = 0; ; i++) {
    const r = await fetch(url, { redirect: "manual" });
    if (r.status === 200 && sha256Hex(new Uint8Array(await r.arrayBuffer())) === enc.blobSha256) break;
    if (i === 60) throw new Error(`FastFS GET ${url}: not the uploaded bytes after 10 min (HTTP ${r.status})`);
    await sleep(10_000);
  }
  const header = plain.subarray(0, plain.indexOf(10)).toString("utf8").split(",");
  const msg = ListMsg.parse({
    op: "list", title: `[perf] ${spec.title}`, public_desc: spec.public_desc, columns: header,
    rows_claimed: plain.toString("utf8").trimEnd().split("\n").length - 1, blob_url: url, blob_sha256: enc.blobSha256,
    sealed_k: sealedK, price: spec.price, eval_fee: spec.eval_fee, max_evals: 50, mode: "scored",
  });
  const tx = await callAndWait(SELLER, TOKEN, "ft_transfer_call", { receiver_id: CONTRACT, amount: bond, msg: JSON.stringify(msg) }, "300 TGas", "1 yoctoNEAR");
  const ev = parseEvents(tx).find((e) => e.standard === "arrow" && e.event === "arrow_listed");
  const id = Number([ev?.data].flat()[0]?.listing_id);
  if (!Number.isInteger(id)) throw new Error(`no arrow_listed event (${explorerTx(NET, "near", tx.hash)})`);
  appendRun(NET, {
    id: `perf-list-${ds}-${tx.hash.slice(0, 8)}`, kind: "list", tx: tx.hash, chain: "near",
    block_height: await blockHeight(tx.transaction_outcome.block_hash), listing_id: id, eval_id: null, purchase_id: null,
    oneclick_deposit: null, expect: `arrow_listed, scored, blob on FastFS (${ds}, synthetic)`,
    observed: `listing ${id}, blob_url ${url}, blob_sha256 ${enc.blobSha256.slice(0, 8)}…`, script: SCRIPT,
  });
  console.log(`listed ${ds} as listing ${id}: ${explorerTx(NET, "near", tx.hash)} blob ${url}`);
  return id;
}

async function mint(to: string, amount: bigint): Promise<void> {
  const have = BigInt(await view<string>(NET, TOKEN, "ft_balance_of", { account_id: to }));
  if (have >= amount) return;
  await callAndWait(to, TOKEN, "mint", { receiver_id: to, amount: (amount - have).toString() }, "30 TGas", "0 NEAR");
}

// ---- one eval ----
interface Row {
  run: number; listing: number; dataset: Dataset; tx: string; eval_id: number | null; wall_ms: number | null; chain_ms: number | null;
  time_ms: number | null; compile_ms: number | null; instructions: number | null; output_bytes: number | null;
  status: string; result: string;
}

async function evalOnce(run: number, ds: Dataset, listing: number, programPk: string, fee: string): Promise<Row> {
  const crit = JSON.parse(readFileSync(resolve(root, CRIT[ds]), "utf8")) as Criteria;
  const scalar = keccakScalarHex(crypto.getRandomValues(new Uint8Array(32)));
  const buyerPk = publicKeyHex(scalar);
  const msg = prepareEval({ listingId: listing, criteria: crit, buyerPk, programPk });
  const signed = sign(BUYER, TOKEN, "ft_transfer_call", { receiver_id: CONTRACT, amount: fee, msg }, "300 TGas", "1 yoctoNEAR");
  const t0 = Date.now();
  await send(signed);
  let ev: any = null;
  let seenAt: number | null = null;
  while (Date.now() - t0 < 240_000) {
    const page = await view<any[]>(NET, CONTRACT, "get_evals_by_listing", { listing_id: listing, from_index: 0, limit: 200 });
    ev = page.find((e) => e.buyer_pk === buyerPk) ?? null;
    if (ev && ev.status !== "pending") { seenAt = Date.now(); break; }
    await sleep(2_000);
  }
  const tx = await txStatus(NET, signed.hash, BUYER, "FINAL", { timeoutMs: 60_000 });
  const done = parseEvents(tx).find((e) => e.standard === "near-outlayer" && e.event === "execution_completed");
  const used = [done?.data].flat()[0]?.resources_used ?? null;
  const outLog = tx.receipts_outcome.flatMap((o: any) => o.outcome.logs).find((l: string) => l.startsWith("Execution completed")) ?? "";
  const outBytes = /Output: \w+\((\d+) bytes\)/.exec(outLog)?.[1];
  let result = ev?.status ?? "not settled in 240 s";
  if (ev?.status === "done" && ev.sealed_result) {
    const s = decodeEvalResult(ev.sealed_result, scalar, "scored");
    result = `${s.verdict}·${s.fit}·${s.novelty}`;
  } else if (ev?.status === "refunded") {
    result = `refund: ${ev.refund_reason}`;
  }
  const row: Row = {
    run, listing, dataset: ds, tx: signed.hash, eval_id: ev?.id ?? null, wall_ms: seenAt === null ? null : seenAt - t0,
    chain_ms: ev?.settled_at_ns ? Math.round((ev.settled_at_ns - ev.created_at_ns) / 1e6) : null,
    time_ms: used?.time_ms ?? null, compile_ms: used?.compile_time_ms ?? null, instructions: used?.instructions ?? null,
    output_bytes: outBytes ? Number(outBytes) : null, status: ev?.status ?? "unknown", result,
  };
  appendRun(NET, {
    id: `perf-eval-${signed.hash.slice(0, 8)}`, kind: "eval", tx: signed.hash, chain: "near",
    block_height: await blockHeight(tx.transaction_outcome.block_hash), listing_id: listing, eval_id: row.eval_id, purchase_id: null,
    oneclick_deposit: null,
    expect: ds === "unlock" ? "settled: PASS (novelty 1; demo scene 1, synthetic)" : "settled: BUY·5·4 when the model agrees (demo scene 2, synthetic)",
    observed: `${row.result}; wall_ms ${row.wall_ms}, chain_ms ${row.chain_ms}, time_ms ${row.time_ms}, instructions ${row.instructions}, output ${row.output_bytes} B`,
    script: SCRIPT,
  });
  return row;
}

// ---- main ----
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] : null;
};

const cfg = await view<any>(NET, CONTRACT, "get_config");
const programPk = await view<string | null>(NET, CONTRACT, "program_pubkey");
if (!programPk) throw new Error("testnet contract has no program key");
console.log(`contract ${CONTRACT} program ${cfg.config.program_wasm_hash.slice(0, 8)} pk ${programPk.slice(0, 10)}… paused=${cfg.paused}`);

let ids: Record<Dataset, number>;
if (values.listings) {
  const [u, l] = values.listings.split(",").map(Number);
  ids = { unlock: u, labels: l };
} else {
  const bond = cfg.config.listing_bond as string;
  await mint(SELLER, 2n * BigInt(bond));
  ids = { unlock: await openListing("unlock", programPk, bond), labels: await openListing("labels", programPk, bond) };
}
const fee: Record<Dataset, string> = {
  unlock: (await view<any>(NET, CONTRACT, "get_listing", { listing_id: ids.unlock })).eval_fee,
  labels: (await view<any>(NET, CONTRACT, "get_listing", { listing_id: ids.labels })).eval_fee,
};
await mint(BUYER, BigInt(Math.ceil(N / 2)) * (BigInt(fee.unlock) + BigInt(fee.labels)));

const rows: Row[] = [];
for (let i = 0; i < N; i++) {
  const ds: Dataset = i < Math.ceil(N / 2) ? "unlock" : "labels";
  const r = await evalOnce(i + 1, ds, ids[ds], programPk, fee[ds]);
  rows.push(r);
  console.log(`run ${r.run} | testnet | ${r.listing} (${ds}) | wall ${r.wall_ms} | chain ${r.chain_ms} | time_ms ${r.time_ms} | instr ${r.instructions} | out ${r.output_bytes} B | ${r.result} | ${explorerTx(NET, "near", r.tx)}`);
}
const nums = (k: keyof Row) => rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
const summary = {
  wall_ms: { p50: pct(nums("wall_ms"), 50), p95: pct(nums("wall_ms"), 95) },
  chain_ms: { p50: pct(nums("chain_ms"), 50), p95: pct(nums("chain_ms"), 95) },
  time_ms: { p50: pct(nums("time_ms"), 50), p95: pct(nums("time_ms"), 95) },
  instructions: { p50: pct(nums("instructions"), 50), max: Math.max(...nums("instructions")) },
  output_bytes: [...new Set(nums("output_bytes"))],
  settled: rows.filter((r) => r.status === "done").length,
};
console.log(`testnet n=${N} settled ${summary.settled}/${N}: wall p50=${summary.wall_ms.p50} p95=${summary.wall_ms.p95} ms; ` +
  `chain p50=${summary.chain_ms.p50} p95=${summary.chain_ms.p95} ms; outlayer time_ms p50=${summary.time_ms.p50} p95=${summary.time_ms.p95}; ` +
  `instructions p50=${summary.instructions.p50} max=${summary.instructions.max}; output bytes ${summary.output_bytes.join("/")}`);
if (values.json) writeFileSync(values.json, JSON.stringify({ at_utc: new Date().toISOString(), listings: ids, rows, summary }, null, 2) + "\n");
