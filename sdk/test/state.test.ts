// WS4-T01 acceptance: state_index_vectors_roundtrip, output_space_at_most_51.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeState, encodeState, GUARD_TRIPPED_INDEX } from "../src/index.ts";

const vectors = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/state-index-vectors.json"), "utf8"),
);

describe("state index", () => {
  it("state_index_vectors_roundtrip", () => {
    expect(vectors.scored).toHaveLength(50);
    for (const s of vectors.scored) {
      expect(encodeState(s, "scored"), JSON.stringify(s)).toBe(s.idx);
      expect(decodeState(s.idx, "scored")).toEqual({ verdict: s.verdict, fit: s.fit, novelty: s.novelty });
    }
    for (const s of vectors.verdict_mode) {
      expect(encodeState({ verdict: s.verdict }, "verdict")).toBe(s.idx);
      expect(decodeState(s.idx, "verdict")).toEqual({ verdict: s.verdict });
    }
  });

  it("output_space_at_most_51", () => {
    const seen = new Set<number>();
    for (const verdict of ["PASS", "BUY"] as const)
      for (let fit = 1; fit <= 5; fit++)
        for (let novelty = 1; novelty <= 5; novelty++) seen.add(encodeState({ verdict, fit, novelty }, "scored"));
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(50).keys()]);
    expect(seen.size + 1).toBe(vectors.states.scored); // + the ok:false error state
    expect(2 + 1).toBe(vectors.states.verdict);
  });

  it("a guard trip is PASS fit 1 novelty 1 in both modes", () => {
    expect(GUARD_TRIPPED_INDEX).toBe(vectors.guard_tripped.scored_idx);
    expect(decodeState(GUARD_TRIPPED_INDEX, "scored")).toEqual({ verdict: "PASS", fit: 1, novelty: 1 });
    expect(decodeState(GUARD_TRIPPED_INDEX, "verdict")).toEqual({ verdict: "PASS" });
  });

  it("rejects out-of-range input instead of inventing a state", () => {
    expect(() => decodeState(50, "scored")).toThrow();
    expect(() => decodeState(2, "verdict")).toThrow();
    expect(() => encodeState({ verdict: "BUY", fit: 6, novelty: 1 }, "scored")).toThrow();
    expect(() => encodeState({ verdict: "BUY" }, "scored")).toThrow();
  });
});
