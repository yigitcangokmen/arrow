// Network constants (DEC D-*, G-*, H-11). Env overrides are applied by scripts through resolveNetwork().
export type Network = "testnet" | "mainnet";

export interface NetworkConfig {
  rpc: string[];
  archivalRpc: string;
  contract: string;
  usdcToken: string;
  outlayer: string;
  outlayerApi: string;
  explorerTx: string;
  intents?: string;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  mainnet: {
    // fastnear first (STATE-12, X12-OPS-5): rpc.*.near.org is deprecated, answers -429 or takes 3-4 s, so it is only the fallback.
    rpc: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
    archivalRpc: "https://archival-rpc.mainnet.fastnear.com",
    contract: "arrow-market.near",
    usdcToken: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    outlayer: "outlayer.near",
    outlayerApi: "https://api.outlayer.ai",
    intents: "intents.near",
    explorerTx: "https://nearblocks.io/txns/",
  },
  testnet: {
    rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
    archivalRpc: "https://archival-rpc.testnet.fastnear.com",
    contract: "arrow.arrowhq.testnet",
    usdcToken: "arrow-usd.arrowhq.testnet",
    outlayer: "outlayer.testnet",
    outlayerApi: "https://testnet-api.outlayer.ai",
    explorerTx: "https://testnet.nearblocks.io/txns/",
  },
};

export const USDC_DECIMALS = 6;
export const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const SOL_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const MIN_GAS_NOTIFY = "300000000000000"; // DEC H-11
export const EXECUTE_INTENTS_GAS = 600_000_000_000_000n; // DEC H-11

/** Applies ARROW_CONTRACT_<NET> and <NET>_RPC_URL / <NET>_ARCHIVAL_RPC_URL overrides from an env-like record. */
export function resolveNetwork(network: Network, env: Record<string, string | undefined>): NetworkConfig {
  const base = NETWORKS[network];
  const up = network.toUpperCase();
  const rpc = env[`${up}_RPC_URL`];
  return {
    ...base,
    contract: env[`ARROW_CONTRACT_${up}`] || base.contract,
    rpc: rpc ? [rpc, ...base.rpc.filter((u) => u !== rpc)] : base.rpc,
    archivalRpc: env[`${up}_ARCHIVAL_RPC_URL`] || base.archivalRpc,
  };
}
