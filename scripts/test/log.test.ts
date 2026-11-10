// WS4-T08 acceptance: log_mask_patterns, plus explorer link rules (DEC G-07).
import { describe, expect, it } from "vitest";
import { explorerTx, mask } from "../src/lib/log.ts";

const B58 = "A".repeat(50);

describe("mask", () => {
  it("log_mask_patterns", () => {
    const hex64 = "0x" + "ab".repeat(32);
    const samples = [`ed25519:${B58}`, `secp256k1:${B58}`, hex64, "sk-abcdEFGH12345678"];
    for (const s of samples) expect(mask(`k=${s}.`)).toBe("k=****.");
  });

  it("leaves addresses, short hex and tx hashes alone", () => {
    const addr = "0x" + "ab".repeat(20);
    expect(mask(addr)).toBe(addr);
    expect(mask("sk-ab")).toBe("sk-ab");
    expect(mask("ed25519:short")).toBe("ed25519:short");
  });
});

describe("explorerTx", () => {
  it("uses nearblocks pages, basescan and solscan only", () => {
    expect(explorerTx("mainnet", "near", "H")).toBe("https://nearblocks.io/txns/H");
    expect(explorerTx("testnet", "near", "H")).toBe("https://testnet.nearblocks.io/txns/H");
    expect(explorerTx("mainnet", "base", "H")).toBe("https://basescan.org/tx/H");
    expect(explorerTx("mainnet", "solana", "H")).toBe("https://solscan.io/tx/H");
  });
});
