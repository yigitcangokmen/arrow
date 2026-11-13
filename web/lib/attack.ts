// What /attack shows, computed from the recorded bench files (bench/results/*, bench/injection-room/attacks.json).
// Pure functions: a missing input is null and prints "not run"; a number is never typed here, it is counted from the
// files. The same results feed `npm run bench:offline`, so the two always agree.
import { z } from "zod";

// ---- the shapes this page reads (a subset of bench/src/schema.ts, kept loose so the bench can add fields) ----
const Rate = z.looseObject({ k: z.number(), n: z.number(), rate: z.string() });
const Bits = z.looseObject({ n: z.number(), accuracy: z.string(), bits: z.string() });
const Mi = z.looseObject({ n: z.number(), mi_bits_miller_madow: z.string(), p_value: z.string() });

export const BenchSummary = z.looseObject({
  closure: z.looseObject({ n: z.number(), violations: z.number(), refunds: z.number() }),
  entropy_bits: z.looseObject({ n: z.number(), bits: z.string(), max_bits: z.string() }),
  inputs: z.looseObject({ baselines: z.record(z.string(), z.number()) }),
  leak: z.looseObject({
    evals: z.number(),
    verbatim: z.looseObject({ evals: z.number(), substring20_hits: z.number(), canary_hits: z.number() }),
    targeted: Bits.extend({ ci95: z.tuple([z.string(), z.string()]) }).nullable(),
    targeted_by_exfil_word: z.record(z.string(), Bits),
    encoding_symbol_exact: Rate,
    membership_correct: Rate,
    mutual_info: z.record(z.string(), Mi),
    buy_seen_in_jailbreak: Rate,
    error_path: z.looseObject({ n: z.number(), refunded_or_error: z.number() }),
  }),
  quality: z.looseObject({
    n: z.number(),
    accuracy: Rate,
    by_category: z.record(z.string(), z.looseObject({ n: z.number(), correct: z.number(), buy: z.number() })),
    llm_only: z.looseObject({ n: z.number(), accuracy: Rate }).nullable(),
  }),
  room: z.looseObject({ attacks: z.number(), deterministic_alone_stopped: Rate.nullable(), live_buy: Rate.nullable(), llm_only_buy: Rate.nullable() }),
});
export type BenchSummary = z.infer<typeof BenchSummary>;

const NativeFile = z.looseObject({ cases: z.record(z.string(), z.looseObject({ regex_flag: z.boolean().nullable(), gate_name: z.string().nullable().optional() })) });
const Room = z.looseObject({
  attacks: z.array(z.looseObject({ id: z.string(), category: z.string(), technique: z.string(), lang: z.string(), regex_expected: z.boolean(), mainnet_subset: z.boolean() })),
  controls: z.array(z.looseObject({ id: z.string(), expected: z.enum(["BUY", "PASS"]) })),
});
const Live = z.array(
  z.looseObject({
    case_id: z.string(), network: z.enum(["testnet", "mainnet"]), tx_hash: z.string(), status: z.string(), state: z.string(),
    eval_id: z.number().nullable(), refund_reason: z.string().nullable(),
  }),
);
const Quality = z.looseObject({
  wrappers: z.array(z.looseObject({ id: z.string(), category: z.string(), expected: z.string() })),
  llmOnly: z.array(z.looseObject({ case_id: z.string(), verdict: z.string().nullable() })),
});

export type LiveRow = z.infer<typeof Live>[number];

export interface AttackInputs {
  summary: BenchSummary | null;
  native: Record<string, { regex_flag: boolean | null; gate_name?: string | null | undefined }> | null;
  room: z.infer<typeof Room> | null;
  roomLive: LiveRow[];
  mainnetLive: LiveRow[];
  quality: z.infer<typeof Quality> | null;
}

/** Reads the raw generated data. A missing value is null; a value that does not match its shape is an error, never zeros. */
export function readAttackInputs(raw: { bench: Record<string, unknown>; room: unknown; live: Record<string, unknown> }): { inputs: AttackInputs; errors: string[] } {
  const errors: string[] = [];
  const take = <T>(name: string, schema: z.ZodType<T>, v: unknown): T | null => {
    if (v === null || v === undefined) return null;
    const r = schema.safeParse(v);
    if (r.success) return r.data;
    errors.push(`${name} does not have the expected shape`);
    return null;
  };
  const native = take("native-gates.json", NativeFile, raw.bench["native-gates.json"]);
  return {
    errors,
    inputs: {
      summary: take("summary.json", BenchSummary, raw.bench["summary.json"]),
      native: native?.cases ?? null,
      room: take("attacks.json", Room, raw.room),
      roomLive: take("live/room.jsonl", Live, raw.live.room) ?? [],
      mainnetLive: take("live/mainnet-subset.jsonl", Live, raw.live["mainnet-subset"]) ?? [],
      quality: take("quality wrappers", Quality, raw.live.quality),
    },
  };
}

