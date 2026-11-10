// Relayer key rules for setup-relayer (WS4-T09, DEC D-04, K-04, red-team B4): the relayer account holds gas only, and its key is a
// FunctionCall key with an UNLIMITED allowance that can call exactly one method on one contract. A finite allowance would
// run dry after a few 600 TGas transactions.
import type { Network } from "@arrow/sdk";

export const INTENTS_METHODS = ["execute_intents"];
export const ESCROW_METHODS = ["request_eval", "request_release"];
export const RELAYER_WARN_ABOVE_NEAR = 1; // K-04: the relayer holds at most 1 NEAR
export const RELAYER_WARN_BELOW_NEAR = 0.3; // H-23: top up before it runs dry

export interface KeySpec {
  receiver: string;
  methods: string[];
}

type Permission = "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };

/** Returns the problems of an access key against its spec; an empty list means the key is right. */
export function keyProblems(permission: Permission | undefined, spec: KeySpec): string[] {
  if (!permission) return ["key not found on the account"];
  if (permission === "FullAccess") return ["key is FullAccess, expected a FunctionCall key"];
  const fc = permission.FunctionCall;
  if (!fc) return ["key has no FunctionCall permission"];
  const problems: string[] = [];
  if (fc.allowance !== null) problems.push(`allowance is ${fc.allowance} yoctoNEAR, expected unlimited (null): a finite allowance runs dry`);
  if (fc.receiver_id !== spec.receiver) problems.push(`receiver is ${fc.receiver_id}, expected ${spec.receiver}`);
  const have = [...fc.method_names].sort().join(",");
  const want = [...spec.methods].sort().join(",");
  if (have !== want) problems.push(`methods are [${fc.method_names.join(", ")}], expected exactly [${spec.methods.join(", ")}]`);
  return problems;
}

export const okLine = (spec: KeySpec) =>
  `FunctionCall key OK · allowance unlimited (null) · receiver ${spec.receiver} · methods [${spec.methods.join(", ")}]`;

/** The near-cli-rs command that adds the key. It holds the public key only. */
export function addKeyCommand(p: { network: Network; account: string; publicKey: string; spec: KeySpec }): string {
  const signer = p.network === "mainnet" ? "sign-with-keychain" : "sign-with-legacy-keychain";
  return [
    "near account add-key", p.account, "grant-function-call-access --allowance unlimited",
    "--contract-account-id", p.spec.receiver, "--function-names", p.spec.methods.join(","),
    "use-manually-provided-public-key", p.publicKey, "network-config", p.network, signer, "send",
  ].join(" ");
}

/** Balance warnings for the gas-only account (yoctoNEAR string in, NEAR numbers compared). */
export function balanceWarnings(yocto: string): string[] {
  const near = Number(BigInt(yocto) / 10n ** 20n) / 10_000; // 4 decimals is enough for a threshold test
  const out: string[] = [];
  if (near > RELAYER_WARN_ABOVE_NEAR) out.push(`relayer holds ${near} NEAR (> ${RELAYER_WARN_ABOVE_NEAR}): leave gas money only (DEC K-04)`);
  if (near < RELAYER_WARN_BELOW_NEAR) out.push(`relayer holds ${near} NEAR (< ${RELAYER_WARN_BELOW_NEAR}): top up (H-23)`);
  return out;
}
