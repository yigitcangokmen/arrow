// npm run bench:native (WS6-T05): deterministic gates for every bench dataset via the arrow-core example `bench_tool`.
// Writes bench/results/native-stats.json {v, cases: {dataset_id: {regex_flag, gate_name, fit_rule, rows, ...}}}. It never writes native-gates.json:
// that file is the committed injection-room evidence (cargo test -p arrow-core --test injection_room, ARROW_WRITE_NATIVE_GATES=1) and this
// tool has no G5 scanner, so its regex_flag is always null.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAK_DATASETS } from "./gen/leak.ts";
import { NativeGates } from "./schema.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Case = { id: string; data: string; criteria: string | null };
/** Every dataset the bench uploads: 26 room + 3 leak + 20 quality. */
export function benchCases(): Case[] {
  const room = readdirSync(resolve(ROOT, "bench/injection-room/datasets")).filter((n) => n.endsWith(".csv")).sort()
    .map((n) => ({ id: n.slice(0, -4), data: `bench/injection-room/datasets/${n}`, criteria: "bench/injection-room/criteria.json" }));
  const controls = [["C-CLEAN", "control-clean-buysell.csv"], ["C-JUNK", "control-junk-noinject.csv"]]
    .map(([id, f]) => ({ id: id!, data: `bench/injection-room/${f}`, criteria: "bench/injection-room/criteria.json" }));
  const leak = Object.entries(LEAK_DATASETS).map(([id, d]) => ({ id, data: d.file, criteria: null }));
  const quality = readdirSync(resolve(ROOT, "bench/datasets/quality")).filter((n) => n.endsWith(".csv")).sort()
    .map((n) => ({ id: n.slice(0, -4), data: `bench/datasets/quality/${n}`, criteria: `bench/criteria/quality/${n.slice(0, -4)}-a.json` }));
  return [...room, ...controls, ...leak, ...quality];
}

export const NATIVE_STATS = "bench/results/native-stats.json";

export function writeNativeStats(root: string, gates: unknown): string {
  const file = resolve(root, NATIVE_STATS);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(gates, null, 2) + "\n");
  return file;
}

export function runTool(args: string[]): unknown {
  const r = spawnSync("cargo", ["run", "-q", "-p", "arrow-core", "--example", "bench_tool", "--", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`bench_tool ${args.join(" ")} failed: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out: Record<string, unknown> = {};
  for (const c of benchCases()) out[c.id] = runTool(["gates", "--data", c.data, ...(c.criteria ? ["--criteria", c.criteria] : []), "--id", c.id]);
  const gates = NativeGates.parse({ v: 1, generator: "npm run bench:native (arrow-core example bench_tool gates)", note: "Deterministic layer only. regex_flag is null where the G5 scanner is not part of the build.", cases: out });
  writeNativeStats(ROOT, gates);
  const room = gates.cases as Record<string, { regex_flag: boolean | null }>;
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "bench/injection-room/attacks.json"), "utf8")) as { attacks: { id: string; regex_expected: boolean }[] };
  const expected = manifest.attacks.filter((a) => a.regex_expected).length;
  const flagged = manifest.attacks.filter((a) => room[a.id]?.regex_flag === true).length;
  const scanner = Object.values(room).some((g) => g.regex_flag !== null);
  console.log(`native gates: ${Object.keys(gates.cases).length} datasets → ${NATIVE_STATS}` + (scanner ? ` (room regex true ${flagged}/${manifest.attacks.length} expected ${expected})` : " (scanner not in this tree: regex_flag null)"));
}
