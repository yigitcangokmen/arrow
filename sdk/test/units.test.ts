// WS4-T01 acceptance: bits_constants, usdc_exact, network config.
import { describe, expect, it } from "vitest";
import {
  BITS_PER_EVAL_MILLI, budgetLine, formatBits, formatUsdc, NETWORKS, parseUsdc, resolveNetwork,
} from "../src/index.ts";

describe("units", () => {
  it("bits_constants", () => {
    expect(BITS_PER_EVAL_MILLI.scored).toBe(Math.ceil(1000 * Math.log2(51)));
    expect(BITS_PER_EVAL_MILLI.verdict).toBe(Math.ceil(1000 * Math.log2(3)));
    expect([BITS_PER_EVAL_MILLI.scored, BITS_PER_EVAL_MILLI.verdict]).toEqual([5673, 1585]);
  });

  it("formats bits with two decimals", () => {
    expect(formatBits(5673)).toBe("5.67");
    expect(formatBits(283650)).toBe("283.65");
    expect(formatBits(1585)).toBe("1.59");
    expect(formatBits(0)).toBe("0.00");
    expect(budgetLine({ bits_per_eval_milli: 5673, budget_milli: 283650 })).toBe("out: 5.67 bits / budget 283.65 bits");
  });

  it("usdc_exact", () => {
    expect(parseUsdc("0.1")).toBe(100000n);
    expect(parseUsdc("0.25")).toBe(250000n);
    expect(parseUsdc("12")).toBe(12000000n);
    expect(parseUsdc("1.999596")).toBe(1999596n);
    expect(formatUsdc(1999596n)).toBe("1.999596");
    expect(formatUsdc(250000n)).toBe("0.25");
    expect(formatUsdc(1000000n)).toBe("1");
    expect(formatUsdc(0n)).toBe("0");
    for (const bad of ["1.0000001", "-1", "", ".5", "1e3", "1,5", "0x10", " 1"]) expect(() => parseUsdc(bad), bad).toThrow();
    expect(() => formatUsdc(-1n)).toThrow();
  });

  it("network config", () => {
    expect(NETWORKS.mainnet.contract).toBe("arrow-market.near");
    expect(NETWORKS.testnet.usdcToken).toBe("arrow-usd.arrowhq.testnet");
    expect(NETWORKS.testnet.intents).toBeUndefined();
    const r = resolveNetwork("testnet", { ARROW_CONTRACT_TESTNET: "x.testnet", TESTNET_RPC_URL: "https://rpc.example" });
    expect(r.contract).toBe("x.testnet");
    expect(r.rpc[0]).toBe("https://rpc.example");
    expect(r.rpc).toContain(NETWORKS.testnet.rpc[0]);
    expect(resolveNetwork("mainnet", {})).toEqual(NETWORKS.mainnet);
  });
});
