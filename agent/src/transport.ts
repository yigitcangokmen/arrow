// Moving USDC to the market contract (WS4-T11).
//  testnet: ft_transfer_call on the arrow-usd token from the buyer's NEAR account (300 TGas + 1 yocto, DEC D4-07).
//  mainnet: an ERC-191 transfer intent signed by the buyer's EVM wallet, sent through the hosted relay or the relayer account.
// Both return as soon as the transaction is included; callers wait for the contract's answer with settle.ts.
import { Account, FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import {
  arrowTransferIntent, buildAndSignTransfer, type IntentTransfer, type MultiPayload, type Network, NETWORKS, type NearCaller, relayDirect, relayHosted, resolveNetwork,
} from "@arrow/sdk";
import { explorerTx } from "../../scripts/src/lib/log.ts";
import type { Actor } from "./keys.ts";

export type RelayMode = "hosted" | "direct";

export interface PaidTx {
  txHash: string;
  /** The account that signed the NEAR transaction: the buyer on testnet, the relayer on mainnet. */
  signerId: string;
  url: string;
}

export interface Transport {
  /** Pays `amount` of the market's USDC to the contract with `msg` attached. */
  pay(a: { actor: Actor; amount: bigint; msg: string }): Promise<PaidTx>;
  /** A plain Intents transfer without msg (mainnet only): moves test funds between the team's own wallets. */
  transfer(a: { actor: Actor; toId: string; amount: bigint }): Promise<PaidTx>;
}

const FT_TRANSFER_CALL_GAS = 300_000_000_000_000n;
/** rpc.*.near.org rate-limits and answers -429 "deprecated" under load, so near-api-js gets the whole RPC list and fails over. */
export const rpcProvider = (network: Network, env: Record<string, string | undefined>) =>
  new FailoverRpcProvider(resolveNetwork(network, env).rpc.map((url) => new JsonRpcProvider({ url })));

function hostedBase(env: Record<string, string | undefined>): string {
  const base = env.ARROW_RELAY_URL || (env.NEXT_PUBLIC_SITE_DOMAIN ? `https://${env.NEXT_PUBLIC_SITE_DOMAIN}` : "");
  if (!base) throw new Error("no hosted relay: set ARROW_RELAY_URL or NEXT_PUBLIC_SITE_DOMAIN, or pass --relay direct");
  return base;
}

export function nearCaller(account: Account): NearCaller {
  return { callFunction: (a) => account.callFunctionRaw({ ...a, waitUntil: "INCLUDED_FINAL" }) };
}

export function realTransport(p: { network: Network; relay: RelayMode; env?: Record<string, string | undefined> }): Transport {
  const env = p.env ?? process.env;
  const cfg = resolveNetwork(p.network, env);

  async function relayIntent(actor: Actor, intent: IntentTransfer): Promise<PaidTx> {
    if (!actor.evm) throw new Error("mainnet payments need an EVM wallet");
    const signed = await buildAndSignTransfer({ network: "mainnet", signer: actor.evm, intents: [intent] });
    const multipayload = signed.multipayload as MultiPayload; // same JSON; zod's loose object has an index signature
    let txHash: string;
    let signerId: string;
    if (p.relay === "hosted") {
      ({ txHash, signerId } = await relayHosted(hostedBase(env), multipayload));
    } else {
      const key = env.RELAYER_PRIVATE_KEY;
      if (!key) throw new Error("RELAYER_PRIVATE_KEY is empty: direct relay needs the relayer key (H-07)");
      const relayer = new Account(env.RELAYER_ACCOUNT_ID || "arrow-relayer.arrowhq.near", rpcProvider("mainnet", env), key as `ed25519:${string}`);
      ({ txHash, signerId } = await relayDirect(nearCaller(relayer), multipayload));
    }
    return { txHash, signerId, url: explorerTx("mainnet", "near", txHash) };
  }

  return {
    async pay({ actor, amount, msg }) {
      if (p.network === "mainnet") {
        return relayIntent(actor, arrowTransferIntent({ receiverId: cfg.contract, tokenId: NETWORKS.mainnet.usdcToken, amount: amount.toString(), msg }));
      }
      if (!actor.nearSecret) throw new Error("testnet payments need a NEAR account key");
      const account = new Account(actor.id, rpcProvider("testnet", env), actor.nearSecret);
      const out = await account.callFunctionRaw({
        contractId: NETWORKS.testnet.usdcToken,
        methodName: "ft_transfer_call",
        args: { receiver_id: cfg.contract, amount: amount.toString(), msg },
        deposit: 1n,
        gas: FT_TRANSFER_CALL_GAS,
        waitUntil: "INCLUDED_FINAL",
      });
      const txHash = out.transaction.hash as string;
      return { txHash, signerId: actor.id, url: explorerTx("testnet", "near", txHash) };
    },

    async transfer({ actor, toId, amount }) {
      if (p.network !== "mainnet") throw new Error("transfer runs on mainnet only");
      return relayIntent(actor, arrowTransferIntent({ receiverId: toId, tokenId: NETWORKS.mainnet.usdcToken, amount: amount.toString() }));
    },
  };
}
