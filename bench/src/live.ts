// npm run bench:live -- --dry | --preflight | --suite room,quality,leak | --resume | --limit N | --account <id>   (WS6-T05)
// Runs eval jobs against the testnet contract and appends one LiveEval line per eval to bench/results/live/<suite>.jsonl.
// --dry only prints the plan and touches nothing. Real runs need the frozen wasm deployed (WS1-T15/T16), blobs reachable
// (bench/blobs, H-10) and a funded bench account; they were NOT exercised in WS6-T05 (owner of the first live run: WS6-T06).
// A `pending` eval is never sent twice: --resume polls its tx first, because a refund does not give the G1 budget back.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEvalResult } from "@arrow/sdk";
import { benchBuyerKey, say, short } from "./keys.ts";
import { LEAK_DATASETS } from "./gen/leak.ts";
import { SPECS } from "./gen/quality.ts";
import { AttackWrapper, LiveEval, RoomManifest } from "./schema.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rd = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

export type Job = {
  suite: "room" | "quality" | "leak";
  case_id: string;
  dataset_id: string;
  dataset_path: string;
  mode: "scored" | "verdict";
  criteria: Record<string, unknown> | null;
  raw: AttackWrapper["raw"];
  listing_max_evals: number;
};

/** Every eval of the full run: room 26 + quality 40 + leak 115 = 181 evals over 49 listings. */
export function buildPlan(suites: readonly string[] = ["room", "quality", "leak"]): Job[] {
  const jobs: Job[] = [];
  if (suites.includes("room")) {
    const m = RoomManifest.parse(JSON.parse(rd("bench/injection-room/attacks.json")));
    const criteria = JSON.parse(rd(m.criteria_file)) as Record<string, unknown>;
    for (const a of m.attacks) jobs.push({ suite: "room", case_id: a.id, dataset_id: a.id, dataset_path: a.dataset, mode: "scored", criteria, raw: null, listing_max_evals: 5 });
    for (const c of m.controls) jobs.push({ suite: "room", case_id: c.id, dataset_id: c.id, dataset_path: c.dataset, mode: "scored", criteria, raw: null, listing_max_evals: 5 });
  }
  if (suites.includes("quality")) {
    for (const s of SPECS) for (const x of ["a", "b"]) {
      const w = AttackWrapper.parse(JSON.parse(rd(`bench/criteria/quality/${s.id}-${x}.json`)));
      jobs.push({ suite: "quality", case_id: w.id, dataset_id: s.id, dataset_path: `bench/datasets/quality/${s.id}.csv`, mode: "scored", criteria: w.criteria, raw: null, listing_max_evals: 8 });
    }
  }
  if (suites.includes("leak")) {
    for (const f of readdirSync(resolve(ROOT, "bench/criteria/leak")).sort()) {
      const w = AttackWrapper.parse(JSON.parse(rd(`bench/criteria/leak/${f}`)));
      for (const l of w.listings) {
        const d = LEAK_DATASETS[l as keyof typeof LEAK_DATASETS];
        jobs.push({ suite: "leak", case_id: `${w.id}@${l}`, dataset_id: l, dataset_path: d.file, mode: d.mode, criteria: w.criteria, raw: w.raw, listing_max_evals: 60 });
      }
    }
  }
  return jobs;
}

export function describePlan(jobs: Job[], concurrency = 4): string {
  const n = (s: string) => jobs.filter((j) => j.suite === s).length;
  const listings = new Set(jobs.map((j) => j.dataset_id)).size;
  const minutes = Math.round((jobs.length * 60) / concurrency / 60);
  const near = (jobs.length * 0.0045).toFixed(2);
  return `plan: room ${n("room")} · quality ${n("quality")} · leak ${n("leak")} = ${jobs.length} evals · listings ${listings} · est. ${jobs.length}×~60 s / ${concurrency} ≈ ${minutes} min · OutLayer time fees ≈ ${near} tNEAR (card estimate 0.0045 per eval) plus gas and listing storage`;
}

const resultsFile = (suite: string) => resolve(ROOT, `bench/results/live/${suite}.jsonl`);
export function readDone(suite: string): LiveEval[] {
  const p = resultsFile(suite);
  if (!existsSync(p)) return [];
  return rd(`bench/results/live/${suite}.jsonl`).split("\n").filter(Boolean).map((l) => LiveEval.parse(JSON.parse(l)));
}
const append = (suite: string, e: LiveEval) => {
  mkdirSync(dirname(resultsFile(suite)), { recursive: true });
  appendFileSync(resultsFile(suite), JSON.stringify(LiveEval.parse(e)) + "\n");
};

