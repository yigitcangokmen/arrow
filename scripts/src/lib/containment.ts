// Containment estimators for tuning and testing the demo data (WS6-T01). Pre-check only: the enclave logic is
// enclave/arrow-core (novelty.rs, minhash.rs) and its Rust test demo_bands.rs is the real proof.
// A = the seller's distinct keys, B = the buyer's list. Containment C_A = |A ∩ B| / |A|.
import { keyToU64, loadParams, MERSENNE_61, signature } from "@arrow/sdk";

const K = 128;
const U64_MAX = (1n << 64n) - 1n;

export const distinct = (keys: Iterable<string>): Set<bigint> => new Set([...keys].map(keyToU64));

/** Estimator 1: exact set ratio |A ∩ B| / |A|. */
export function exactContainment(a: Iterable<string>, b: Iterable<string>): number {
  const xa = distinct(a), xb = distinct(b);
  let inter = 0;
  for (const x of xa) if (xb.has(x)) inter++;
  return inter / xa.size;
}

export interface Counts { j: number; c: number; nA: number; sumM: bigint }

/** The same counters as arrow_core::minhash::counts: j (min-hash matches), c (buyer min-hash values some seller key reproduces). */
export function counts(a: Iterable<string>, buyerSig: bigint[]): Counts {
  const p = loadParams();
  const xs = [...distinct(a)];
  const minA = signature(a);
  const hit = new Array<boolean>(K).fill(false);
  for (const x of xs) for (let i = 0; i < K; i++) if ((p.a[i]! * x + p.b[i]!) % p.prime === buyerSig[i]) hit[i] = true;
  return {
    j: minA.filter((v, i) => v === buyerSig[i]).length,
    c: hit.filter(Boolean).length,
    nA: xs.length,
    sumM: buyerSig.reduce((s, v) => s + v, 0n),
  };
}

/** Estimator 2: "does the buyer's min-hash value exist in the seller set" = c / 128 (estimates |A ∩ B| / |B|; equals C_A when |A| = |B|). */
export const estimateByHits = (n: Counts): number => n.c / K;

/** Estimator 3: Jaccard (j / 128) times sizes: |A ∩ B| = J (|A| + |B|) / (1 + J), with |B| taken equal to |A|. */
export function estimateJaccardTimesSize(n: Counts): number {
  const J = n.j / K;
  return (J * 2) / (1 + J);
}

const BANDS: [bigint, number][] = [[80n, 1], [60n, 2], [40n, 3], [20n, 4]];
const band = (num: bigint, den: bigint): number => {
  if (den === 0n) return 1;
  const x = num * 100n;
  return BANDS.find(([p]) => x >= den * p)?.[1] ?? 5;
};

/** Mirror of arrow_core::novelty::novelty for a buyer who sent a signature and the key column exists. */
export function noveltyBand(n: Counts): number {
  if (n.nA === 0) return 1;
  if (n.c === 0) return 5;
  const k = BigInt(K), j = BigInt(n.j), c = BigInt(n.c);
  if (n.c >= 64) {
    const jc = j * c;
    const d = c * (k + j) - k * j;
    return d <= jc ? 1 : band(jc, d);
  }
  const num = c * (k * MERSENNE_61 - n.sumM);
  const den = k * n.sumM * BigInt(n.nA);
  return band(num, den);
}

export { U64_MAX };
