// WS4-T03 acceptance: params, normalization and signatures against fixtures/minhash-vectors.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Criteria, estimateJaccard, keyToU64, loadParams, MERSENNE_61, MINHASH_K, normalizeKey, signature, signatureHex, u64Hex,
} from "../src/index.ts";
import { MINHASH_PARAMS } from "../src/minhash-params.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const load = (f: string) => JSON.parse(readFileSync(resolve(FIX, f), "utf8"));
const vectors = load("minhash-vectors.json");
const key = (i: number) => createHash("sha256").update(`arrow:mh:test:${i}`).digest("hex");

describe("minhash", () => {
  it("params_loaded_128", () => {
    const p = loadParams();
    expect(MINHASH_K).toBe(128);
    expect(p.k).toBe(128);
    expect(p.a).toHaveLength(128);
    expect(p.b).toHaveLength(128);
    expect(p.prime).toBe(MERSENNE_61);
    expect(p.a.every((a) => a > 0n && a < p.prime)).toBe(true);
  });

  it("emit_ts_in_sync", () => {
    const p = load("minhash-params.json");
    expect({ k: MINHASH_PARAMS.k, prime: MINHASH_PARAMS.prime, a: [...MINHASH_PARAMS.a], b: [...MINHASH_PARAMS.b] }).toEqual({
      k: p.k, prime: p.prime, a: p.a, b: p.b,
    });
  });

  it("normalize_vectors", () => {
    expect(vectors.cases).toHaveLength(8);
    for (const c of vectors.cases) expect(c.keys.map(normalizeKey), c.id).toEqual(c.normalized);
  });

  it("normalization rules", () => {
    expect(normalizeKey("  Ａ B\t c ")).toBe("a b c");
    expect(normalizeKey("ΟΔΟΣ")).toBe("οδος"); // final sigma
    expect(normalizeKey("İ")).toBe("i̇");
    expect(normalizeKey("a​b")).toBe("a​b"); // zero-width characters stay (DEC I-17)
  });

  it("minhash_vectors_exact", () => {
    for (const c of vectors.cases) {
      expect(c.keys.map((k: string) => u64Hex(keyToU64(k))), `${c.id} u64`).toEqual(c.u64_hex);
      const hex = signatureHex(signature(c.keys));
      expect(hex.length).toBe(2048);
      expect(hex, c.id).toBe(c.signature_hex);
    }
  });

  it("empty set is ff x 128", () => {
    expect(signatureHex(signature([]))).toBe("ffffffffffffffff".repeat(128));
  });

  it("signature_order_independent", () => {
    const keys = Array.from({ length: 50 }, (_, i) => key(i));
    expect(signature([...keys].reverse())).toEqual(signature(keys));
    expect(signature(new Set(keys))).toEqual(signature(keys));
  });

  it("duplicates_no_effect", () => {
    const keys = Array.from({ length: 20 }, (_, i) => key(i));
    expect(signature([...keys, ...keys, ...keys.map((k) => ` ${k.toUpperCase()} `)])).toEqual(signature(keys));
  });

  it("jaccard_estimate_close", () => {
    // |A| = |B| = 1000 with 889 shared keys: true Jaccard = 889 / 1111 = 0.8
    const a = Array.from({ length: 1000 }, (_, i) => key(i));
    const b = Array.from({ length: 1000 }, (_, i) => key(i < 889 ? i : 10_000 + i));
    const est = estimateJaccard(signature(a), signature(b));
    expect(Math.abs(est - 0.8)).toBeLessThanOrEqual(0.1);
    expect(estimateJaccard(signature(a), signature(a))).toBe(1);
    const disjoint = Array.from({ length: 1000 }, (_, i) => key(50_000 + i));
    expect(estimateJaccard(signature(a), signature(disjoint))).toBeLessThan(0.1);
  });

  it("a signature fits criteria.minhash", () => {
    const c = { v: 1, text: "t", minhash: signatureHex(signature(["0xabc"])) };
    expect(Criteria.safeParse(c).success).toBe(true);
  });

  it("rejects signatures of different length", () => {
    expect(() => estimateJaccard([1n], [1n, 2n])).toThrow();
  });
});
