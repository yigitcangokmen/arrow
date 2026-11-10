// near-api-js 7.4.0 factories. Server routes only (DEC L-06): never import this from a client component.
import { Account, FailoverRpcError, KeyPair, FailoverRpcProvider, JsonRpcProvider, actions, nearToYocto, type KeyPairString, type Provider } from "near-api-js";
import { resolveNetwork } from "@arrow/sdk/config";
import { viewAccessKey } from "@arrow/sdk/rpc";
import type { NearCaller } from "@arrow/sdk/relay";
import type { Network } from "../config.ts";

export { nearToYocto };
export type WaitUntil = "INCLUDED_FINAL" | "FINAL";

/**
 * One JsonRpcProvider per URL of the network (the same list the sdk's fetch client walks), wrapped in a
 * FailoverRpcProvider: a 429 or 5xx from rpc.<net>.near.org moves the call on to the next URL.
 */
export function provider(net: Network): Provider {
  const urls = resolveNetwork(net, process.env).rpc;
  return urls.length === 1 ? new JsonRpcProvider({ url: urls[0] }) : new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })));
}

/** Message of a thrown near-api-js error; for a failover error it is the per-URL causes, not "Exceeded N providers". */
export function nearErrorMessage(e: unknown): string {
  if (e instanceof FailoverRpcError) return e.errors.map((x) => String((x as Error)?.message ?? x)).join(" | ");
  return String((e as Error)?.message ?? e);
}

function accountFromEnv(idVar: string, keyVar: string, net: Network): Account | null {
  const id = process.env[idVar];
  const key = process.env[keyVar];
  if (!id || !key || !key.startsWith("ed25519:")) return null;
  return new Account(id, provider(net), key as KeyPairString);
}

/** The FunctionCall-key relayer on mainnet; null when RELAYER_ACCOUNT_ID or RELAYER_PRIVATE_KEY is not set. */
export const relayerAccount = (): Account | null => accountFromEnv("RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEY", "mainnet");

/** The full-access key of the testnet judge sponsor (creates sub-accounts). Null when not set. */
export const sponsorAccount = (): Account | null => accountFromEnv("TESTNET_SPONSOR_ACCOUNT_ID", "TESTNET_SPONSOR_PRIVATE_KEY", "testnet");

/** Second key of the relayer account: it may only call request_eval / request_release on the market contract (escrow path, DEC H-15). */
export const escrowAccount = (): Account | null => accountFromEnv("RELAYER_ACCOUNT_ID", "RELAYER_ESCROW_PRIVATE_KEY", "mainnet");

/** True when the key in `keyEnv` is a FunctionCall key restricted to execute_intents on intents.near. Cached for ten minutes once true. */
const keyOkAt = new Map<string, number>();
export async function isFunctionCallKey(a: Account, keyEnv = "RELAYER_PRIVATE_KEY"): Promise<boolean> {
  const last = keyOkAt.get(a.accountId);
  if (last !== undefined && Date.now() - last < 600_000) return true;
  const pk = KeyPair.fromString(process.env[keyEnv] as KeyPairString).getPublicKey().toString();
  const k = await viewAccessKey("mainnet", a.accountId, pk);
  const fc = typeof k.permission === "object" ? k.permission.FunctionCall : undefined;
  const ok = !!fc && fc.receiver_id === "intents.near" && fc.method_names.length === 1 && fc.method_names[0] === "execute_intents";
  if (ok) keyOkAt.set(a.accountId, Date.now());
  return ok;
}

export async function availableBalance(a: Account): Promise<bigint> {
  return (await a.getState()).balance.available;
}

/** Adapter to the sdk's NearCaller: one FunctionCall transaction, returned once it reaches `waitUntil`. */
export function callerFor(a: Account, waitUntil: WaitUntil): NearCaller {
  return {
    callFunction: ({ contractId, methodName, args, gas, deposit }) =>
      a.signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, gas, deposit)], waitUntil }),
  };
}
