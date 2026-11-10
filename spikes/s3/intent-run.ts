// Shared S3b/S3c flow (WS1-T09): an ERC-191 transfer of 0.01 USDC to the spike with msg {"mode":<mode>}.
// --dry: a throwaway in-memory EOA and simulate_intents only (free mainnet view, nothing signed with a team wallet).
// Real run (human, H-08c/H-08d): the buyer key from .env signs, the relayer's FC key sends execute_intents.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { KeyPairString } from "near-api-js";
import {
  arrowTransferIntent, buildAndSignTransfer, MultiPayload, NETWORKS, relayDirect, simulateIntents, view, type MultiPayloadErc191, type NearCaller,
} from "@arrow/sdk";
import { loadEnv, requireEnv } from "../../scripts/src/lib/env.ts";
import { log } from "../../scripts/src/lib/log.ts";

export const SPIKE = "arrow-spike.arrowhq.near";
export const AMOUNT = 10_000n; // 0.01 USDC (6 decimals)
const USDC = NETWORKS.mainnet.usdcToken;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SIGNATURE_ERROR = /invalid signature|public key|invalid nonce|invalid salt|deadline|wrong verifying_contract|JSON:/;
const BALANCE_ERROR = /insufficient balance or overflow|account '0x[0-9a-f]{40}' not found/;
export type SimClass = "OK" | "SIGNATURE_OK_BALANCE_ERROR" | "SIGNATURE_ERROR" | "OTHER";

export const mtBalance = async (accountId: string): Promise<bigint> =>
  BigInt(await view<string>("mainnet", "intents.near", "mt_balance_of", { account_id: accountId, token_id: USDC }));

export interface Prepared {
  buyer: string;
  multipayload: MultiPayloadErc191;
  sim: { cls: SimClass; error: string | null };
}

/** Builds, signs and simulates the transfer. Exits 1 on a signature error (nothing is sent then). */
export async function prepare(mode: string, dry: boolean): Promise<Prepared> {
  loadEnv();
  const signer = privateKeyToAccount((dry ? generatePrivateKey() : requireEnv("E2E_BUYER_EVM_PRIVATE_KEY")) as `0x${string}`);
  const buyer = signer.address.toLowerCase(); // Intents account ids are lowercase
  const intent = arrowTransferIntent({ receiverId: SPIKE, tokenId: USDC, amount: AMOUNT.toString(), msg: JSON.stringify({ mode }) });
  const { multipayload } = await buildAndSignTransfer({ network: "mainnet", signer, intents: [intent] });
  const body = JSON.parse(multipayload.payload).intents[0];
  log(`mode: ${mode}${dry ? " (dry: throwaway EOA, simulate only)" : ""}`);
  log(`buyer: ${buyer}`);
  log(`payload carries msg: ${body.msg === intent.msg ? "yes" : "NO"} · min_gas: ${body.min_gas === intent.min_gas ? "yes" : "NO"}`);

  let error: string | null = null;
  try {
    await simulateIntents([multipayload]);
  } catch (e) {
    error = (e as Error).message;
  }
  const cls: SimClass = error === null ? "OK" : SIGNATURE_ERROR.test(error) ? "SIGNATURE_ERROR" : BALANCE_ERROR.test(error) ? "SIGNATURE_OK_BALANCE_ERROR" : "OTHER";
  log(`simulate: ${error ?? "ok"}`);
  log(`class: ${cls}`);
  if (cls === "SIGNATURE_ERROR" || cls === "OTHER" || (!dry && cls !== "OK")) process.exit(1);
  return { buyer, multipayload, sim: { cls, error } };
}

/** execute_intents from the relayer's function-call key (near-api-js only here, never in the sdk). */
export async function execute(multipayload: MultiPayloadErc191, waitUntil: "FINAL" | "INCLUDED_FINAL") {
  const { Account } = await import("near-api-js");
  const { rpcProvider } = await import("../../agent/src/transport.ts");
  const relayerId = requireEnv("RELAYER_ACCOUNT_ID");
  const account = new Account(relayerId, rpcProvider("mainnet", process.env), requireEnv("RELAYER_PRIVATE_KEY") as KeyPairString);
  const caller: NearCaller = { callFunction: (a) => account.callFunctionRaw({ ...a, waitUntil }) };
  const result = await relayDirect(caller, MultiPayload.parse(multipayload));
  log(`tx: ${result.txHash} https://nearblocks.io/txns/${result.txHash}`);
  return result;
}

/** Appends one mainnet run through the single evidence CLI (block height and time come from the archival RPC). */
export function recordEvidence(run: Record<string, unknown>, sender: string): void {
  try {
    const out = execFileSync("npx", ["tsx", resolve(ROOT, "scripts/src/evidence-add.ts"), "--network", "mainnet", "--run", JSON.stringify(run), "--sender", sender], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    log(out.trim());
  } catch (e) {
    log(`evidence not written: ${(e as { stderr?: string }).stderr?.trim() ?? (e as Error).message}`);
    log(`run JSON (add it with another id): ${JSON.stringify(run)}`);
  }
}
