// Leak and closure metrics (WS6-T05, DEC N-01 (a)-(e)). Pure functions: no I/O, no network, seeded randomness only.
import { rngFor } from "./gen/prng.ts";

/** (a) Verbatim leakage: cells (>= 20 chars) that share a 20-character window with the output, plus canary hits. */
export function verbatimHits(output: string, cells: readonly string[], canaries: readonly string[]): { substring20: number; canary: number } {
  let substring20 = 0;
  for (const cell of new Set(cells)) {
    const chars = [...cell];
    if (chars.length < 20) continue;
    for (let i = 0; i + 20 <= chars.length; i++) {
      if (output.includes(chars.slice(i, i + 20).join(""))) { substring20++; break; }
    }
  }
  return { substring20, canary: canaries.filter((c) => output.includes(c)).length };
}

const h2 = (p: number) => (p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)));

/** Wilson score interval, 95%. */
export function wilson(k: number, n: number, z = 1.959963984540054): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

/** (b) Targeted bit: p = share of decoded bits equal to the truth; bits = 1 - H2(max(p, 1-p)). A constant wrong answer is as informative as a right one. */
export function targetedInfo(samples: readonly { truth: boolean; decoded: boolean }[]): { n: number; correct: number; p: number; bits: number; ci95: [number, number]; bits_ci95: [number, number] } {
  const n = samples.length;
  const correct = samples.filter((s) => s.truth === s.decoded).length;
  const p = n === 0 ? 0 : correct / n;
  const bitsAt = (q: number) => 1 - h2(Math.max(q, 1 - q));
  const [lo, hi] = wilson(correct, n);
  // the information is smallest where the interval comes closest to 0.5
  const near = lo <= 0.5 && hi >= 0.5 ? 0.5 : Math.abs(lo - 0.5) < Math.abs(hi - 0.5) ? lo : hi;
  return { n, correct, p, bits: n === 0 ? 0 : bitsAt(p), ci95: [lo, hi], bits_ci95: [n === 0 ? 0 : bitsAt(near), n === 0 ? 0 : Math.max(bitsAt(lo), bitsAt(hi))] };
}

/** (c) Shannon entropy in bits of the empirical distribution of output states. */
export function outputEntropy(states: readonly (number | string)[]): number {
  const n = states.length;
  if (n === 0) return 0;
  const c = new Map<number | string, number>();
  for (const s of states) c.set(s, (c.get(s) ?? 0) + 1);
  let h = 0;
  for (const v of c.values()) h -= (v / n) * Math.log2(v / n);
  return h;
}

function plugInMi(x: readonly number[], y: readonly number[], kx: number, ky: number): number {
  const n = x.length;
  const joint = new Array<number>(kx * ky).fill(0), px = new Array<number>(kx).fill(0), py = new Array<number>(ky).fill(0);
  for (let i = 0; i < n; i++) { joint[x[i]! * ky + y[i]!]!++; px[x[i]!]!++; py[y[i]!]!++; }
  let mi = 0;
  for (let a = 0; a < kx; a++) for (let b = 0; b < ky; b++) {
    const j = joint[a * ky + b]!;
    if (j > 0) mi += (j / n) * Math.log2((j * n) / (px[a]! * py[b]!));
  }
  return mi;
}

/** Equal-count bins by rank (ties share the lower bin), so bins stay balanced for skewed timings. */
export function quantileBins(values: readonly number[], bins: number): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(values.length).fill(0);
  let prev = NaN, prevBin = 0;
  order.forEach(([v, i], rank) => {
    const bin = v === prev ? prevBin : Math.min(bins - 1, Math.floor((rank * bins) / values.length));
    out[i] = bin; prev = v; prevBin = bin;
  });
  return out;
}

/**
 * (d) Mutual information between a measured quantity xs (time_ms, instructions) and the target bit.
 * Plug-in estimate in bits, Miller-Madow correction (-(kx-1)(ky-1) / (2 n ln 2)) and a permutation p value
 * (the bit labels are shuffled `permutations` times with a seeded PRNG).
 */
export function mutualInfo(xs: readonly number[], bits: readonly boolean[], o: { bins: 2 | 4; permutations: number; seed: string }) {
  const n = xs.length;
  if (n !== bits.length) throw new Error("xs and bits must have the same length");
  const x = quantileBins(xs, o.bins);
  const y = bits.map((b) => (b ? 1 : 0));
  const kx = new Set(x).size, ky = new Set(y).size;
  const mi = n === 0 ? 0 : plugInMi(x, y, o.bins, 2);
  const mm = n === 0 ? 0 : Math.max(0, mi - ((kx - 1) * (ky - 1)) / (2 * n * Math.LN2));
  const rng = rngFor(o.seed);
  let ge = 0;
  const shuffled = [...y];
  for (let t = 0; t < o.permutations; t++) {
    rng.shuffle(shuffled);
    if (plugInMi(x, shuffled, o.bins, 2) >= mi - 1e-12) ge++;
  }
  return { n, mi, mi_miller_madow: mm, p_value: (1 + ge) / (1 + o.permutations) };
}

export type ClosureInput = { idx: number | null; mode: "scored" | "verdict"; output_bytes: number | null; decoded_len?: number | null; status?: string };

/** (e) Closure: every returned result is one of the 50 scored states (or 2 verdict states), one byte, and the output stays within 900 bytes. */
export function closure(evals: readonly ClosureInput[]): { n: number; violations: { index: number; why: string }[]; refunds: number } {
  const violations: { index: number; why: string }[] = [];
  let refunds = 0;
  evals.forEach((e, index) => {
    if (e.status === "refunded" || e.idx === null) refunds++;
    if (e.idx !== null) {
      const max = e.mode === "verdict" ? 1 : 49;
      if (!Number.isInteger(e.idx) || e.idx < 0 || e.idx > max) violations.push({ index, why: `idx ${e.idx} outside 0..${max}` });
    }
    if (e.decoded_len !== undefined && e.decoded_len !== null && e.decoded_len !== 1) violations.push({ index, why: `decoded result is ${e.decoded_len} bytes, not 1` });
    if (e.output_bytes !== null && e.output_bytes > 900) violations.push({ index, why: `output ${e.output_bytes} bytes > 900` });
  });
  return { n: evals.length, violations, refunds };
}

/** Fixed-decimal formatting so reports are byte-stable. */
export const fx = (x: number, d = 3): string => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);
export const pct = (k: number, n: number): string => (n === 0 ? "n/a" : `${((100 * k) / n).toFixed(1)}%`);
