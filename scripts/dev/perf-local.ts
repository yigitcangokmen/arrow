// Local enclave timing and fuel (WS3-T11b). Driven by scripts/dev/perf-local.sh, which builds the dev-endpoints
// wasm, precompiles it and starts scripts/dev/fake-nearai.ts as the blob host.
//   node --import tsx scripts/dev/perf-local.ts --wasm <cwasm> --wasm-fuel <cwasm built with fuel> --fake <http://127.0.0.1:port> --blobs <dir>
//        [--llm real|fake] [--runs 10] [--no-fuel] [--json <out.json>]
// --llm real calls cloud-api.near.ai with NEARAI_API_KEY from .env (the key is passed to wasmtime by name, never
// printed). --llm fake answers from the fake server, so the time is the enclave work without the model call.
// Inputs are built at run time from a test master (not a real secret). Prints no key, K or data row.
import { spawnSync } from "node:child_process";
import { hkdfSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  b64, bytesToHex, type Criteria, decodeEvalResult, encryptFile, publicKeyHex, scalarFromLabel, seal,
  sealCriteria, sealedKPayload, sha256Hex, signature, signatureHex,
} from "@arrow/sdk";
import { loadEnv, repoRoot } from "../src/lib/env.ts";

const { values } = parseArgs({
  options: {
    wasm: { type: "string" }, "wasm-fuel": { type: "string" }, fake: { type: "string" }, blobs: { type: "string" },
    llm: { type: "string", default: "fake" }, runs: { type: "string", default: "10" },
    "no-fuel": { type: "boolean", default: false }, json: { type: "string" },
  },
});
const wasm = values.wasm, wasmFuel = values["wasm-fuel"], fake = values.fake, blobDir = values.blobs;
if (!wasm || !wasmFuel || !fake || !blobDir) throw new Error("usage: --wasm <cwasm> --wasm-fuel <cwasm> --fake <url> --blobs <dir> [--llm real|fake]");
const llm = values.llm === "real" ? "real" : "fake";
const nRuns = Number(values.runs);
const root = repoRoot();
loadEnv();
if (llm === "real" && !process.env.NEARAI_API_KEY) throw new Error("--llm real needs NEARAI_API_KEY in .env (H-01a)");

const NEARAI_URL = "https://cloud-api.near.ai/v1/chat/completions";
const FUEL_CAP = 20_000_000_000; // limits_eval.max_instructions (DEC I-12)
const MEM_CAP = 512 * 1024 * 1024; // limits_eval.max_memory_mb

// Test master → program key, the same HKDF as enclave/arrow-tee/src/keys.rs (salt none, info arrow/program/v1).
const master = sha256Hex(new TextEncoder().encode("arrow/perf/master/v1"));
const programSk = bytesToHex(new Uint8Array(hkdfSync("sha256", Buffer.from(master, "hex"), Buffer.alloc(0), "arrow/program/v1", 32)));
const programPk = publicKeyHex(programSk);
const buyerSk = scalarFromLabel("arrow:perf:buyer:v1");
const buyerPk = publicKeyHex(buyerSk);

interface Case { name: string; blobUrl: string; blobSha: string; sealedK: string; columns: string[]; crit: Criteria; mode: string }

function makeCase(name: string, plain: Uint8Array, crit: Criteria, fakeMode: string): Case {
  const enc = encryptFile(plain);
  writeFileSync(resolve(blobDir!, `${name}.bin`), enc.blob);
  const sealedK = b64.enc(seal(programPk, sealedKPayload(enc.key, enc.blobSha256)));
  enc.key.fill(0);
  const header = new TextDecoder().decode(plain.subarray(0, plain.indexOf(10))).split(",");
  return { name, blobUrl: `${fake}/blob/${name}`, blobSha: enc.blobSha256, sealedK, columns: header, crit, mode: fakeMode };
}

function input(c: Case): Buffer {
  return Buffer.from(JSON.stringify({
    v: 1, action: "eval",
    listing: { id: 1, blob_url: c.blobUrl, blob_sha256: c.blobSha, sealed_k: c.sealedK, mode: "scored", columns: c.columns },
    eval: { id: 1, sealed_criteria: sealCriteria(programPk, c.crit), buyer_pk: buyerPk, seed: randomBytes(32).toString("hex") },
  }));
}

