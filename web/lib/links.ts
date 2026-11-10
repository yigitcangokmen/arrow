// DEC G-07: the only explorers we link to. No NearBlocks API call anywhere.
import type { Network } from "./config.ts";

export type Chain = "near" | "base" | "solana";

export const ALLOWED_TX_HOSTS = ["nearblocks.io", "testnet.nearblocks.io", "basescan.org", "solscan.io"] as const;

export function txUrl(chain: Chain, network: Network, hash: string): string {
  const h = encodeURIComponent(hash);
  if (chain === "base") return `https://basescan.org/tx/${h}`;
  if (chain === "solana") return `https://solscan.io/tx/${h}`;
  return network === "mainnet" ? `https://nearblocks.io/txns/${h}` : `https://testnet.nearblocks.io/txns/${h}`;
}

/** First 6 and last 4 characters: "ED5VCv…jT4k". Short hashes are shown whole. */
export function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
