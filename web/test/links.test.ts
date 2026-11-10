import { describe, expect, it } from "vitest";
import { ALLOWED_TX_HOSTS, shortHash, txUrl } from "../lib/links.ts";

describe("txUrl", () => {
  it("only produces links on the four allowed explorers", () => {
    const urls = [
      txUrl("near", "mainnet", "ABC"),
      txUrl("near", "testnet", "ABC"),
      txUrl("base", "mainnet", "0xabc"),
      txUrl("solana", "mainnet", "5xyz"),
    ];
    expect(urls).toEqual([
      "https://nearblocks.io/txns/ABC",
      "https://testnet.nearblocks.io/txns/ABC",
      "https://basescan.org/tx/0xabc",
      "https://solscan.io/tx/5xyz",
    ]);
    for (const u of urls) expect(ALLOWED_TX_HOSTS).toContain(new URL(u).hostname);
  });

  it("encodes the hash so it cannot change the URL", () => {
    expect(txUrl("near", "mainnet", "a/../b?x=1")).toBe("https://nearblocks.io/txns/a%2F..%2Fb%3Fx%3D1");
  });
});

describe("shortHash", () => {
  it("shows the first 6 and last 4 characters", () => {
    expect(shortHash("ED5VCvV6abcdefghijkl4Q5e")).toBe("ED5VCv…4Q5e");
    expect(shortHash("abc")).toBe("abc");
  });
});
