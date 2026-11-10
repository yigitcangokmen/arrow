// Bench keys (WS6-T05, card section 2.4). Bench blob keys K live outside the repo in ~/.config/arrow/bench-keys.json (0600).
// The buyer key is the public label key (DEC J-06 "kalsin"), so anyone can decrypt the recorded results.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { bytesToHex, hexToBytes, publicKeyHex, scalarFromLabel } from "@arrow/sdk";
import { KeyPairSigner } from "near-api-js";
import { isInsideRepo } from "../../scripts/src/lib/repo.ts";
import { mask } from "../../scripts/src/lib/log.ts";
import { nearKey } from "../../scripts/src/lib/keystore.ts";

export const BENCH_BUYER_LABEL = "arrow:bench-buyer:public:v1";
export const defaultKeysPath = () => resolve(homedir(), ".config/arrow/bench-keys.json");

export function benchBuyerKey(): { priv: Uint8Array; scalarHex: string; pubHex: string } {
  const scalarHex = scalarFromLabel(BENCH_BUYER_LABEL);
  return { priv: hexToBytes(scalarHex), scalarHex, pubHex: publicKeyHex(scalarHex) };
}

function readMap(path: string): Record<string, string> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

/** Stores K (hex) under the blob sha256. Refuses a path inside the repo; the file is 0600. */
export function storeBenchK(sha: string, k: Uint8Array, path = defaultKeysPath()): void {
  if (isInsideRepo(path)) throw new Error("refusing to write bench keys inside the repo");
  if (k.length !== 32) throw new Error("K must be 32 bytes");
  mkdirSync(dirname(path), { recursive: true });
  const m = readMap(path);
  m[sha] = bytesToHex(k);
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadBenchK(sha: string, path = defaultKeysPath()): Uint8Array {
  const hex = readMap(path)[sha];
  if (!hex) throw new Error(`no bench key for blob ${sha.slice(0, 12)}...; run npm run bench:prepare`);
  return hexToBytes(hex);
}

/** Testnet signer from NEAR_KEY_<ACCOUNT> or ~/.near-credentials/testnet/<account>.json. The key is never printed. */
export function loadNearSigner(accountId: string, network: "testnet"): KeyPairSigner {
  return KeyPairSigner.fromSecretKey(nearKey(network, accountId));
}

/** Bench output goes through this: the shared secret masks plus a bare 64-hex run (a K). Print hashes with short(). */
export const maskAll = (s: string): string => mask(s).replace(/\b[0-9a-fA-F]{64}\b/g, "****");
export const say = (...a: unknown[]): void => console.log(a.map((x) => maskAll(typeof x === "string" ? x : JSON.stringify(x))).join(" "));
export const short = (hex: string): string => hex.slice(0, 12);
