export type Network = "mainnet" | "testnet";

// NEXT_PUBLIC_* names are written out literally: Next inlines only literal process.env.NAME accesses.
export const DEFAULT_NETWORK: Network =
  process.env.NEXT_PUBLIC_ARROW_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const CONTRACTS: Record<Network, string> = {
  mainnet: process.env.NEXT_PUBLIC_ARROW_CONTRACT_MAINNET ?? "arrow-market.near",
  testnet: process.env.NEXT_PUBLIC_ARROW_CONTRACT_TESTNET ?? "arrow-v2.arrowhq.testnet", // the testnet market that runs rc2; arrow.arrowhq.testnet still runs the old program
};

export const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "";

/** Unknown, missing or malformed values fall back to the deploy's default network. */
export function parseNetwork(v: string | null | undefined): Network {
  return v === "mainnet" || v === "testnet" ? v : DEFAULT_NETWORK;
}
