// Secret-masking logger (WS4-T08, PLAN 7.6, DEC G-07). Scripts print through log(), never console.log on raw values.
const MASKS: RegExp[] = [
  /ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/g,
  /secp256k1:[1-9A-HJ-NP-Za-km-z]{40,}/g,
  /(?<!\/tx\/)0x[0-9a-fA-F]{64}/g, // a key; not the hash in an explorer /tx/ link (Base tx hashes have the same shape)
  /sk-[A-Za-z0-9_-]{8,}/g,
];

export function mask(s: string): string {
  return MASKS.reduce((acc, re) => acc.replace(re, "****"), s);
}

export function log(...args: unknown[]): void {
  console.log(args.map((a) => mask(typeof a === "string" ? a : JSON.stringify(a))).join(" "));
}

export type Chain = "near" | "base" | "solana";

/** Explorer link for a transaction. NearBlocks pages only, never its API (DEC G-07). */
export function explorerTx(network: "mainnet" | "testnet", chain: Chain, hash: string): string {
  if (chain === "base") return `https://basescan.org/tx/${hash}`;
  if (chain === "solana") return `https://solscan.io/tx/${hash}`;
  return `${network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${hash}`;
}
