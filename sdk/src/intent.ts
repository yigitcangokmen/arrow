// ERC-191 transfer intents for intents.near (DEC K-03, D4-05). Built with the intents-sdk payload builder and signed
// with a viem-style signer (a local account, or a MetaMask personal_sign adapter in the browser).
import {
  createIntentSignerViem, IntentsSDK, type IntentPayload, type IntentPrimitive, type MultiPayload, VersionedNonceBuilder,
} from "@defuse-protocol/intents-sdk";
import type { Account } from "viem";
import { MIN_GAS_NOTIFY, type Network } from "./config.ts";
import { currentSalt } from "./rpc.ts";

export type IntentTransfer = Extract<IntentPrimitive, { intent: "transfer" }>;
export type { IntentPayload, IntentPrimitive };
export type MultiPayloadErc191 = Extract<MultiPayload, { standard: "erc191" }>;
export type IntentSigner = Pick<Account, "address" | "signMessage">;

export const DEFAULT_DEADLINE_MS = 600_000; // 10 min; the sdk default of 1 min is too short for a MetaMask confirmation
const NONCE_GRACE_MS = 60_000; // the sdk's own factory lets the nonce outlive the intent by one minute

/** A transfer to the market contract; a `msg` makes intents.near call mt_on_transfer with at least min_gas. */
export function arrowTransferIntent(p: { receiverId: string; tokenId: string; amount: string; msg?: string; minGas?: string }): IntentTransfer {
  const intent: IntentTransfer = { intent: "transfer", receiver_id: p.receiverId, tokens: { [p.tokenId]: p.amount } };
  if (p.msg !== undefined) intent.msg = p.msg;
  const minGas = p.minGas ?? (p.msg !== undefined ? MIN_GAS_NOTIFY : undefined);
  if (minGas !== undefined) intent.min_gas = minGas;
  return intent;
}

let sdk: IntentsSDK | undefined;
const builder = () => (sdk ??= new IntentsSDK({ referral: "arrow", env: "production" })).intentBuilder();

/** Synchronous build with an explicit salt. `signer` must be lowercase (setSigner rejects checksum addresses). */
export function buildPayload(p: {
  signer: string;
  intents: IntentPrimitive[];
  salt: Uint8Array;
  deadlineMs?: number;
  nonceRandomBytes?: Uint8Array;
  now?: number;
}): IntentPayload & { signer_id: string } {
  const deadline = new Date((p.now ?? Date.now()) + (p.deadlineMs ?? DEFAULT_DEADLINE_MS));
  const nonce = VersionedNonceBuilder.encodeNonce(p.salt, new Date(deadline.getTime() + NONCE_GRACE_MS), p.nonceRandomBytes);
  return builder().setSigner(p.signer.toLowerCase()).setDeadline(deadline).setNonce(nonce).addIntents(p.intents).buildWithSalt(p.salt);
}

/** ERC-191: the signer signs the payload JSON string; the sdk converts the signature to "secp256k1:<base58>". */
export function signPayloadViem(payload: IntentPayload, signer: IntentSigner): Promise<MultiPayloadErc191> {
  return createIntentSignerViem({ signer }).signIntent(payload);
}

/** Signs a payload string the service built for us (1Click generate-intent); the string is signed byte for byte. */
export function signRawErc191(payload: string, signer: IntentSigner): Promise<MultiPayloadErc191> {
  return createIntentSignerViem({ signer }).signRaw({ payload });
}

export async function buildAndSignTransfer(p: {
  network?: Network;
  signer: IntentSigner;
  intents: IntentPrimitive[];
  deadlineMs?: number;
}): Promise<{ payload: IntentPayload & { signer_id: string }; multipayload: MultiPayloadErc191 }> {
  const salt = await currentSalt(p.network ?? "mainnet");
  const payload = buildPayload({ signer: p.signer.address, intents: p.intents, salt, deadlineMs: p.deadlineMs });
  return { payload, multipayload: await signPayloadViem(payload, p.signer) };
}
