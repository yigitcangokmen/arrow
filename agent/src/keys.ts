// Who pays and who decrypts (DEC D4-11, D4-20, J-05, J-06).
//  testnet: a NEAR account (key from env/near-credentials or the judge file) + a random secp256k1 decrypt scalar kept in
//           ~/.config/arrow (outside the repo, mode 0600).
//  mainnet: the EVM wallet from .env (buyer or seller); the decrypt key is the public demo key (--demo-key) or derived from a
//           signature on the site domain.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToHex, deriveViewingKeyEoa, demoViewingKey, type Network, publicKeyHex, reduceToScalar, siteDomain, type ViewingKey } from "@arrow/sdk";
import { requireEnv } from "../../scripts/src/lib/env.ts";
import { nearKey } from "../../scripts/src/lib/keystore.ts";

export type Role = "buyer" | "seller";

export interface Actor {
  network: Network;
  /** testnet: NEAR account id. mainnet: the lowercase 0x Intents account. */
  id: string;
  nearSecret?: `ed25519:${string}`;
  evm?: PrivateKeyAccount;
  viewingKey(): Promise<ViewingKey>;
}

export interface ActorFlags {
  account?: string;
  demoKey?: boolean;
}

export const configDir = (): string => process.env.ARROW_CONFIG_DIR || resolve(homedir(), ".config/arrow");
const JUDGE_FILE = "judge-testnet.json";
const E2E_FILE = "e2e-testnet.json";
const DEFAULT_TESTNET_ACCOUNT: Record<Role, string> = { buyer: "e2e-buyer.arrowhq.testnet", seller: "e2e-seller.arrowhq.testnet" };

interface Profile {
  account_id?: string;
  private_key?: string;
  buyer_scalar_hex?: string;
}

function readProfile(name: string): Profile | undefined {
  const f = resolve(configDir(), name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Profile) : undefined;
}

function writeProfile(name: string, p: Profile): void {
  const f = resolve(configDir(), name);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  chmodSync(f, 0o600);
}

/** A fresh random scalar in 1..n-1, from the OS random source. */
export const newScalarHex = (): string => bytesToHex(reduceToScalar(randomBytes(32)));

/** The testnet decrypt scalar: judge file, then the e2e file; created in the e2e file on first use. */
function testnetScalar(): string {
  const found = readProfile(JUDGE_FILE)?.buyer_scalar_hex ?? readProfile(E2E_FILE)?.buyer_scalar_hex;
  if (found) return found;
  const scalar = newScalarHex();
  writeProfile(E2E_FILE, { ...readProfile(E2E_FILE), buyer_scalar_hex: scalar });
  return scalar;
}

const viewingKeyFromScalar = (scalarHex: string): ViewingKey => ({ scalarHex, buyerPk: publicKeyHex(scalarHex) });

export function resolveActor(network: Network, role: Role, flags: ActorFlags = {}): Actor {
  if (network === "testnet") {
    const judge = readProfile(JUDGE_FILE);
    const e2e = readProfile(E2E_FILE);
    const profile = judge?.account_id ? judge : e2e?.account_id ? e2e : undefined;
    const id = flags.account ?? profile?.account_id ?? DEFAULT_TESTNET_ACCOUNT[role];
    const secret = (profile?.account_id === id ? profile.private_key : undefined) ?? nearKey("testnet", id);
    return {
      network,
      id,
      nearSecret: secret as `ed25519:${string}`,
      viewingKey: async () => viewingKeyFromScalar(testnetScalar()),
    };
  }
  const evm = privateKeyToAccount(requireEnv(`E2E_${role.toUpperCase()}_EVM_PRIVATE_KEY`) as `0x${string}`);
  return {
    network,
    id: evm.address.toLowerCase(),
    evm,
    viewingKey: async () => (flags.demoKey ? demoViewingKey() : deriveViewingKeyEoa(evm, siteDomain())),
  };
}
