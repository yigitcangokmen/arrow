// MinHash over normalized keys (DEC I-16, I-17). Binding definition: fixtures/README.md, "MinHash (binding)".
//   x = BE_u64(sha256(normalize(key))[0..8]);  h_i(x) = (a_i * x + b_i) mod p  in 128-bit math, x not reduced first;
//   signature_i = min over keys of h_i; written as 16 lowercase hex each; the empty set is ff..ff x 128.
import { sha256 } from "@noble/hashes/sha2.js";
import { MINHASH_PARAMS } from "./minhash-params.ts";

export const MINHASH_K = 128;
export const MERSENNE_61 = (1n << 61n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

export interface MinhashParams {
  k: number;
  prime: bigint;
  a: bigint[];
  b: bigint[];
}

/** Parameters embedded from fixtures/minhash-params.json (the single source; a test keeps them equal). */
export function loadParams(): MinhashParams {
  return { k: MINHASH_PARAMS.k, prime: BigInt(MINHASH_PARAMS.prime), a: MINHASH_PARAMS.a.map(BigInt), b: MINHASH_PARAMS.b.map(BigInt) };
}
const DEFAULT_PARAMS = loadParams();

/** Default_Ignorable_Code_Point, written out so TS and Rust agree without either side's Unicode tables. */
const DEFAULT_IGNORABLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFF8\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;

/** trim, NFKC, lowercase, Default_Ignorable characters deleted, the U+0307 right after an "i" deleted,
 * whitespace runs to a single space, trim. Invisible characters cannot make a known key look new. */
export function normalizeKey(s: string): string {
  return s.trim().normalize("NFKC").toLowerCase().replace(DEFAULT_IGNORABLE, "").replace(/i\u0307/g, "i").replace(/\s+/gu, " ").trim();
}

/** First 8 bytes of sha256(utf8(normalizeKey(s))), big-endian. */
export function keyToU64(s: string): bigint {
  const d = sha256(new TextEncoder().encode(normalizeKey(s)));
  let x = 0n;
  for (let i = 0; i < 8; i++) x = (x << 8n) | BigInt(d[i]);
  return x;
}

export const u64Hex = (x: bigint): string => x.toString(16).padStart(16, "0");

/** The empty key set gives ff..ff for every position (fixtures/README), not an error. */
export function signature(keys: Iterable<string>, params: MinhashParams = DEFAULT_PARAMS): bigint[] {
  const xs = new Set<bigint>();
  for (const key of keys) xs.add(keyToU64(key));
  const sig: bigint[] = new Array(params.k).fill(U64_MAX);
  for (const x of xs) {
    for (let i = 0; i < params.k; i++) {
      const h = (params.a[i] * x + params.b[i]) % params.prime;
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

/** One 2048-character lowercase hex string (128 values x 16 hex), the form criteria.minhash carries. */
export function signatureHex(sig: bigint[]): string {
  return sig.map(u64Hex).join("");
}

/** Fraction of equal positions: an unbiased estimate of the Jaccard similarity of the two key sets. */
export function estimateJaccard(a: bigint[], b: bigint[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error("signatures must have the same non-zero length");
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}