// ---- text ----
export const NOT_RUN = "not run";
const rate = (r: { k: number; n: number; rate: string } | null | undefined): string => (!r || r.n === 0 ? NOT_RUN : `${r.k}/${r.n} (${r.rate})`);

export type Verdict = "BUY" | "PASS";
/** "BUY·5·4", "PASS·1·1", "BUY", "PASS" -> the verdict; anything else (ERROR, empty) is not a verdict. */
export const verdictOf = (state: string): Verdict | null => (state.startsWith("BUY") ? "BUY" : state.startsWith("PASS") ? "PASS" : null);

export interface Line {
  label: string;
  value: string;
}

/** Leak-bench: what came out, by attack kind. Every row says how many evals it is over. */
export function leakLines(s: BenchSummary | null): Line[] | null {
  if (!s || s.leak.evals === 0) return null;
  const L = s.leak;
  const mi = (k: string) => (L.mutual_info[k] && L.mutual_info[k]!.n > 0 ? `${L.mutual_info[k]!.mi_bits_miller_madow} bits (p=${L.mutual_info[k]!.p_value}, n=${L.mutual_info[k]!.n})` : NOT_RUN);
  return [
    { label: `Verbatim: matches of 20+ characters / canary hits, over ${L.verbatim.evals} verbatim and jailbreak evals`, value: L.verbatim.evals === 0 ? NOT_RUN : `${L.verbatim.substring20_hits} / ${L.verbatim.canary_hits}` },
    { label: "Targeted bits: accuracy, information", value: L.targeted ? `${L.targeted.accuracy} over ${L.targeted.n}, ${L.targeted.bits} bits (95% CI of accuracy ${L.targeted.ci95[0]}..${L.targeted.ci95[1]})` : NOT_RUN },
    { label: "Encoded symbol read back exactly", value: rate(L.encoding_symbol_exact) },
    { label: "Membership probe read back", value: rate(L.membership_correct) },
    { label: "Timing: mutual information with the target bit, from run time", value: mi("time_ms") },
    { label: "Timing: mutual information with the target bit, from instruction count", value: mi("instructions") },
    { label: "BUY seen in jailbreak evals", value: rate(L.buy_seen_in_jailbreak) },
    { label: "Error-path evals refunded or ERROR", value: L.error_path.n === 0 ? NOT_RUN : `${L.error_path.refunded_or_error}/${L.error_path.n}` },
    { label: `Output entropy over ${s.entropy_bits.n} results`, value: s.entropy_bits.n === 0 ? NOT_RUN : `${s.entropy_bits.bits} bits (cap ${s.entropy_bits.max_bits})` },
    { label: "Results outside the allowed output states", value: s.closure.n === 0 ? NOT_RUN : `${s.closure.violations} in ${s.closure.n} evals (${s.closure.refunds} refunded)` },
  ];
}

export interface QualityRow {
  category: string;
  evals: number;
  arrowCorrect: string;
  arrowBuy: string;
  llmOnlyBuy: string;
}

const CATEGORY_ORDER = ["injected", "clean_good", "clean_bad"];
const CATEGORY_TITLE: Record<string, string> = {
  injected: "Injected listings (expected PASS)",
  clean_good: "Clean, good data (expected BUY)",
  clean_bad: "Clean, bad data (expected PASS)",
};
export const categoryTitle = (c: string): string => CATEGORY_TITLE[c] ?? c;

/** Quality-bench per listing group: Arrow's BUY count next to the LLM-only baseline's, from the recorded calls. */
export function qualityRows(s: BenchSummary | null, q: AttackInputs["quality"]): { rows: QualityRow[]; overall: Line[] } | null {
  if (!s || s.quality.n === 0) return null;
  const category = new Map((q?.wrappers ?? []).map((w) => [w.id, w.category]));
  const llm = (c: string) => {
    const calls = (q?.llmOnly ?? []).filter((b) => category.get(b.case_id) === c);
    return calls.length === 0 ? NOT_RUN : `${calls.filter((b) => b.verdict === "BUY").length}/${calls.length}`;
  };
  const keys = Object.keys(s.quality.by_category).sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return {
    rows: keys.map((c) => {
      const v = s.quality.by_category[c]!;
      return { category: c, evals: v.n, arrowCorrect: `${v.correct}/${v.n}`, arrowBuy: `${v.buy}/${v.n}`, llmOnlyBuy: llm(c) };
    }),
    overall: [
      { label: "Arrow: correct BUY/PASS", value: rate(s.quality.accuracy) },
      { label: "LLM-only baseline: correct BUY/PASS", value: s.quality.llm_only ? rate(s.quality.llm_only.accuracy) : NOT_RUN },
    ],
  };
}

