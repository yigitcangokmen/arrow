// Moving USDC to the market contract (WS4-T11).
//  testnet: ft_transfer_call on the arrow-usd token from the buyer's NEAR account (300 TGas + 1 yocto, DEC D4-07).
//  mainnet: an ERC-191 transfer intent signed by the buyer's EVM wallet, sent through the hosted relay or the relayer account.
// Both return as soon as the transaction is included; callers wait for the contract's answer with settle.ts.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Account, FailoverRpcError, FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import {
  arrowTransferIntent, buildAndSignTransfer, type IntentTransfer, isNonceUsed, type MultiPayload, type Network, NETWORKS, type NearCaller, relayDirect, RelayError,
  relayHosted, RelayUnclear, resolveNetwork,
} from "@arrow/sdk";
import { explorerTx } from "../../scripts/src/lib/log.ts";
import { type Actor, configDir } from "./keys.ts";

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

/** FailoverRpcProvider console.errors every failed provider, stack and all; the 429s are expected under load and retried, so hide only those. */
export function muteRateLimitNoise(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.length === 1 && isRateLimited(args[0])) return;
    original(...args);
  };
}

const isRateLimited = (e: unknown): boolean =>
  e instanceof FailoverRpcError ? e.errors.length > 0 && e.errors.every(isRateLimited) : /\b429\b/.test(`${e instanceof Error ? e.message : String(e)} ${String((e as { cause?: unknown })?.cause ?? "")}`);

/**
 * The public RPCs answer 429 when several sessions poll at once. The request is refused before it runs, so a retry cannot
 * pay twice. Only errors that are all 429s are retried (3, 6, 12, 24, 30, 30 s); a timeout or a contract error is not.
 */
export async function retryRateLimited<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 6 || !isRateLimited(e)) throw e;
      await sleep(Math.min(3_000 * 2 ** i, 30_000));
    }
  }
}

function hostedBase(env: Record<string, string | undefined>): string {
  const base = env.ARROW_RELAY_URL || (env.NEXT_PUBLIC_SITE_DOMAIN ? `https://${env.NEXT_PUBLIC_SITE_DOMAIN}` : "");
  if (!base) throw new Error("no hosted relay: set ARROW_RELAY_URL or NEXT_PUBLIC_SITE_DOMAIN, or pass --relay direct");
  return base;
}

/** RELAY-3: the relay could not confirm a signed payment. It may have gone through, so the CLI exits 3 and never re-signs. */
export class PaymentUnclear extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentUnclear";
  }
}

interface PendingIntent {
  signer_id: string;
  nonce: string;
  deadline: string;
  multipayload: MultiPayload;
}

/** One pending file per payment: signer + receiver + what the msg pays for (op and listing, or the blob for a list). */
function pendingFile(actorId: string, intent: IntentTransfer): string {
  let what = `transfer:${JSON.stringify(intent.tokens)}`;
  if (intent.msg !== undefined) {
    const m = JSON.parse(intent.msg) as { op?: string; listing_id?: number; blob_sha256?: string };
    what = `${m.op}:${m.listing_id ?? m.blob_sha256}`;
  }
  const key = createHash("sha256").update(`mainnet\n${actorId}\n${intent.receiver_id}\n${what}`).digest("hex").slice(0, 32);
  return resolve(configDir(), "pending", `${key}.json`);
}

function readPending(file: string): PendingIntent | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PendingIntent) : undefined;
}

function writePending(file: string, multipayload: MultiPayload): PendingIntent {
  const payload = JSON.parse(multipayload.payload) as { signer_id: string; nonce: string; deadline: string };
  const p: PendingIntent = { signer_id: payload.signer_id, nonce: payload.nonce, deadline: payload.deadline, multipayload };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return p;
}

/** A signed intent cannot execute after its deadline; two minutes cover the clock difference to the chain. */
const EXPIRED_AFTER_MS = 120_000;

export function nearCaller(account: Account): NearCaller {
  return { callFunction: (a) => account.callFunctionRaw({ ...a, waitUntil: "INCLUDED_FINAL" }) };
}

