// zod schemas for everything the bench reads and writes (WS6-T05, card section 3). bench/results/schema.json is
// generated from these with z.toJSONSchema (npx tsx bench/src/schema.ts --write, --check compares).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));
const utc = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);

// 3.1 attack / criteria wrapper. Only `criteria` is sealed and sent; the rest stays in the bench.
export const AttackWrapper = z.strictObject({
  id: z.string(),
  suite: z.enum(["leak", "quality", "room"]),
  category: z.string(),
  listings: z.array(z.string()).min(1),
  criteria: z.record(z.string(), z.unknown()).nullable(),
  raw: z
    .strictObject({
      sealed_criteria_b64: z.string().optional(),
      criteria_plaintext: z.string().optional(),
      criteria_plaintext_hex: z.string().optional(),
      buyer_pk_hex: z.string().optional(),
    })
    .nullable(),
  truth: z.looseObject({ kind: z.string() }).nullable(),
  decode: z.strictObject({ scored: z.string().nullable(), verdict: z.string().nullable() }).nullable(),
  expected: z.enum(["BUY", "PASS"]).nullable(),
  meta: z.record(z.string(), z.unknown()),
});
export type AttackWrapper = z.infer<typeof AttackWrapper>;

// 3.2 room manifest
export const RoomManifest = z.looseObject({
  v: z.literal(1),
  criteria_file: z.string(),
  payload_column: z.string(),
  payload_rows_pct: z.number(),
  attacks: z.array(
    z.looseObject({
      id: z.string(), category: z.string(), technique: z.string(), lang: z.string(), dataset: z.string(),
      payload: z.string(), payload_escaped: z.string(), payload_utf8_bytes: z.number().int(),
      regex_expected: z.boolean(), regex_expected_why: z.string(), mainnet_subset: z.boolean(),
    }),
  ),
  controls: z.array(z.looseObject({ id: z.string(), dataset: z.string(), expected: z.enum(["BUY", "PASS"]), regex_expected: z.boolean() })),
});
export type RoomManifest = z.infer<typeof RoomManifest>;

// 3.3 one live eval (append-only JSONL)
export const LiveEval = z.strictObject({
  v: z.literal(1),
  suite: z.enum(["leak", "quality", "room", "mainnet-subset"]),
  case_id: z.string(),
  network: z.enum(["testnet", "mainnet"]),
  contract: z.string(),
  wasm_sha256: z.string(),
  commit: z.string(),
  dataset_id: z.string(),
  listing_id: z.number().int().nonnegative(),
  mode: z.enum(["scored", "verdict"]),
  tx_hash: z.string(),
  request_id: z.number().int().nullable(),
  eval_id: z.number().int().nullable(),
  submitted_at_utc: utc,
  finished_at_utc: utc.nullable(),
  status: z.enum(["pending", "done", "refunded", "rejected", "timeout"]),
  refund_reason: z.enum(["null", "bad_output", "not_ok", "hash_mismatch"]).nullable(),
  sealed_r_b64: z.string().nullable(),
  idx: z.number().int().nullable(),
  state: z.string(),
  outlayer: z.strictObject({
    success: z.boolean().nullable(),
    error_message: z.string().nullable(),
    instructions: z.number().nullable(),
    time_ms: z.number().nullable(),
    output_bytes: z.number().int().nullable(),
  }),
  budget_after: z.strictObject({ evals_used: z.number().int(), spent_milli: z.number().int(), left_milli: z.number().int() }).nullable(),
});
export type LiveEval = z.infer<typeof LiveEval>;

// 3.4 baselines and signatures
export const BaselineRecord = z.strictObject({
  v: z.literal(1),
  case_id: z.string(),
  kind: z.enum(["naive", "llm_only"]),
  model: z.string(),
  chat_id: z.string().nullable(),
  request_file: z.string(),
  response_file: z.string().nullable(),
  request_sha256: hex(64),
  response_sha256: hex(64).nullable(),
  latency_ms: z.number().nullable(),
  parsed: z.record(z.string(), z.unknown()).nullable(),
  text: z.string().nullable(),
  signature_status: z.enum(["captured", "not_found", "unavailable", "error", "pending"]),
});
export type BaselineRecord = z.infer<typeof BaselineRecord>;

