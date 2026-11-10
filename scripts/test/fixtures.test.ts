// Acceptance tests for the shared interface vectors (WS1-T03, DEC C-09).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixtureFiles } from "../src/gen-fixtures.ts";
import { minhashParamsJson, PRIME } from "../src/gen-minhash-params.ts";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const raw = (f: string) => readFileSync(resolve(FIXTURES, f), "utf8");
const load = (f: string) => JSON.parse(raw(f));

describe("fixtures v1", () => {
  it("minhash_params_deterministic", () => {
    expect(raw("minhash-params.json")).toBe(minhashParamsJson());
    const p = load("minhash-params.json");
    expect(p.k).toBe(128);
    expect(p.a).toHaveLength(128);
    expect(p.b).toHaveLength(128);
    for (const a of p.a) expect(BigInt(a) > 0n && BigInt(a) < PRIME).toBe(true);
    for (const b of p.b) expect(BigInt(b) >= 0n && BigInt(b) < PRIME).toBe(true);
  });

  it("generated vectors are byte-identical to the generator", () => {
    for (const [file, content] of Object.entries(fixtureFiles())) expect(raw(file), file).toBe(content);
  });

  it("state_index_formula", () => {
    const s = load("state-index-vectors.json");
    expect(s.scored).toHaveLength(50);
    const idx = s.scored.map((r: { idx: number }) => r.idx);
    expect(new Set(idx).size).toBe(50);
    expect(Math.min(...idx)).toBe(0);
    expect(Math.max(...idx)).toBe(49);
    for (const r of s.scored) expect(r.idx).toBe((r.verdict === "BUY" ? 25 : 0) + (r.fit - 1) * 5 + (r.novelty - 1));
    expect(s.verdict_mode).toEqual([
      { verdict: "PASS", idx: 0 },
      { verdict: "BUY", idx: 1 },
    ]);
    expect(s.bits_per_eval_milli).toEqual({ scored: 5673, verdict: 1585 });
    expect(Math.ceil(1000 * Math.log2(51))).toBe(5673);
    expect(Math.ceil(1000 * Math.log2(3))).toBe(1585);
  });

  it("msg_vectors_lengths", () => {
    const m = load("msg-vectors.json");
    const valid = Object.fromEntries(m.valid.map((v: { name: string; msg: Record<string, unknown> }) => [v.name, v.msg]));
    for (const v of m.valid) {
      if (v.msg.op === "list") {
        expect(v.msg.sealed_k).toHaveLength(260);
        expect(Buffer.from(v.msg.sealed_k, "base64")).toHaveLength(193);
      } else {
        expect(v.msg.buyer_pk).toMatch(/^04[0-9a-f]{128}$/);
      }
    }
    const max = valid.list_max_lengths;
    expect(max.title).toHaveLength(80);
    expect(max.public_desc).toHaveLength(280);
    expect(max.columns).toHaveLength(64);
    for (const c of max.columns) expect(c).toHaveLength(40);
    expect(max.blob_url).toHaveLength(200);
    expect(valid.eval_criteria_4140.sealed_criteria).toHaveLength(4140);
    expect(valid.list_min_price_and_fee.price).toBe(m.limits.config_min_price);
    expect(valid.list_min_price_and_fee.eval_fee).toBe(m.limits.config_min_eval_fee);
  });

  it("msg_vectors_shape", () => {
    const m = load("msg-vectors.json");
    expect(m.valid.length).toBeGreaterThanOrEqual(10);
    expect(m.invalid.filter((v: { stage: string }) => v.stage === "parse").length).toBeGreaterThanOrEqual(30);
    const names = [...m.valid, ...m.invalid].map((v: { name: string }) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const v of [...m.valid, ...m.invalid]) expect(("msg" in v) !== ("msg_raw" in v)).toBe(true);
    for (const v of m.invalid) {
      expect(typeof v.reason).toBe("string");
      expect(["parse", "config"]).toContain(v.stage);
    }
  });

  it("output_vectors_sizes", () => {
    const o = load("output-vectors.json");
    expect(o.max_bytes).toBe(900);
    const size = (n: string) => Buffer.byteLength(o.cases.find((c: { name: string }) => c.name === n).raw);
    expect(size("eval_ok")).toBe(227);
    expect(size("release_ok")).toBe(267);
    expect(size("derive_ok")).toBe(155);
    expect(size("not_ok")).toBe(18);
    expect(size("over_900_bytes")).toBe(901);
    expect(o.cases.length).toBeGreaterThanOrEqual(14);
    for (const c of o.cases) if (c.name !== "over_900_bytes") expect(Buffer.byteLength(c.raw)).toBeLessThanOrEqual(900);
  });

  it("criteria_examples_validate", () => {
    const schema = load("criteria-schema.json");
    const v = load("criteria-vectors.json");
    const limit = schema["x-arrow-max-bytes"];
    expect(limit).toBe(2975);
    const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
    for (const c of v.valid) {
      expect(fieldErrors(schema, c.criteria), c.name).toEqual([]);
      expect(bytes(c.criteria), c.name).toBeLessThanOrEqual(limit);
    }
    for (const c of v.invalid) {
      const broken = fieldErrors(schema, c.criteria).length > 0 || bytes(c.criteria) > limit;
      expect(broken, c.name).toBe(true);
    }
    const tooLarge = v.invalid.find((c: { name: string }) => c.name === "too_large");
    expect(fieldErrors(schema, tooLarge.criteria)).toEqual([]);
    expect(bytes(tooLarge.criteria)).toBeGreaterThan(limit);
  });

  it("no_private_keys_in_fixtures", () => {
    for (const f of readdirSync(FIXTURES).filter((f) => f.endsWith(".json")))
      expect(raw(f), f).not.toMatch(/"[^"]*(private|secret)[_-]?key[^"]*"\s*:/i);
  });
});

