import { NETWORKS } from "@arrow/sdk/config";
import { view } from "@arrow/sdk/rpc";

/** USDC held by an Intents account on mainnet, in base units (mt_balance_of on intents.near). */
export async function intentsUsdcBalance(intentsId: string): Promise<bigint> {
  const raw = await view<string>("mainnet", NETWORKS.mainnet.intents ?? "intents.near", "mt_balance_of", {
    account_id: intentsId,
    token_id: NETWORKS.mainnet.usdcToken,
  });
  return BigInt(raw);
}