// ---- G5 refusal room ----
export interface RoomRow {
  id: string;
  group: string;
  technique: string;
  scanner: string;
  result: string;
  verdict: Verdict | null;
  state: string | null;
  tx: { network: "testnet" | "mainnet"; hash: string } | null;
}

export const GROUP_TITLE: Record<string, string> = { plain: "Plain", unicode: "Unicode", encoding: "Encoding", language: "Other languages" };
export const GROUP_ORDER = ["plain", "unicode", "encoding", "language"];

/** The last live eval of a case wins, as in `bench:offline`. */
const lastBy = (rows: readonly LiveRow[]): Map<string, LiveRow> => new Map(rows.map((r) => [r.case_id, r]));

function resultOf(l: LiveRow | undefined): { result: string; verdict: Verdict | null } {
  if (!l) return { result: NOT_RUN, verdict: null };
  if (l.status === "done") {
    const verdict = verdictOf(l.state);
    return { result: verdict ?? "ERROR", verdict };
  }
  if (l.status === "refunded") return { result: `refunded${l.refund_reason ? ` (${l.refund_reason})` : ""}`, verdict: null };
  return { result: l.status, verdict: null };
}

function scannerOf(native: AttackInputs["native"], id: string): string {
  const g = native?.[id];
  if (!g || g.regex_flag === null) return "n/a";
  return g.regex_flag ? `flagged${g.gate_name ? `: ${g.gate_name}` : ""}` : "not flagged";
}

const rowOf = (a: { id: string; category: string; technique: string }, native: AttackInputs["native"], l: LiveRow | undefined): RoomRow => ({
  id: a.id, group: a.category, technique: a.technique, scanner: scannerOf(native, a.id), ...resultOf(l), state: l && l.status === "done" ? l.state : null,
  tx: l && l.tx_hash ? { network: l.network, hash: l.tx_hash } : null,
});

export interface RoomView {
  total: number;
  /** Attacks with a finished live eval. */
  ran: number;
  buy: number;
  /** `X/24 BUY`, counted from the live results; null while nothing has run. */
  headline: string | null;
  rows: RoomRow[];
  controls: (RoomRow & { expected: Verdict; matched: boolean | null })[];
  /** Controls that ran and gave a verdict other than the expected one: `Y/Z`; null while no control has run. */
  controlMiss: string | null;
}

export function roomView(i: Pick<AttackInputs, "room" | "native" | "roomLive">): RoomView | null {
  if (!i.room) return null;
  const live = lastBy(i.roomLive);
  const rows = i.room.attacks.map((a) => rowOf(a, i.native, live.get(a.id)));
  const ran = rows.filter((r) => r.verdict !== null).length;
  const buy = rows.filter((r) => r.verdict === "BUY").length;
  const controls = i.room.controls.map((c) => {
    const r = rowOf({ id: c.id, category: "control", technique: c.id === "C-CLEAN" ? "clean BUY/SELL trading data" : "junk data, no injection" }, i.native, live.get(c.id));
    return { ...r, expected: c.expected, matched: r.verdict === null ? null : r.verdict === c.expected };
  });
  const controlsRun = controls.filter((c) => c.matched !== null);
  return {
    total: rows.length,
    ran,
    buy,
    headline: ran === 0 ? null : `${buy}/${rows.length} BUY`,
    rows,
    controls,
    controlMiss: controlsRun.length === 0 ? null : `${controlsRun.filter((c) => c.matched === false).length}/${controlsRun.length}`,
  };
}

/** The mainnet subset: the attacks the room marks `mainnet_subset`, with the mainnet evals that were run. */
export function mainnetView(i: Pick<AttackInputs, "room" | "native" | "mainnetLive">): { rows: RoomRow[]; ran: number; buy: number } | null {
  if (!i.room || i.mainnetLive.length === 0) return null;
  const live = lastBy(i.mainnetLive);
  const rows = i.room.attacks.filter((a) => a.mainnet_subset).map((a) => rowOf(a, i.native, live.get(a.id)));
  return { rows, ran: rows.filter((r) => r.verdict !== null).length, buy: rows.filter((r) => r.verdict === "BUY").length };
}

/** Dollar text for the lemon comparison from a listing's base-unit amounts; null without a listing. */
export function lemonAmounts(l: { price: string; eval_fee: string } | null, fmt: (base: string) => string): { price: string; fee: string } | null {
  return l ? { price: fmt(l.price), fee: fmt(l.eval_fee) } : null;
}

/** Room attacks the deterministic rule layer stops on its own in the native replay (regex flag set): `{ k, n }`, or null without both files. */
export function nativeStopped(i: Pick<AttackInputs, "room" | "native">): { k: number; n: number } | null {
  if (!i.room || !i.native) return null;
  const native = i.native;
  return { k: i.room.attacks.filter((a) => native[a.id]?.regex_flag === true).length, n: i.room.attacks.length };
}
