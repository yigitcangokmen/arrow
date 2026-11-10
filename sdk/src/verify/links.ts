import type { Network } from "../config.ts";

export type Chain = "near" | "base" | "solana";

/** Explorer page for a transaction. NearBlocks pages only, never its API (DEC G-07). */
export function txLink(network: Network, chain: Chain, hash: string): string {
  if (chain === "base") return `https://basescan.org/tx/${hash}`;
  if (chain === "solana") return `https://solscan.io/tx/${hash}`;
  return `${network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${hash}`;
}

/** 9f2c…e1 (64): first 4 and last 2 characters, then the full length. */
export const shortHash = (h: string): string => (h.length > 8 ? `${h.slice(0, 4)}…${h.slice(-2)} (${h.length})` : h);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** base58 string to lowercase hex (NEAR code hashes are base58 sha256). */
export function base58ToHex(s: string): string {
  let n = 0n;
  for (const ch of s) {
    const d = B58.indexOf(ch);
    if (d < 0) throw new Error(`not base58: "${s}"`);
    n = n * 58n + BigInt(d);
  }
  const lead = s.length - s.replace(/^1+/, "").length;
  const body = n === 0n ? "" : n.toString(16);
  return "00".repeat(lead) + (body.length % 2 ? "0" + body : body);
}
