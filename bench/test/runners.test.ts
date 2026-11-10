// Acceptance tests for the bench runners (WS6-T05). No network, no keys: fetch and net.connect are stubbed where it matters.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64, bytesToHex, decodeState, encodeState, seal, sealedKPayload } from "@arrow/sdk";
import { rngFor } from "../src/gen/prng.ts";
import { planBaselines } from "../src/baselines.ts";
import { parseOutcomeLogs, stateString } from "../src/chain.ts";
import { benchBuyerKey, loadBenchK, maskAll, storeBenchK } from "../src/keys.ts";
import { buildPlan, describePlan } from "../src/live.ts";
import { closure, mutualInfo, outputEntropy, quantileBins, targetedInfo, verbatimHits, wilson } from "../src/metrics.ts";
import { chatRaw, fetchSignature, sha256Hex } from "../src/nearai.ts";
import { decodeBit, loadInputs, serialize, summarize } from "../src/offline.ts";
import { prepareBlobs } from "../src/prepare.ts";
import { renderMarkdown } from "../src/report.ts";
import { AttackWrapper, BaselineRecord, jsonSchemas, LiveEval, SignaturesFile } from "../src/schema.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = "bench/test/fixtures/results";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("schema", () => {
  it("every wrapper, room manifest and fixture row passes its schema", () => {
    for (const sub of ["leak", "quality"]) for (const f of readdirSync(resolve(ROOT, `bench/criteria/${sub}`))) expect(() => AttackWrapper.parse(JSON.parse(read(`bench/criteria/${sub}/${f}`))), f).not.toThrow();
    for (const s of ["leak", "quality", "room"]) for (const l of read(`${FIX}/live/${s}.jsonl`).split("\n").filter(Boolean)) expect(() => LiveEval.parse(JSON.parse(l))).not.toThrow();
    for (const l of read(`${FIX}/baselines/llm_only.jsonl`).split("\n").filter(Boolean)) expect(() => BaselineRecord.parse(JSON.parse(l))).not.toThrow();
  });
  it("schema_json_is_generated_from_zod", () => {
    if (existsSync(resolve(ROOT, "bench/results/schema.json"))) expect(read("bench/results/schema.json")).toBe(jsonSchemas());
    expect(JSON.parse(jsonSchemas()).LiveEval.properties.state).toBeDefined();
  });
  it("signatures_file_schema", () => {
    const item = { case_id: "Q03-a", kind: "llm_only", model: "Qwen/Qwen3.8-27B", chat_id: "chatcmpl-x", request_sha256: "a".repeat(64), response_sha256: "b".repeat(64), request_file: "r.req.json", response_file: "r.resp.json", status: "captured", signature_kind: "provider_tee", text: "t", signature: "0x01", signing_address: "0x" + "c".repeat(40), fetched_at_utc: "2026-11-12T11:30:00Z" };
    const ok = { v: 1, signing_algo: "ecdsa", attestation_file: null, attested_signing_addresses: [], total: 1, captured: 1, items: [item] };
    expect(() => SignaturesFile.parse(ok)).not.toThrow();
    expect(() => SignaturesFile.parse({ ...ok, captured: 2 })).toThrow(); // captured <= total
    expect(() => SignaturesFile.parse({ ...ok, signing_algo: "ed25519" })).toThrow();
  });
});

