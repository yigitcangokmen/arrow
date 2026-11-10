// Viewing key (DEC J-05, J-06): the buyer's decrypt key is derived from a wallet signature, so no key is stored.
// EOA only: the signature must be a plain 65-byte ECDSA one (EIP-1271 smart wallets are not supported).
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, publicKeyHex, SECP256K1_N } from "./crypto.ts";

export const DEMO_LABEL = "arrow:demo-buyer:public:v1";

export interface ViewingKey {
  scalarHex: string;
  buyerPk: string; // 04... uncompressed, 130 hex: what goes into msg.buyer_pk
}

/** The domain is part of the signed text; the site domain freezes on 2026-11-13 12:00 GMT+7 (DEC D-12). */
export function viewingKeyMessage(domain: string): string {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(domain)) throw new Error(`invalid domain "${domain}"`);
  return `Arrow viewing key v1\nDomain: ${domain}\nOnly sign this on ${domain}. Anyone with this signature can decrypt your Arrow purchases.`;
}

const toScalar = (d: Uint8Array): bigint => BigInt("0x" + bytesToHex(d)) % SECP256K1_N;

/** digest mod n as 32 bytes; a zero result is re-hashed with keccak256 once, a second zero is an error. */
export function reduceToScalar(digest32: Uint8Array): Uint8Array {
  let x = toScalar(digest32);
  if (x === 0n) x = toScalar(keccak_256(digest32));
  if (x === 0n) throw new Error("viewing key digest reduced to zero twice");
  return hexToBytes(x.toString(16).padStart(64, "0"));
}

function fromScalar(scalar: Uint8Array): ViewingKey {
  const scalarHex = bytesToHex(scalar);
  return { scalarHex, buyerPk: publicKeyHex(scalarHex) };
}

/**
 * CRY-3: one ECDSA signature has several byte encodings (v as 0/1 or 27/28, s or n-s), and wallets differ. The canonical
 * form is low s with v = 27 + parity, which is what viem and most wallets already return, so keys derived before stay equal.
 */
export function canonicalSignature(sig: Uint8Array): Uint8Array {
  if (sig.length !== 65) throw new Error("EOA signature required (EIP-1271 not supported)");
  const v = sig[64];
  let parity: number;
  if (v === 0 || v === 1) parity = v;
  else if (v === 27 || v === 28) parity = v - 27;
  else throw new Error(`unsupported signature v byte ${v}`);
  let s = BigInt("0x" + bytesToHex(sig.subarray(32, 64)));
  if (s > SECP256K1_N >> 1n) {
    s = SECP256K1_N - s;
    parity ^= 1;
  }
  const out = new Uint8Array(65);
  out.set(sig.subarray(0, 32), 0);
  out.set(hexToBytes(s.toString(16).padStart(64, "0")), 32);
  out[64] = 27 + parity;
  return out;
}

/** keccak256 over the 65 canonical signature bytes (not over the hex string), reduced mod n. */
export function viewingKeyFromSignature(sigHex: `0x${string}`): ViewingKey {
  return fromScalar(reduceToScalar(keccak_256(canonicalSignature(hexToBytes(sigHex.slice(2))))));
}

/**
 * `twice`: ask for the signature a second time and refuse when the two differ (X12-7: a threshold/MPC signer gives a new
 * valid signature each time, so a key derived from it could never be derived again to open a purchase).
 */
export async function deriveViewingKeyEoa(
  account: { signMessage(a: { message: string }): Promise<`0x${string}`> },
  domain: string,
  o: { twice?: boolean } = {},
): Promise<ViewingKey> {
  const message = viewingKeyMessage(domain);
  const key = viewingKeyFromSignature(await account.signMessage({ message }));
  if (o.twice && viewingKeyFromSignature(await account.signMessage({ message })).scalarHex !== key.scalarHex) {
    throw new Error("this wallet gives a different signature each time, so its viewing key cannot be derived again later: use a standard EOA wallet");
  }
  return key;
}

/** The deliberately public demo buyer key (DEC J-06): it holds no funds and only decrypts demo purchases. */
export function demoViewingKey(): ViewingKey {
  return fromScalar(reduceToScalar(keccak_256(new TextEncoder().encode(DEMO_LABEL))));
}

export function siteDomain(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): string {
  const d = env.NEXT_PUBLIC_SITE_DOMAIN;
  if (!d) throw new Error("set NEXT_PUBLIC_SITE_DOMAIN (DEC D-12) before deriving a mainnet viewing key");
  return d;
}
