import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeState } from "@arrow/sdk/state";
import { REFUND_LINE, formatBits, formatUsdc, stateLine } from "../lib/format.ts";

const vectors = JSON.parse(readFileSync(new URL("../../fixtures/state-index-vectors.json", import.meta.url), "utf8"));

describe("formatBits", () => {
  it("keeps at most two decimals and drops trailing zeros", () => {
    expect(formatBits(5673)).toBe("5.67");
    expect(formatBits(283650)).toBe("283.65");
    expect(formatBits(5000)).toBe("5");
    expect(formatBits(1585)).toBe("1.59");
    expect(formatBits(100000)).toBe("100");
    expect(formatBits(0)).toBe("0");
    expect(formatBits(2500)).toBe("2.5");
  });
});

describe("formatUsdc", () => {
  it("is exact on base units", () => {
    expect(formatUsdc("250000")).toBe("0.25");
    expect(formatUsdc("1999596")).toBe("1.999596");
    expect(formatUsdc("1000000")).toBe("1");
    expect(formatUsdc("9007199254740993")).toBe("9007199254.740993"); // beyond 2^53, still exact
  });
});

describe("stateLine", () => {
  it("renders every scored state from the shared vectors", () => {
    expect(vectors.scored).toHaveLength(50);
    for (const v of vectors.scored) {
      const s = decodeState(v.idx, "scored");
      expect(s).toMatchObject({ verdict: v.verdict, fit: v.fit, novelty: v.novelty });
      expect(stateLine(s, "scored")).toBe(`${v.verdict} · fit ${v.fit} · novelty ${v.novelty}`);
    }
  });

  it("renders verdict mode without scores", () => {
    for (const v of vectors.verdict_mode) expect(stateLine(decodeState(v.idx, "verdict"), "verdict")).toBe(v.verdict);
  });

  it("shows n/a when novelty is not available", () => {
    expect(stateLine({ verdict: "PASS", fit: 4 }, "scored")).toBe("PASS · fit 4 · novelty n/a");
  });
});

describe("REFUND_LINE", () => {
  it("never claims the money went back to a wallet", () => {
    expect(REFUND_LINE).toBe("Refunded to your NEAR Intents balance.");
  });
});

describe("SCAM-4: novelty is shown only when it was measured", () => {
  const s = { verdict: "BUY", fit: 5, novelty: 3 } as const;
  it("prints n/a when the buyer gave no list, the number when they did", () => {
    expect(stateLine(s, "scored", { hadList: false })).toBe("BUY · fit 5 · novelty n/a");
    expect(stateLine(s, "scored", { hadList: true })).toBe("BUY · fit 5 · novelty 3");
    expect(stateLine(s, "scored")).toBe("BUY · fit 5 · novelty 3");
    expect(stateLine({ verdict: "PASS" }, "verdict", { hadList: false })).toBe("PASS");
  });
});
