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

/** The explorer page of a seller: an Intents account that is an EVM address shows on Basescan, a NEAR account on NearBlocks. */
export function addressUrl(account: string, network: Network): string {
  const a = encodeURIComponent(account);
  if (/^0x[0-9a-fA-F]{40}$/.test(account)) return `https://basescan.org/address/${a}`;
  return network === "mainnet" ? `https://nearblocks.io/address/${a}` : `https://testnet.nearblocks.io/address/${a}`;
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

/**
 * The public source repository, or null while it is private: a private repo answers 404 to visitors, so the site shows no
 * GitHub link until this is set (making the repo public is a human step).
 */
export const REPO_URL: string | null = null;

/** The recorded run judges are sent to: eval #14 on arrow-v2.arrowhq.testnet, the wallet-labels inspection that was then bought (purchase #5). */
export const RECORDED_EVAL = 14;
/** That run as a page a visitor can watch: its steps replayed from the chain, with a transaction for each. */
export const RECORDED_RUN_PATH = "/try/recorded";
/** The rest of the recorded run: the listing it inspected and the purchase that followed (same account, same key). */
export const RECORDED_RUN = { listingId: 14, evalId: RECORDED_EVAL, purchaseId: 5 } as const;

export const NAV_LINKS = [
  ["/", "Arrow"],
  ["/sell", "Sell"],
  ["/seller", "Payouts"],
  ["/verify", "Verify"],
  ["/attack", "Attack"],
  ["/try", "Try"],
] as const;

/** The main navigation for the network being viewed: `?network=` is kept on every link that reads it. /attack and /try ignore it. */
export function navLinks(net: Network): { href: string; label: string }[] {
  return NAV_LINKS.map(([path, label]) => ({ href: path === "/attack" || path === "/try" ? path : withNetwork(path, net), label }));
}