describe("metrics", () => {
  it("metrics_targeted_info_known_values", () => {
    const mk = (right: number, n: number) => Array.from({ length: n }, (_, i) => ({ truth: true, decoded: i < right }));
    expect(targetedInfo(mk(5, 10)).bits).toBeCloseTo(0, 10);
    expect(targetedInfo(mk(10, 10)).bits).toBeCloseTo(1, 10);
    expect(targetedInfo(mk(0, 10)).bits).toBeCloseTo(1, 10); // always wrong is as informative as always right
    const h = -(0.75 * Math.log2(0.75) + 0.25 * Math.log2(0.25));
    expect(targetedInfo(mk(1, 4)).bits).toBeCloseTo(1 - h, 10);
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
  it("metrics_mi_permutation_null", () => {
    // Independent data: the permutation p value is uniform under the null, so its mean over many datasets is near 0.5.
    let sum = 0;
    const trials = 30;
    for (let t = 0; t < trials; t++) {
      const r = rngFor(`mi-null/${t}`);
      const xs = Array.from({ length: 60 }, () => r.next() * 1000);
      const bits = Array.from({ length: 60 }, () => r.next() < 0.5);
      sum += mutualInfo(xs, bits, { bins: 2, permutations: 300, seed: `perm/${t}` }).p_value;
    }
    expect(sum / trials).toBeGreaterThan(0.35);
    expect(sum / trials).toBeLessThan(0.65);
    const r = rngFor("mi-dep");
    const bits = Array.from({ length: 60 }, () => r.next() < 0.5);
    const dep = mutualInfo(bits.map((b) => (b ? 900 : 100)), bits, { bins: 2, permutations: 2000, seed: "t2" });
    expect(dep.mi).toBeGreaterThan(0.9);
    expect(dep.mi).toBeLessThanOrEqual(1.0000001);
    expect(dep.p_value).toBeLessThan(0.01);
    const xs = bits.map((b) => (b ? 5 : 1));
    expect(mutualInfo(xs, bits, { bins: 2, permutations: 100, seed: "same" })).toEqual(mutualInfo(xs, bits, { bins: 2, permutations: 100, seed: "same" }));
    expect(quantileBins([5, 1, 3, 9], 2)).toEqual([1, 0, 0, 1]);
  });
  it("metrics_entropy", () => {
    expect(outputEntropy([1, 1, 1, 1])).toBe(0);
    expect(outputEntropy([0, 1])).toBeCloseTo(1, 10);
    expect(outputEntropy(Array.from({ length: 51 }, (_, i) => i))).toBeCloseTo(Math.log2(51), 10);
  });
  it("metrics_closure_flags_out_of_space", () => {
    const ok = { idx: 7, mode: "scored" as const, output_bytes: 227 };
    expect(closure([ok, { ...ok, idx: 49 }, { idx: null, mode: "scored", output_bytes: null, status: "refunded" }]).violations).toEqual([]);
    expect(closure([{ ...ok, idx: 50 }]).violations).toHaveLength(1);
    expect(closure([{ ...ok, decoded_len: 2 }]).violations).toHaveLength(1);
    expect(closure([{ ...ok, output_bytes: 901 }]).violations).toHaveLength(1);
    expect(closure([{ ...ok, output_bytes: 900 }]).violations).toEqual([]);
    expect(closure([{ ...ok, mode: "verdict", idx: 2 }]).violations).toHaveLength(1);
    expect(closure([ok]).refunds).toBe(0);
  });
  it("metrics_verbatim_hits", () => {
    const cells = ["OTC-0001", "CANARY-LB1-ABCDEFGHIJKLMNOP", "this note is longer than twenty characters"];
    expect(verbatimHits("PASS · fit 1 · novelty 1", cells, ["CANARY-LB1-ABCDEFGHIJKLMNOP"])).toEqual({ substring20: 0, canary: 0 });
    expect(verbatimHits("here: longer than twenty chara", cells, [])).toEqual({ substring20: 1, canary: 0 });
    expect(verbatimHits("x CANARY-LB1-ABCDEFGHIJKLMNOP x", cells, ["CANARY-LB1-ABCDEFGHIJKLMNOP"])).toEqual({ substring20: 1, canary: 1 });
    expect(verbatimHits("OTC-0001", cells, [])).toEqual({ substring20: 0, canary: 0 }); // short cells are not counted
  });
});

describe("offline", () => {
  let realFetch: typeof fetch;
  const key = process.env.NEARAI_API_KEY;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("network is off in bench:offline"); }) as typeof fetch;
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("net.connect is off in bench:offline"); });
    delete process.env.NEARAI_API_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    if (key !== undefined) process.env.NEARAI_API_KEY = key;
  });
  it("offline_runs_without_network_or_keys", () => {
    const s = summarize(loadInputs(FIX));
    expect(s.inputs.live).toEqual({ room: 3, quality: 4, leak: 11, "mainnet-subset": 0 });
    expect(renderMarkdown(s, "table")).toContain("| Measure | Result |");
    // the committed results (none yet) work too
    expect(() => summarize(loadInputs("bench/results"))).not.toThrow();
  });
  it("offline_output_is_byte_stable", () => {
    const a = serialize(summarize(loadInputs(FIX)));
    const b = serialize(summarize(loadInputs(FIX)));
    expect(a).toBe(b);
    expect(renderMarkdown(summarize(loadInputs(FIX)), "full")).toBe(renderMarkdown(summarize(loadInputs(FIX)), "full"));
  });
  it("offline_numbers_match_the_fixture_by_hand", () => {
    const s = summarize(loadInputs(FIX));
    expect(s.quality.accuracy).toEqual({ k: 3, n: 4, rate: "75.0%" }); // Q13-a is BUY on an injected listing (expected PASS)
    expect(s.quality.by_category.injected).toEqual({ n: 2, correct: 1, buy: 1 });
    expect(s.quality.llm_only?.accuracy).toEqual({ k: 2, n: 2, rate: "100.0%" }); // the R-P1 baseline is a room case, not a quality case
    expect(s.room.live_buy).toEqual({ k: 1, n: 2, rate: "50.0%" }); // R-P6 BUY; the C-CLEAN control is not an attack
    expect(s.room.deterministic_alone_stopped).toEqual({ k: 1, n: 2, rate: "50.0%" });
    expect(s.room.llm_only_buy).toEqual({ k: 1, n: 1, rate: "100.0%" });
    expect(s.closure).toEqual({ n: 18, violations: 0, refunds: 1 });
    expect(s.leak.error_path).toEqual({ n: 1, refunded_or_error: 1 });
    expect(s.leak.targeted).toMatchObject({ n: 3, accuracy: "0.667" });
  });
  it("offline_has_no_fetch_outside_verify_chain", () => {
    for (const f of ["offline.ts", "metrics.ts", "report.ts", "schema.ts", "truth.ts"]) expect(read(`bench/src/${f}`), f).not.toMatch(/\bfetch\s*\(/);
    expect(read("bench/src/offline.ts")).toMatch(/await import\("\.\/chain\.ts"\)/); // the only network path, imported lazily
  });
  it("decode_expressions", () => {
    expect(decodeBit("fit>=3", "BUY·5·3")).toBe(true);
    expect(decodeBit("fit>=3", "PASS·2·1")).toBe(false);
    expect(decodeBit("fit>=3", "ERROR")).toBeNull();
    expect(decodeBit("verdict==BUY", "BUY")).toBe(true);
    expect(decodeBit("novelty<=2", "PASS·1·5")).toBe(false);
    expect(() => decodeBit("what", "BUY")).toThrow();
  });
});

