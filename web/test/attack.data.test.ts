// WS5-T08: the /attack tables are counted from the recorded bench files, never typed. A missing file is null, and the
// counts equal what `npm run bench:offline` (bench/src/offline.ts) computes from the same results.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInputs, summarize } from "../../bench/src/offline.ts";
import { categoryTitle, GROUP_ORDER, leakLines, lemonAmounts, mainnetView, nativeStopped, qualityRows, readAttackInputs, roomView, verdictOf, type LiveRow } from "../lib/attack.ts";

const root = new URL("../../", import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

// the same projection web/scripts/copy-assets.mjs makes
const manifest = json("bench/injection-room/attacks.json");
const room = {
  attacks: manifest.attacks.map((a: any) => ({ id: a.id, category: a.category, technique: a.technique, lang: a.lang, regex_expected: a.regex_expected, mainnet_subset: a.mainnet_subset })),
  controls: manifest.controls.map((c: any) => ({ id: c.id, expected: c.expected })),
};
const native = json("bench/results/native-gates.json");
const wrappers = readdirSync(new URL("bench/criteria/quality/", root)).sort().map((f) => {
  const w = json(`bench/criteria/quality/${f}`);
  return { id: w.id, category: w.category, expected: w.expected };
});

const live = (case_id: string, state: string, over: Partial<LiveRow> = {}): LiveRow => ({
  case_id, network: "testnet", tx_hash: `tx-${case_id}`, status: "done", state, eval_id: 1, refund_reason: null, ...over,
});
const inputs = (over: Record<string, unknown> = {}) =>
  readAttackInputs({ bench: { "native-gates.json": native }, room, live: { room: [], "mainnet-subset": [], quality: { wrappers, llmOnly: [] } }, ...over }).inputs;

describe("missing results", () => {
  it("print nothing and invent nothing", () => {
    const { inputs: i, errors } = readAttackInputs({ bench: {}, room: null, live: {} });
    expect(errors).toEqual([]);
    expect(i).toEqual({ summary: null, native: null, room: null, roomLive: [], mainnetLive: [], quality: null });
    expect(leakLines(i.summary)).toBeNull();
    expect(qualityRows(i.summary, i.quality)).toBeNull();
    expect(roomView(i)).toBeNull();
    expect(mainnetView(i)).toBeNull();
  });

  it("a room without live evals has no X/24 headline, but the manifest rows and the scanner column are there", () => {
    const v = roomView(inputs())!;
    expect(v.total).toBe(24);
    expect(v.ran).toBe(0);
    expect(v.headline).toBeNull();
    expect(v.controlMiss).toBeNull();
    expect(v.rows.every((r) => r.result === "not run" && r.verdict === null && r.tx === null)).toBe(true);
    expect(v.rows.find((r) => r.id === "R-E1")!.scanner).toBe("flagged: ignore_prev");
    expect(v.rows.find((r) => r.id === "R-E2")!.scanner).toBe("not flagged");
    for (const g of GROUP_ORDER) expect(v.rows.filter((r) => r.group === g)).toHaveLength(6);
  });

  it("the rule-layer count on the home page and /attack is counted from native-gates.json, and is null without it", () => {
    expect(nativeStopped(inputs())).toEqual({ k: 20, n: 24 });
    expect(nativeStopped({ ...inputs(), native: null })).toBeNull();
  });

  it("without native gates the scanner column says n/a, not 'not flagged'", () => {
    const v = roomView({ ...inputs(), native: null })!;
    expect(v.rows.every((r) => r.scanner === "n/a")).toBe(true);
  });

  it("a file with the wrong shape is reported, not turned into zeros", () => {
    const { inputs: i, errors } = readAttackInputs({ bench: { "summary.json": { leak: 3 }, "native-gates.json": { cases: 5 } }, room: { attacks: "x" }, live: { room: [{ nope: 1 }] } });
    expect(errors.sort()).toEqual(["attacks.json does not have the expected shape", "live/room.jsonl does not have the expected shape", "native-gates.json does not have the expected shape", "summary.json does not have the expected shape"]);
    expect(i.summary).toBeNull();
    expect(roomView(i)).toBeNull();
  });
});

describe("X/24 is counted from the results", () => {
  it("counts BUY among the finished attacks and says how many ran", () => {
    const rows = [live("R-P1", "PASS·1·1"), live("R-P2", "BUY·5·4"), live("R-P3", "PASS"), live("R-P4", "ERROR", { status: "refunded", refund_reason: "bad_output" })];
    const v = roomView(inputs({ live: { room: rows, quality: null } }))!;
    expect(v).toMatchObject({ total: 24, ran: 3, buy: 1, headline: "1/24 BUY" });
    expect(v.rows.find((r) => r.id === "R-P4")).toMatchObject({ result: "refunded (bad_output)", verdict: null });
    expect(v.rows.find((r) => r.id === "R-P2")).toMatchObject({ result: "BUY", state: "BUY·5·4", tx: { network: "testnet", hash: "tx-R-P2" } });
  });

  it("0/24 is printed as 0/24, and a re-run of a case replaces the earlier eval", () => {
    const all = manifest.attacks.map((a: any) => live(a.id, "PASS·1·1"));
    expect(roomView(inputs({ live: { room: all, quality: null } }))!.headline).toBe("0/24 BUY");
    const rerun = roomView(inputs({ live: { room: [live("R-P1", "BUY·5·5"), live("R-P1", "PASS·1·1")], quality: null } }))!;
    expect(rerun).toMatchObject({ ran: 1, buy: 0, headline: "0/24 BUY" });
  });

  it("controls: the miss count is the controls whose verdict was not the expected one", () => {
    const v = roomView(inputs({ live: { room: [live("C-CLEAN", "PASS·1·1"), live("C-JUNK", "PASS·1·1")], quality: null } }))!;
    expect(v.controls.map((c) => [c.id, c.expected, c.matched])).toEqual([["C-CLEAN", "BUY", false], ["C-JUNK", "PASS", true]]);
    expect(v.controlMiss).toBe("1/2");
    expect(v.headline).toBeNull();
  });

  it("the mainnet subset is the 5 marked attacks, shown only once a mainnet eval exists", () => {
    expect(mainnetView(inputs())).toBeNull();
    const m = mainnetView(inputs({ live: { room: [], "mainnet-subset": [live("R-P1", "PASS·1·1", { network: "mainnet" })], quality: null } }))!;
    expect(m.rows.map((r) => r.id)).toEqual(["R-P1", "R-P6", "R-U3", "R-E1", "R-L1"]);
    expect(m).toMatchObject({ ran: 1, buy: 0 });
    expect(m.rows[0]!.tx).toEqual({ network: "mainnet", hash: "tx-R-P1" });
  });

  it("verdictOf reads the state strings the bench writes", () => {
    expect(["BUY·5·4", "BUY", "PASS·1·1", "PASS", "ERROR", ""].map(verdictOf)).toEqual(["BUY", "BUY", "PASS", "PASS", null, null]);
  });
});

describe("parity with bench:offline", () => {
  const liveEval = (suite: string, case_id: string, state: string, over: Record<string, unknown> = {}) => ({
    v: 1, suite, case_id, network: "testnet", contract: "arrow.arrowhq.testnet", wasm_sha256: "", commit: "", dataset_id: case_id.split("@")[0],
    listing_id: 1, mode: "scored", tx_hash: `tx-${case_id}`, request_id: 1, eval_id: 1, submitted_at_utc: "2026-11-12T10:00:00Z", finished_at_utc: "2026-11-12T10:01:00Z",
    status: "done", refund_reason: null, sealed_r_b64: null, idx: 3, state,
    outlayer: { success: true, error_message: null, instructions: 1, time_ms: 1, output_bytes: 200 }, budget_after: null, ...over,
  });
  const baseline = (case_id: string, verdict: string) => ({
    v: 1, case_id, kind: "llm_only", model: "m", chat_id: null, request_file: "r", response_file: null, request_sha256: "a".repeat(64), response_sha256: null,
    latency_ms: 1, parsed: { verdict }, text: null, signature_status: "pending",
  });
  const write = (dir: string, rel: string, lines: unknown[]) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };

  it("room BUY count, quality groups and LLM-only BUY equal the offline summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "attack-parity-"));
    const roomEvals = manifest.attacks.map((a: any, k: number) => liveEval("room", a.id, k % 7 === 0 ? "BUY·5·4" : "PASS·1·1"));
    const controls = [liveEval("room", "C-CLEAN", "BUY·5·4"), liveEval("room", "C-JUNK", "PASS·1·1")];
    const quality = [liveEval("quality", "Q11-a", "BUY·5·4"), liveEval("quality", "Q12-a", "PASS·1·1"), liveEval("quality", "Q01-a", "BUY·5·4"), liveEval("quality", "Q06-a", "PASS·1·1")];
    write(dir, "live/room.jsonl", [...roomEvals, ...controls]);
    write(dir, "live/quality.jsonl", quality);
    write(dir, "baselines/llm_only.jsonl", [baseline("Q11-a", "BUY"), baseline("Q12-a", "PASS"), baseline("R-P1", "BUY")]);
    writeFileSync(join(dir, "native-gates.json"), JSON.stringify(native));
    const summary = summarize(loadInputs(dir));

    const rows: LiveRow[] = [...roomEvals, ...controls].map((e: any) => live(e.case_id, e.state, { eval_id: e.eval_id }));
    const { inputs: i, errors } = readAttackInputs({ bench: { "summary.json": summary, "native-gates.json": native }, room, live: { room: rows, quality: { wrappers, llmOnly: [{ case_id: "Q11-a", verdict: "BUY" }, { case_id: "Q12-a", verdict: "PASS" }, { case_id: "R-P1", verdict: "BUY" }] } } });
    expect(errors).toEqual([]);

    const v = roomView(i)!;
    expect(v.buy).toBe(summary.room.live_buy!.k);
    expect(v.ran).toBe(summary.room.live_buy!.n);
    expect(v.headline).toBe(`${v.buy}/${summary.room.attacks} BUY`);
    for (const r of summary.room.rows.filter((x) => x.id.startsWith("R-"))) {
      expect(v.rows.find((x) => x.id === r.id)!.state, r.id).toBe(r.live);
      expect(v.rows.find((x) => x.id === r.id)!.scanner.startsWith("flagged"), r.id).toBe(r.native_flagged === true);
    }

    const q = qualityRows(i.summary, i.quality)!;
    for (const [cat, c] of Object.entries(summary.quality.by_category)) {
      const row = q.rows.find((x) => x.category === cat)!;
      expect(row).toMatchObject({ evals: c.n, arrowCorrect: `${c.correct}/${c.n}`, arrowBuy: `${c.buy}/${c.n}` });
    }
    expect(q.rows.find((x) => x.category === "injected")!.llmOnlyBuy).toBe("1/2");
    expect(q.rows.find((x) => x.category === "clean_good")!.llmOnlyBuy).toBe("not run");
    expect(q.overall[0]!.value).toBe(`${summary.quality.accuracy.k}/${summary.quality.accuracy.n} (${summary.quality.accuracy.rate})`);
    expect(q.rows.map((x) => x.category)).toEqual(["injected", "clean_good", "clean_bad"]);
  });

  it("an offline summary with no results parses and prints as not run", () => {
    const dir = mkdtempSync(join(tmpdir(), "attack-empty-"));
    const summary = summarize(loadInputs(dir));
    const { inputs: i, errors } = readAttackInputs({ bench: { "summary.json": summary }, room, live: {} });
    expect(errors).toEqual([]);
    expect(leakLines(i.summary)).toBeNull();
    expect(qualityRows(i.summary, i.quality)).toBeNull();
  });

  it("leak lines carry the eval counts and print not run for empty rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "attack-leak-"));
    const summary: any = summarize(loadInputs(dir));
    summary.leak.evals = 3;
    summary.leak.verbatim = { evals: 2, substring20_hits: 0, canary_hits: 0 };
    const lines = leakLines(readAttackInputs({ bench: { "summary.json": summary }, room: null, live: {} }).inputs.summary)!;
    expect(lines[0]).toEqual({ label: expect.stringContaining("over 2 verbatim"), value: "0 / 0" });
    expect(lines.find((l) => l.label.startsWith("Targeted"))!.value).toBe("not run");
    expect(lines.find((l) => l.label.includes("run time"))!.value).toBe("not run");
  });
});

describe("small helpers", () => {
  it("lemon amounts come from the listing; no listing, no amounts", () => {
    expect(lemonAmounts({ price: "2000000", eval_fee: "250000" }, (b) => `${Number(b) / 1e6}`)).toEqual({ price: "2", fee: "0.25" });
    expect(lemonAmounts(null, String)).toBeNull();
  });
  it("group titles", () => {
    expect(categoryTitle("injected")).toContain("expected PASS");
    expect(categoryTitle("odd")).toBe("odd");
  });
});
