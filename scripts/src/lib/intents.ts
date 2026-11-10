// Read helpers for intents.near (WS4-T05).
import { type Network, NETWORKS, view } from "@arrow/sdk";

/** mt_balance_of(account, token) on the Intents contract, in token base units (NEAR USDC has 6 decimals). */
export async function mtBalanceOf(network: Network, account: string, token: string = NETWORKS[network].usdcToken): Promise<bigint> {
  const intents = NETWORKS[network].intents;
  if (!intents) throw new Error(`no intents contract on ${network}`);
  return BigInt(await view<string>(network, intents, "mt_balance_of", { account_id: account, token_id: token }));
}