export const SignaturesFile = z
  .strictObject({
    v: z.literal(1),
    signing_algo: z.literal("ecdsa"),
    attestation_file: z.string().nullable(),
    attested_signing_addresses: z.array(z.string()),
    total: z.number().int().nonnegative(),
    captured: z.number().int().nonnegative(),
    items: z.array(
      z.strictObject({
        case_id: z.string(), kind: z.enum(["naive", "llm_only"]), model: z.string(), chat_id: z.string().nullable(),
        request_sha256: hex(64), response_sha256: hex(64).nullable(), request_file: z.string(), response_file: z.string().nullable(),
        status: z.enum(["captured", "not_found", "unavailable", "error"]),
        signature_kind: z.enum(["provider_tee", "gateway"]).nullable(),
        text: z.string().nullable(), signature: z.string().nullable(), signing_address: z.string().nullable(), fetched_at_utc: utc.nullable(),
      }),
    ),
  })
  .refine((s) => s.captured <= s.total, { message: "captured must not exceed total" });
export type SignaturesFile = z.infer<typeof SignaturesFile>;

// native gates (bench:native, or the WS-3 injection_room test with ARROW_WRITE_NATIVE_GATES=1): {v, cases: {dataset_id: gate}}
export const NativeGate = z.looseObject({
  dataset: z.string().optional(),
  regex_flag: z.boolean().nullable(),
  gate_name: z.string().nullable().optional(),
  fit_rule: z.number().int().min(1).max(5),
  rows: z.number().int().nonnegative().optional(),
});
export const NativeGates = z.looseObject({ v: z.literal(1).optional(), cases: z.record(z.string(), NativeGate) });
export type NativeGates = z.infer<typeof NativeGates>;

// bench bucket tables written by offline.ts (docs/bench.md is rendered from this)
const Rate = z.strictObject({ k: z.number().int(), n: z.number().int(), rate: z.string() });
export const Summary = z.strictObject({
  v: z.literal(1),
  inputs: z.strictObject({ live: z.record(z.string(), z.number().int()), baselines: z.record(z.string(), z.number().int()), native_gates: z.number().int() }),
  closure: z.strictObject({ n: z.number().int(), violations: z.number().int(), refunds: z.number().int() }),
  entropy_bits: z.strictObject({ n: z.number().int(), bits: z.string(), max_bits: z.string() }),
  leak: z.strictObject({
    evals: z.number().int(),
    verbatim: z.strictObject({ evals: z.number().int(), substring20_hits: z.number().int(), canary_hits: z.number().int() }),
    targeted: z.strictObject({ n: z.number().int(), accuracy: z.string(), bits: z.string(), ci95: z.tuple([z.string(), z.string()]) }).nullable(),
    targeted_by_exfil_word: z.record(z.string(), z.strictObject({ n: z.number().int(), accuracy: z.string(), bits: z.string() })),
    encoding_symbol_exact: Rate,
    membership_correct: Rate,
    mutual_info: z.record(z.string(), z.strictObject({ n: z.number().int(), mi_bits: z.string(), mi_bits_miller_madow: z.string(), p_value: z.string() })),
    buy_seen_in_jailbreak: Rate,
    error_path: z.strictObject({ n: z.number().int(), refunded_or_error: z.number().int() }),
  }),
  quality: z.strictObject({
    n: z.number().int(),
    accuracy: Rate,
    by_category: z.record(z.string(), z.strictObject({ n: z.number().int(), correct: z.number().int(), buy: z.number().int() })),
    llm_only: z.strictObject({ n: z.number().int(), accuracy: Rate }).nullable(),
  }),
  room: z.strictObject({
    attacks: z.number().int(),
    deterministic_alone_stopped: Rate.nullable(),
    live_buy: Rate.nullable(),
    llm_only_buy: Rate.nullable(),
    rows: z.array(z.strictObject({ id: z.string(), regex_expected: z.boolean(), native_flagged: z.boolean().nullable(), gate: z.string(), live: z.string(), llm_only: z.string() })),
  }),
});
export type Summary = z.infer<typeof Summary>;

export const SCHEMAS = { AttackWrapper, RoomManifest, LiveEval, BaselineRecord, SignaturesFile, NativeGates, Summary } as const;

export function jsonSchemas(): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(SCHEMAS)) out[k] = z.toJSONSchema(v as z.ZodType, { unrepresentable: "any" });
  return JSON.stringify(out, null, 2) + "\n";
}

const SCHEMA_PATH = "bench/results/schema.json";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const want = jsonSchemas();
  if (process.argv.includes("--check")) {
    let disk = "";
    try { disk = readFileSync(resolve(root, SCHEMA_PATH), "utf8"); } catch { /* missing */ }
    console.log(disk === want ? "schema.json: byte-identical" : "schema.json: DIFF");
    process.exit(disk === want ? 0 : 1);
  }
  writeFileSync(resolve(root, SCHEMA_PATH), want);
  console.log(`wrote ${SCHEMA_PATH}`);
}