export function realTransport(p: { network: Network; relay: RelayMode; env?: Record<string, string | undefined>; log?: (line: string) => void }): Transport {
  const env = p.env ?? process.env;
  const cfg = resolveNetwork(p.network, env);
  const log = p.log ?? ((line: string) => console.error(line));

  async function send(multipayload: MultiPayload): Promise<{ txHash: string; signerId: string }> {
    if (p.relay === "hosted") return relayHosted(hostedBase(env), multipayload);
    const key = env.RELAYER_PRIVATE_KEY;
    if (!key) throw new RelayError("RELAYER_PRIVATE_KEY is empty: direct relay needs the relayer key (H-07)", 0, "NO_RELAYER_KEY");
    const relayer = new Account(env.RELAYER_ACCOUNT_ID || "arrow-relayer.arrowhq.near", rpcProvider("mainnet", env), key as `ed25519:${string}`);
    return relayDirect(nearCaller(relayer), multipayload);
  }

  /**
   * RELAY-3: the signed multipayload is saved (0600, under ~/.config/arrow/pending) before it is sent. After an unclear
   * answer the next run of the same payment re-sends those exact bytes, so the relay's dedupe and intents.near's nonce
   * check stop a second payment; a new intent is signed only once the old nonce is unused and its deadline has passed.
   */
  async function relayIntent(actor: Actor, intent: IntentTransfer): Promise<PaidTx> {
    if (!actor.evm) throw new Error("mainnet payments need an EVM wallet");
    if (p.relay === "hosted") hostedBase(env); // a missing relay URL is a config error, before anything is signed
    const file = pendingFile(actor.id, intent);
    let pending = readPending(file);
    if (pending) {
      if (await isNonceUsed(pending.signer_id, pending.nonce)) {
        rmSync(file, { force: true });
        throw new PaymentUnclear(`the payment signed earlier for this (nonce ${pending.nonce}) already went through on NEAR Intents: not paying again. Check the record with \`status\`.`);
      }
      if (Date.parse(pending.deadline) + EXPIRED_AFTER_MS < Date.now()) {
        rmSync(file, { force: true });
        pending = undefined; // expired and never executed: a fresh intent cannot pay twice
      } else {
        log(`re-sending the payment signed earlier (nonce ${pending.nonce}); no new signature`);
      }
    }
    const reused = pending !== undefined;
    if (!pending) {
      const signed = await buildAndSignTransfer({ network: "mainnet", signer: actor.evm, intents: [intent] });
      pending = writePending(file, signed.multipayload as MultiPayload); // same JSON; zod's loose object has an index signature
    }
    let r: { txHash: string; signerId: string };
    try {
      r = await send(pending.multipayload);
    } catch (e) {
      if (e instanceof RelayError && e.code === "ALREADY_RELAYED") {
        rmSync(file, { force: true });
        throw new PaymentUnclear(`${e.message} (nonce ${pending.nonce}): not paying again. Check the record with \`status\`.`);
      }
      if (e instanceof RelayUnclear || !(e instanceof RelayError)) {
        throw new PaymentUnclear(`${e instanceof Error ? e.message : String(e)} Payment nonce ${pending.nonce} (signer ${pending.signer_id}). Run the same command again: it re-sends this signed payment and never signs a new one.`);
      }
      if (!reused) rmSync(file, { force: true }); // refused before broadcast, and never sent before
      throw e;
    }
    rmSync(file, { force: true });
    return { txHash: r.txHash, signerId: r.signerId, url: explorerTx("mainnet", "near", r.txHash) };
  }

  return {
    async pay({ actor, amount, msg }) {
      if (p.network === "mainnet") {
        return relayIntent(actor, arrowTransferIntent({ receiverId: cfg.contract, tokenId: NETWORKS.mainnet.usdcToken, amount: amount.toString(), msg }));
      }
      if (!actor.nearSecret) throw new Error("testnet payments need a NEAR account key");
      const account = new Account(actor.id, rpcProvider("testnet", env), actor.nearSecret);
      const out = await retryRateLimited(() => account.callFunctionRaw({
        contractId: NETWORKS.testnet.usdcToken,
        methodName: "ft_transfer_call",
        args: { receiver_id: cfg.contract, amount: amount.toString(), msg },
        deposit: 1n,
        gas: FT_TRANSFER_CALL_GAS,
        waitUntil: "INCLUDED_FINAL",
      }));
      const txHash = out.transaction.hash as string;
      return { txHash, signerId: actor.id, url: explorerTx("testnet", "near", txHash) };
    },

    async transfer({ actor, toId, amount }) {
      if (p.network !== "mainnet") throw new Error("transfer runs on mainnet only");
      return relayIntent(actor, arrowTransferIntent({ receiverId: toId, tokenId: NETWORKS.mainnet.usdcToken, amount: amount.toString() }));
    },
  };
}
