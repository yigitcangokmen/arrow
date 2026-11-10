// Mainnet payment from the browser: one ERC-191 transfer intent with the msg attached, sent through /api/relay.
// The rules that keep a payment from being paid twice live in payFlow.ts; this file only wires them to the wallet and the network.
import { NETWORKS } from "@arrow/sdk/config";
import { arrowTransferIntent, buildAndSignTransfer } from "@arrow/sdk/intent";
import { relayHosted } from "@arrow/sdk/relay";
import { view } from "@arrow/sdk/rpc";
import type { MultiPayload } from "@arrow/sdk/schemas";
import { CONTRACTS } from "./config.ts";
import { type PayDeps, type PayRequest, type PaidTx, payOnce, resumePending } from "./payFlow.ts";
import { browserStorage, historyStore, pendingStore } from "./pending.ts";
import { type Eoa, intentSigner } from "./wallet.ts";

export type { PaidTx };
export { PaymentPending, PaymentUnclear } from "./payFlow.ts";

const NETWORK = "mainnet" as const;

function realDeps(eoa: Eoa): PayDeps {
  const storage = browserStorage();
  return {
    network: NETWORK,
    store: pendingStore(storage),
    history: historyStore(storage),
    async sign({ amount, msg }) {
      const intent = arrowTransferIntent({
        receiverId: CONTRACTS.mainnet,
        tokenId: NETWORKS.mainnet.usdcToken,
        amount: amount.toString(),
        msg,
      });
      const { multipayload } = await buildAndSignTransfer({ network: NETWORK, signer: intentSigner(eoa), intents: [intent] });
      return multipayload as MultiPayload;
    },
    relay: (mp) => relayHosted(window.location.origin, mp),
    isNonceUsed: (signerId, nonce) => view<boolean>(NETWORK, NETWORKS.mainnet.intents ?? "intents.near", "is_nonce_used", { account_id: signerId, nonce }),
    now: Date.now,
  };
}

/** Signs (one wallet prompt) and relays a transfer of `amount` USDC base units to the market contract carrying `msg`. */
export const payWithIntent = (eoa: Eoa, a: Omit<PayRequest, "signerId">): Promise<PaidTx & { at: number }> => payOnce(realDeps(eoa), { ...a, signerId: eoa.intentsId });

/** "Check payment": re-sends the stored signed payment, never signs. */
export const checkPayment = (eoa: Eoa) => resumePending(realDeps(eoa), eoa.intentsId);

/** The unconfirmed payment of this wallet, if any (read at page load so a reload cannot sign a second one). */
export const pendingPayment = (eoa: Eoa) => realDeps(eoa).store.get(NETWORK, eoa.intentsId);

export const paidHistory = (eoa: Eoa, listingId: number) => realDeps(eoa).history.list(NETWORK, eoa.intentsId, listingId);
export const setPaidResult = (eoa: Eoa, at: number, id: number) => realDeps(eoa).history.setResultId(NETWORK, eoa.intentsId, at, id);