async function main() {
  const args = process.argv.slice(2);
  const val = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const suites = (val("--suite") ?? "room,quality,leak").split(",").flatMap((s) => (s === "all" ? ["room", "quality", "leak"] : [s]));
  const concurrency = Number(val("--concurrency") ?? 4);
  let jobs = buildPlan(suites);
  const limit = val("--limit");
  if (limit) jobs = jobs.slice(0, Number(limit));
  if (args.includes("--dry")) { say(describePlan(jobs, concurrency)); return; }

  const account = val("--account") ?? process.env.BENCH_ACCOUNT_ID ?? "bench.arrowhq.testnet";
  const { makeChain, stateString } = await import("./chain.ts");
  const chain = makeChain(account);
  const cfg = await chain.views.config();
  say(`contract paused=${cfg.paused} build=${cfg.build} tank=${cfg.tank_available}`);
  if (cfg.build !== "testnet") throw new Error("the bench runs against the testnet build only");
  if (args.includes("--preflight")) {
    const c = cfg.config as { cap_exempt?: string[] };
    if (!c.cap_exempt?.includes(account)) throw new Error(`${account} is not in get_config().cap_exempt; the daily caps would turn evals into silent refunds (ask WS-2)`);
    const pk = await chain.views.programPubkey();
    if (!pk) throw new Error("no program key yet");
    say(`preflight OK: ${account} cap-exempt, program key ${pk.slice(0, 8)}...`);
    return;
  }
  const done = new Set(["room", "quality", "leak"].flatMap((s) => readDone(s)).map((e) => e.case_id));
  const pendingOnes = ["room", "quality", "leak"].flatMap((s) => readDone(s)).filter((e) => e.status === "pending" || e.status === "timeout");
  if (pendingOnes.length && !args.includes("--resume")) throw new Error(`${pendingOnes.length} evals are pending/timed out; run with --resume (they are polled, never re-sent)`);
  // Listing registry: bench/results/live/listings.json {dataset_id: listing_id}. Creating listings needs hosted blobs (see bench/blobs/manifest.json).
  const regPath = resolve(ROOT, "bench/results/live/listings.json");
  const registry: Record<string, number> = existsSync(regPath) ? JSON.parse(readFileSync(regPath, "utf8")) : {};
  if (jobs.some((j) => registry[j.dataset_id] === undefined)) throw new Error("listings are not created yet for every dataset in this plan (createListing needs the blob URLs from bench/blobs; see WS6-T06)");

  const key = benchBuyerKey();
  for (const j of jobs.filter((x) => !done.has(x.case_id))) {
    const listing = registry[j.dataset_id]!;
    const submitted = new Date().toISOString().slice(0, 19) + "Z";
    const tx = await chain.submitEval(listing, "50000", j.criteria as never, j.raw);
    say(`${j.case_id} sent ${short(tx)}`);
    const w = await chain.waitEval(tx, account);
    const row = w.outcome.eval_id === null ? null : await chain.views.eval(w.outcome.eval_id);
    let idx: number | null = null;
    if (row?.sealed_result) {
      const st = decodeEvalResult(row.sealed_result, key.scalarHex, j.mode);
      const { encodeState } = await import("./chain.ts");
      idx = encodeState(st, j.mode);
    }
    const lb = await chain.views.leakBudget(listing);
    const e: LiveEval = {
      v: 1, suite: j.suite, case_id: j.case_id, network: "testnet", contract: chain.views.contractId, wasm_sha256: "", commit: "",
      dataset_id: j.dataset_id, listing_id: listing, mode: j.mode, tx_hash: tx, request_id: w.outcome.request_id, eval_id: w.outcome.eval_id,
      submitted_at_utc: submitted, finished_at_utc: w.done ? new Date().toISOString().slice(0, 19) + "Z" : null,
      status: !w.done ? "timeout" : w.outcome.refund_reason ? "refunded" : "done", refund_reason: w.outcome.refund_reason,
      sealed_r_b64: row?.sealed_result ?? null, idx, state: idx === null ? "ERROR" : stateString(idx, j.mode),
      outlayer: { success: w.outcome.success, error_message: w.outcome.error_message, instructions: w.outcome.resources_used.instructions, time_ms: w.outcome.resources_used.time_ms, output_bytes: w.outcome.output_bytes },
      budget_after: lb ? { evals_used: lb.evals_used, spent_milli: lb.spent_milli, left_milli: lb.left_milli } : null,
    };
    append(j.suite, e);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