// Minimal checker for the keywords criteria-schema.json uses (no new dependency).
type Rule = {
  const?: unknown; type?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  pattern?: string; maxItems?: number; items?: Rule;
};
function ruleErrors(rule: Rule, x: unknown, path: string): string[] {
  const e: string[] = [];
  if ("const" in rule && x !== rule.const) e.push(`${path}: const`);
  if (rule.type === "integer" && !Number.isInteger(x)) return [...e, `${path}: integer`];
  if (rule.type === "number" && typeof x !== "number") return [...e, `${path}: number`];
  if (rule.type === "string" && typeof x !== "string") return [...e, `${path}: string`];
  if (rule.type === "array" && !Array.isArray(x)) return [...e, `${path}: array`];
  if (typeof x === "number") {
    if (rule.minimum !== undefined && x < rule.minimum) e.push(`${path}: minimum`);
    if (rule.maximum !== undefined && x > rule.maximum) e.push(`${path}: maximum`);
  }
  if (typeof x === "string") {
    const len = [...x].length;
    if (rule.minLength !== undefined && len < rule.minLength) e.push(`${path}: minLength`);
    if (rule.maxLength !== undefined && len > rule.maxLength) e.push(`${path}: maxLength`);
    if (rule.pattern !== undefined && !new RegExp(rule.pattern, "u").test(x)) e.push(`${path}: pattern`);
  }
  if (Array.isArray(x)) {
    if (rule.maxItems !== undefined && x.length > rule.maxItems) e.push(`${path}: maxItems`);
    if (rule.items) x.forEach((item, i) => e.push(...ruleErrors(rule.items as Rule, item, `${path}[${i}]`)));
  }
  return e;
}
function fieldErrors(schema: { properties: Record<string, Rule>; required: string[] }, x: Record<string, unknown>): string[] {
  const e: string[] = [];
  for (const k of schema.required) if (!(k in x)) e.push(`${k}: required`);
  for (const [k, val] of Object.entries(x)) {
    const rule = schema.properties[k];
    if (!rule) e.push(`${k}: additionalProperties`);
    else e.push(...ruleErrors(rule, val, k));
  }
  return e;
}
