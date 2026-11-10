// File encryption (XChaCha20-Poly1305), key sealing (ECIES, eciesjs default profile) and encodings.
// Byte layouts are shared with the enclave through fixtures/{ecies,xchacha}-vectors.json.
// ECIES_CONFIG is global and mutable: never change it, the Rust match depends on the defaults.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { decrypt, encrypt, PrivateKey } from "eciesjs";
import { isAccountId } from "./schemas.ts";

export { bytesToHex, hexToBytes };

const NONCE_LEN = 24;
const TAG_LEN = 16;
export const ECIES_OVERHEAD = 97; // ephemeral pk 65 + nonce 16 + tag 16
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export const sha256Hex = (b: Uint8Array): string => bytesToHex(sha256(b));

/** nonce(24) || ciphertext || tag(16). A fresh random key and nonce unless given (nonce only for fixed vectors). */
export function encryptFile(plain: Uint8Array, key: Uint8Array = randomBytes(32), nonce: Uint8Array = randomBytes(NONCE_LEN)) {
  const ct = xchacha20poly1305(key, nonce).encrypt(plain);
  const blob = new Uint8Array(NONCE_LEN + ct.length);
  blob.set(nonce, 0);
  blob.set(ct, NONCE_LEN);
  return { key, blob, blobSha256: sha256Hex(blob) };
}

export function decryptFile(blob: Uint8Array, key: Uint8Array): Uint8Array {
  if (blob.length < NONCE_LEN + TAG_LEN) throw new Error("blob too short");
  return xchacha20poly1305(key, blob.subarray(0, NONCE_LEN)).decrypt(blob.subarray(NONCE_LEN));
}

/** ECIES to a 65-byte uncompressed secp256k1 public key (130 hex). Output is 97 + data.length bytes. */
export function seal(pubHex130: string, data: Uint8Array): Uint8Array {
  if (!/^04[0-9a-f]{128}$/.test(pubHex130)) throw new Error("public key must be 130 lowercase hex starting with 04");
  return new Uint8Array(encrypt(pubHex130, data));
}

export function unseal(scalarHex: string, data: Uint8Array): Uint8Array {
  return new Uint8Array(decrypt(scalarHex, data));
}

/**
 * K || sha256(blob) || sha256(seller), 96 bytes: the payload sealed as sealed_k. The enclave checks the blob against
 * the hash and the listing's `seller` against the last 32 bytes, so a copied sealed_k does not open in another
 * account's listing. `seller` is the account the contract will see as `sender_id` (lowercase 0x on Intents).
 */
export function sealedKPayload(key32: Uint8Array, blobSha256Hex: string, seller: string): Uint8Array {
  if (key32.length !== 32) throw new Error("K must be 32 bytes");
  const sha = hexToBytes(blobSha256Hex);
  if (sha.length !== 32) throw new Error("blob_sha256 must be 32 bytes");
  if (!isAccountId(seller)) throw new Error("seller must be the exact account id (lowercase 0x address or NEAR account)");
  const out = new Uint8Array(96);
  out.set(key32, 0);
  out.set(sha, 32);
  out.set(sha256(new TextEncoder().encode(seller)), 64);
  return out;
}

/** sha256(buyer_pk 65 bytes || listing_id u64 big-endian): the first 32 bytes of the sealed criteria plaintext. */
export function criteriaBind(buyerPkHex130: string, listingId: number): Uint8Array {
  if (!/^04[0-9a-f]{128}$/.test(buyerPkHex130)) throw new Error("buyer_pk must be 130 lowercase hex starting with 04");
  if (!Number.isSafeInteger(listingId) || listingId < 0) throw new Error("listing_id must be a non-negative integer");
  const pre = new Uint8Array(73);
  pre.set(hexToBytes(buyerPkHex130), 0);
  new DataView(pre.buffer).setBigUint64(65, BigInt(listingId), false);
  return sha256(pre);
}

/** Standard alphabet with padding (RFC 4648 section 4), the same as Rust base64::STANDARD. */
export const b64 = {
  enc(u8: Uint8Array): string {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s: string): Uint8Array {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error("not standard base64");
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  },
};

/** 04... uncompressed public key (130 hex) of a secp256k1 scalar. PublicKey.toHex() defaults to compressed, so false is explicit. */
export function publicKeyHex(scalarHex: string): string {
  return new PrivateKey(hexToBytes(scalarHex)).publicKey.toHex(false);
}

/** keccak256(input) read as a secp256k1 scalar: reduced mod n, re-hashed if that gives 0. Returns 64 lowercase hex. */
export function keccakScalarHex(input: Uint8Array): string {
  let h = keccak_256(input);
  let k = BigInt("0x" + bytesToHex(h)) % SECP256K1_N;
  while (k === 0n) {
    h = keccak_256(h);
    k = BigInt("0x" + bytesToHex(h)) % SECP256K1_N;
  }
  return k.toString(16).padStart(64, "0");
}

/** Deterministic test scalar from a public label (DEC D4-18): keccak256(utf8(label)) mod n. */
export const scalarFromLabel = (label: string): string => keccakScalarHex(new TextEncoder().encode(label));