interface Run { ok: boolean; ms: number; outBytes: number; state: string; maxRssMb: number | null; trapped: boolean; trap: string | null }

/** The fuel search and the max case always use the fake model: fuel does not depend on the answer, and it saves
 * about 30 real NEAR AI calls. Only the timing runs use --llm. */
function runWasm(c: Case, o: { fuel?: number; mem?: number; rss?: boolean; fakeLlm?: boolean } = {}): Run {
  const real = llm === "real" && !o.fakeLlm;
  const env: Record<string, string> = {
    OUTLAYER_EXECUTION_TYPE: "NEAR", NEAR_NETWORK_ID: "testnet", NEAR_PREDECESSOR_ID: "arrow.arrowhq.testnet",
    PROTECTED_MASTER: master, NEAR_BLOCK_TIMESTAMP: (BigInt(Date.now()) * 1_000_000n).toString(), ARROW_DEV_TPAD_MS: "0",
    ARROW_DEV_NEARAI_URL: real ? NEARAI_URL : `${fake}/v1/chat/completions`,
  };
  const args = ["run", "--allow-precompiled", "-S", "http"];
  if (o.fuel) args.push("-W", `fuel=${o.fuel}`);
  if (o.mem) args.push("-W", `max-memory-size=${o.mem}`);
  for (const [k, v] of Object.entries(env)) args.push("--env", `${k}=${v}`);
  // The real key is inherited by name from this process's environment, so it is never on a command line.
  const childEnv = { ...process.env, NEARAI_API_KEY: real ? process.env.NEARAI_API_KEY! : `mode:${c.mode}` };
  args.push("--env", "NEARAI_API_KEY", o.fuel ? wasmFuel! : wasm!);
  const [cmd, argv] = o.rss ? ["/usr/bin/time", ["-l", "wasmtime", ...args]] : ["wasmtime", args];
  const t = process.hrtime.bigint();
  const r = spawnSync(cmd, argv, { input: input(c), env: childEnv, maxBuffer: 16 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const out = r.stdout.toString("utf8");
  const err = r.stderr.toString("utf8");
  const rssM = /(\d+)\s+maximum resident set size/.exec(err);
  let ok = false, state = "error";
  try {
    const v = JSON.parse(out);
    ok = v.ok === true;
    if (ok) {
      const s = decodeEvalResult(v.r, buyerSk, "scored");
      state = `${s.verdict}·${s.fit}·${s.novelty}`;
    }
  } catch { /* trap or empty stdout */ }
  // A trap is wasmtime's own message (local test input only); the first lines say which limit hit.
  const trap = r.status !== 0 ? err.split("\n").filter((l) => /rror|trap|fuel|memory|Caused/.test(l)).slice(0, 4).join(" | ") : null;
  return { ok, ms, outBytes: r.stdout.length, state, maxRssMb: rssM ? Number(rssM[1]) / 1024 / 1024 : null, trapped: r.status !== 0, trap };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
};

/** Smallest fuel that still finishes ok, to within 2 %, by bisection on a log scale. */
function minFuel(c: Case): number {
  let lo = 1e6, hi = FUEL_CAP;
  if (!runWasm(c, { fuel: hi, fakeLlm: true }).ok) return Infinity;
  while (hi / lo > 1.02) {
    const mid = Math.round(Math.sqrt(lo * hi));
    if (runWasm(c, { fuel: mid, fakeLlm: true }).ok) hi = mid; else lo = mid;
  }
  return hi;
}

// ---- cases: the two demo scenes (same files and criteria as the testnet run) and the max case (DEC I-13) ----
const readJson = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const demo1 = makeCase("demo1-unlock", readFileSync(resolve(root, "fixtures/demo/unlock-schedule-412.csv")), readJson("fixtures/criteria/demo.json"), "ok_pass");
const demo2 = makeCase("demo2-labels", readFileSync(resolve(root, "fixtures/demo/wallet-labels-1000.csv")), readJson("fixtures/criteria/demo-buy.json"), "ok_buy");

// 200,000 rows x 4 columns, 25 bytes a row: 5,000,008 bytes plain, 5,000,048 bytes blob (MAX_BLOB 5,242,880).
const MAX_ROWS = 200_000;
const words = ["swap", "bot1", "lpxx", "cexw"];
const key = (i: number) => i.toString(36).padStart(6, "0");
const day = (i: number) => new Date(Date.UTC(2026, 7, 1) + (i % 92) * 86_400_000).toISOString().slice(0, 10);
let csv = "k,d,v,t\n";
for (let i = 0; i < MAX_ROWS; i++) csv += `${key(i)},${day(i)},${i % 10},${words[i % 4]}\n`;
const buyerKeys = Array.from({ length: 20_000 }, (_, j) => key(190_000 + j)); // 10,000 of 20,000 in the data
const maxCrit: Criteria = {
  v: 1, required_columns: ["k", "d", "v", "t"], min_rows: 150_000, date_column: "d", date_from: "2026-08-01", date_to: "2026-10-31",
  max_null_rate: 0.01, key_column: "k", text: "Synthetic perf case: 200k rows, one key column.", min_fit: 4, min_novelty: 3,
  minhash: signatureHex(signature(buyerKeys)),
};
const maxCase = makeCase("max-200k", new TextEncoder().encode(csv), maxCrit, "ok_pass");

// ---- runs ----
console.log(`llm=${llm} runs=${nRuns} wasm=${wasm.split("/").pop()} loadavg=${(await import("node:os")).loadavg().map((x) => x.toFixed(1)).join(" ")}`);
const rows: { run: number; listing: string; ms: number; outBytes: number; state: string; ok: boolean }[] = [];
for (let i = 0; i < nRuns; i++) {
  const c = i < Math.ceil(nRuns / 2) ? demo1 : demo2;
  const r = runWasm(c);
  rows.push({ run: i + 1, listing: c.name, ms: Math.round(r.ms), outBytes: r.outBytes, state: r.state, ok: r.ok });
  console.log(`run ${i + 1} ${c.name} ${(r.ms / 1000).toFixed(2)} s out=${r.outBytes} B ${r.ok ? "ok" : "ERR"} ${r.state}`);
}
const times = rows.map((r) => r.ms);
const p50 = pct(times, 50) / 1000, p95 = pct(times, 95) / 1000;

const mx = runWasm(maxCase, { fuel: FUEL_CAP, mem: MEM_CAP, rss: true, fakeLlm: true });
console.log(`maxcase ${MAX_ROWS} rows blob ${csv.length + 40} B: ${(mx.ms / 1000).toFixed(2)} s out=${mx.outBytes} B ${mx.ok ? "ok" : "ERR"} ${mx.state} max_rss=${mx.maxRssMb?.toFixed(0)} MiB (fuel cap ${FUEL_CAP}, memory cap ${MEM_CAP / 1048576} MiB)${mx.trap ? ` TRAP: ${mx.trap}` : ""}`);
let fuel: Record<string, number> | null = null;
if (!values["no-fuel"]) {
  fuel = { [demo1.name]: minFuel(demo1), [demo2.name]: minFuel(demo2), [maxCase.name]: minFuel(maxCase) };
  console.log(`fuel to finish (±2 %): ${Object.entries(fuel).map(([k, v]) => `${k}=${v.toExponential(2)}`).join(" ")}`);
}
const allOk = rows.every((r) => r.ok) && mx.ok;
console.log(`local work p50=${p50.toFixed(2)}s p95=${p95.toFixed(2)}s (llm=${llm}, n=${nRuns}, p95 = nearest rank) ; maxcase ${mx.ok ? "OK" : "FAILED"}${fuel ? ` fuel=${fuel[maxCase.name].toExponential(2)}` : ""}`);
if (values.json) {
  writeFileSync(values.json, JSON.stringify({
    llm, at_utc: new Date().toISOString(), rows, p50_s: p50, p95_s: p95,
    maxcase: { rows: MAX_ROWS, blob_bytes: csv.length + 40, ms: Math.round(mx.ms), ok: mx.ok, state: mx.state, out_bytes: mx.outBytes, max_rss_mib: mx.maxRssMb, trapped: mx.trapped, trap: mx.trap },
    fuel,
  }, null, 2) + "\n");
}
process.exit(allOk ? 0 : 1);