describe("chain", () => {
  it("chain_parse_logs_fixture", () => {
    const o = parseOutcomeLogs(JSON.parse(read("bench/test/fixtures/tx-eval-done.json")));
    expect(o).toEqual({ eval_id: 42, request_id: 777, refund_reason: null, resources_used: { instructions: 912345, time_ms: 4123 }, output_bytes: 227, success: true, error_message: null });
    const r = parseOutcomeLogs(JSON.parse(read("bench/test/fixtures/tx-eval-refund.json")));
    expect(r.refund_reason).toBe("hash_mismatch");
    expect(r.eval_id).toBeNull();
    expect(parseOutcomeLogs({})).toMatchObject({ eval_id: null, success: null });
  });
  it("state_index_matches_vectors", () => {
    const v = JSON.parse(read("fixtures/state-index-vectors.json"));
    for (const row of v.scored) {
      expect(stateString(row.idx, "scored")).toBe(`${row.verdict}·${row.fit}·${row.novelty}`);
      expect(encodeState({ verdict: row.verdict, fit: row.fit, novelty: row.novelty }, "scored")).toBe(row.idx);
    }
    for (const row of v.verdict_mode) expect(stateString(row.idx, "verdict")).toBe(row.verdict);
    expect(decodeState(0, "scored")).toEqual({ verdict: "PASS", fit: 1, novelty: 1 });
  });
});

