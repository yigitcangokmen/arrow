// Output state index (DEC I-08, fixtures/state-index-vectors.json).
export type Mode = "verdict" | "scored";
export type Verdict = "BUY" | "PASS";
export interface State {
  verdict: Verdict;
  fit?: number;
  novelty?: number;
}

/** Guard trips map to PASS fit 1 novelty 1, which is index 0 in both modes. */
export const GUARD_TRIPPED_INDEX = 0;

const inRange = (n: number | undefined): n is number => Number.isInteger(n) && n! >= 1 && n! <= 5;

/** scored: idx = (BUY ? 25 : 0) + (fit - 1) * 5 + (novelty - 1), 0..49. verdict: 0 = PASS, 1 = BUY. */
export function encodeState(s: State, mode: Mode): number {
  if (mode === "verdict") return s.verdict === "BUY" ? 1 : 0;
  if (!inRange(s.fit) || !inRange(s.novelty)) throw new Error("scored state needs fit and novelty in 1..5");
  return (s.verdict === "BUY" ? 25 : 0) + (s.fit - 1) * 5 + (s.novelty - 1);
}

export function decodeState(idx: number, mode: Mode): State {
  if (mode === "verdict") {
    if (idx !== 0 && idx !== 1) throw new Error(`verdict state index out of range: ${idx}`);
    return { verdict: idx === 1 ? "BUY" : "PASS" };
  }
  if (!Number.isInteger(idx) || idx < 0 || idx > 49) throw new Error(`scored state index out of range: ${idx}`);
  const base = idx % 25;
  return { verdict: idx >= 25 ? "BUY" : "PASS", fit: Math.floor(base / 5) + 1, novelty: (base % 5) + 1 };
}
