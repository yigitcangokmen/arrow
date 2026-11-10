// Mainnet payment from the browser: one ERC-191 transfer intent with the msg attached, sent through /api/relay.
import { NETWORKS } from "@arrow/sdk/config";
import { arrowTransferIntent, buildAndSignTransfer } from "@arrow/sdk/intent";
import { relayHosted } from "@arrow/sdk/relay";
import type { MultiPayload } from "@arrow/sdk/schemas";
import { CONTRACTS } from "./config.ts";
import { type Eoa, intentSigner } from "./wallet.ts";

export interface PaidTx {
  txHash: string;
  signerId: string;
}

/** Signs (one wallet prompt) and relays a transfer of `amount` USDC base units to the market contract carrying `msg`. */
export async function payWithIntent(eoa: Eoa, a: { amount: bigint; msg: string }): Promise<PaidTx> {
  const intent = arrowTransferIntent({
    receiverId: CONTRACTS.mainnet,
    tokenId: NETWORKS.mainnet.usdcToken,
    amount: a.amount.toString(),
    msg: a.msg,
  });
  const { multipayload } = await buildAndSignTransfer({ network: "mainnet", signer: intentSigner(eoa), intents: [intent] });
  const { txHash, signerId } = await relayHosted(window.location.origin, multipayload as MultiPayload);
  return { txHash, signerId };
}