describe("keys and logging", () => {
  it("bench_buyer_key_is_the_public_label_key", () => {
    const k = benchBuyerKey();
    expect(k.pubHex).toMatch(/^04[0-9a-f]{128}$/);
    expect(benchBuyerKey().scalarHex).toBe(k.scalarHex);
    expect(k.scalarHex).not.toBe(bytesToHex(new Uint8Array(32)));
  });
  it("keys_never_logged", () => {
    const k = "ab".repeat(32);
    expect(maskAll(`key ${k} and 0x${k} and ed25519:${"1".repeat(44)}`)).not.toMatch(/[0-9a-f]{64}|ed25519:[1-9A-HJ-NP-Za-km-z]{40}/);
    for (const f of ["prepare.ts", "live.ts", "baselines.ts", "chain.ts", "keys.ts"]) expect(read(`bench/src/${f}`), f).not.toMatch(/console\.log\([^)]*(\bk\b|key\.|private)/i);
  });
  it("keys_file_is_0600_and_refuses_the_repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-keys-"));
    try {
      const p = join(dir, "k.json");
      const k = new Uint8Array(32).fill(7);
      storeBenchK("aa".repeat(32), k, p);
      expect(statSync(p).mode & 0o777).toBe(0o600);
      expect(Array.from(loadBenchK("aa".repeat(32), p))).toEqual(Array.from(k));
      expect(() => loadBenchK("bb".repeat(32), p)).toThrow(/no bench key/);
      expect(() => storeBenchK("cc".repeat(32), k, resolve(ROOT, "bench/keys-test.json"))).toThrow(/inside the repo/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("prepare", () => {
  it("prepare_makes_49_blobs_reuses_them_and_keeps_keys_outside_the_repo", () => {
    const out = mkdtempSync(join(tmpdir(), "bench-blobs-")), keys = join(out, "keys.json");
    try {
      const a = prepareBlobs({ root: out, keysPath: keys, now: new Date("2026-11-12T05:00:00Z") });
      expect(a.entries).toHaveLength(49);
      expect(a.created).toBe(49);
      const b = prepareBlobs({ root: out, keysPath: keys });
      expect(b.reused).toBe(49);
      expect(b.created).toBe(0);
      expect(b.entries.map((e) => e.sha256)).toEqual(a.entries.map((e) => e.sha256));
      for (const e of a.entries) {
        const blob = readFileSync(join(out, e.path));
        expect(sha256Hex(new Uint8Array(blob))).toBe(e.sha256);
        expect(e.bytes).toBe(blob.length);
        expect(readFileSync(keys, "utf8")).toContain(e.sha256);
      }
      expect(readdirSync(join(out, "bench/blobs")).filter((n) => n.endsWith(".bin"))).toHaveLength(49);
      // the manifest holds no key material
      expect(readFileSync(join(out, "bench/blobs/manifest.json"), "utf8")).not.toMatch(/"key"|private|k_hex/);
      // a lost key forces a fresh blob for that dataset only
      writeFileSync(keys, "{}\n");
      expect(prepareBlobs({ root: out, keysPath: keys }).created).toBe(49);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 30_000);
  it("sealed_k_payload_roundtrip_shape", () => {
    const sealed = seal(benchBuyerKey().pubHex, sealedKPayload(new Uint8Array(32).fill(1), "ab".repeat(32), "bench.arrowhq.testnet"));
    expect(b64.enc(sealed)).toHaveLength(260);
  });
});

describe("live and baselines plans", () => {
  it("live_plan_is_181_evals_over_49_listings", () => {
    const jobs = buildPlan();
    expect(jobs).toHaveLength(181);
    expect(new Set(jobs.map((j) => j.dataset_id)).size).toBe(49);
    expect(jobs.filter((j) => j.suite === "room")).toHaveLength(26);
    expect(jobs.filter((j) => j.suite === "quality")).toHaveLength(40);
    expect(jobs.filter((j) => j.suite === "leak")).toHaveLength(115);
    expect(describePlan(jobs)).toContain("room 26 · quality 40 · leak 115 = 181 evals · listings 49");
    expect(jobs.filter((j) => j.suite === "leak" && j.mode === "verdict").every((j) => j.dataset_id === "LB3")).toBe(true);
    expect(jobs.filter((j) => j.raw !== null)).toHaveLength(5);
  });
  it("baselines_plan_is_116_calls", () => {
    const c = planBaselines();
    expect(c).toHaveLength(116);
    expect(c.filter((x) => x.kind === "llm_only")).toHaveLength(66);
    expect(c.filter((x) => x.kind === "naive")).toHaveLength(50);
    expect(new Set(c.filter((x) => x.kind === "naive").map((x) => x.job.case_id.split("@")[0])).size).toBe(50);
  });
  it("nearai_body_bytes_hashed_as_sent", async () => {
    let sent: Uint8Array | null = null;
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = init!.body as Uint8Array;
      expect((init!.headers as Record<string, string>)["x-no-aliasing"]).toBe("true");
      expect((init!.headers as Record<string, string>)["Accept-Encoding"]).toBe("identity");
      return new Response(JSON.stringify({ id: "chatcmpl-1", choices: [] }), { status: 200 });
    }) as typeof fetch;
    const body = '{"model":"m","messages":[],"temperature":0,"emoji":"ü"}';
    const r = await chatRaw(body, "k", f);
    expect(sent).toBeInstanceOf(Uint8Array);
    expect(sha256Hex(sent!)).toBe(r.reqSha256);
    expect(new TextDecoder().decode(sent!)).toBe(body);
    expect(r.chatId).toBe("chatcmpl-1");
  });
  it("signature_fetch_retries_404_then_reports_not_found", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("", { status: 404 }); }) as typeof fetch;
    const r = await fetchSignature("chatcmpl-x", "k", "m", f, async () => {});
    expect(r.status).toBe("not_found");
    expect(calls).toBe(5);
    const ok = (async () => new Response(JSON.stringify({ text: "t", signature: "0x01", signing_address: "0x" + "a".repeat(40) }), { status: 200 })) as typeof fetch;
    expect((await fetchSignature("c", "k", "m", ok, async () => {})).status).toBe("captured");
    const un = (async () => new Response(JSON.stringify({ error_code: "x" }), { status: 200 })) as typeof fetch;
    expect((await fetchSignature("c", "k", "m", un, async () => {})).status).toBe("unavailable");
  });
});
