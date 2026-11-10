// DEC G-07: the only explorers we link to. No NearBlocks API call anywhere.
import { DEFAULT_NETWORK, type Network } from "./config.ts";

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

/** A page path that keeps the viewed network: `?network=` is added only when it differs from the deploy's default. */
export function withNetwork(path: string, net: Network): string {
  return net === DEFAULT_NETWORK ? path : `${path}${path.includes("?") ? "&" : "?"}network=${net}`;
}

/** Page links of one listing: its inspect/buy page and its x402-shaped 402 endpoint. */
export function listingLinks(id: number | string, net: Network): { buy: string; x402: string } {
  return { buy: withNetwork(`/buy/${id}`, net), x402: withNetwork(`/l/${id}/data`, net) };
}
