// Testnet key lookup and key-file writing (WS4-T08, DEC D4-20). Mainnet full-access keys never enter scripts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { KeyPair, type KeyPairString } from "near-api-js";
import { isInsideRepo } from "./repo.ts";

export interface LegacyCredential {
  account_id: string;
  public_key: string;
  private_key: string;
}

/** NEAR_KEY_<ACCOUNT> env first (dots and dashes become _), then ~/.near-credentials/testnet/<account>.json. */
export function nearKey(network: "testnet", accountId: string): KeyPairString {
  const envName = "NEAR_KEY_" + accountId.toUpperCase().replace(/[.-]/g, "_");
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv as KeyPairString;
  const file = resolve(homedir(), ".near-credentials", network, `${accountId}.json`);
  if (existsSync(file)) {
    const pk = JSON.parse(readFileSync(file, "utf8")).private_key;
    if (typeof pk === "string" && pk.startsWith("ed25519:")) return pk as KeyPairString;
  }
  throw new Error(`No ${network} key for ${accountId}: set ${envName} or create ${file}`);
}

export function keyPairFor(network: "testnet", accountId: string): KeyPair {
  return KeyPair.fromString(nearKey(network, accountId));
}

/** Writes a near-cli legacy credential file with mode 0600. Refuses paths inside the repo and existing files. */
export function writeLegacyCredential(path: string, cred: LegacyCredential): void {
  const abs = resolve(path);
  if (isInsideRepo(abs)) throw new Error(`refusing to write a key file inside the repo: ${abs}`);
  if (existsSync(abs)) throw new Error(`${abs} already exists; refusing to overwrite`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(cred, null, 2) + "\n", { mode: 0o600 });
}
