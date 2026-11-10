// Leak-budget arithmetic (DEC A.1 G1): ceil(1000 * log2(states)) milli-bits per eval.
export const BITS_PER_EVAL_MILLI = { scored: 5673, verdict: 1585 } as const;

/** 5673 -> "5.67" (two decimals, integer rounding). */
export function formatBits(milli: number): string {
  const c = Math.floor((milli + 5) / 10);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** An "at most" bound must round up (NUM-2): 5673 -> "5.68" >= log2(51), 1585 -> "1.59" >= log2(3). */
export function formatBitsBound(milli: number): string {
  const c = Math.ceil(milli / 10);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

export function budgetLine(lb: { bits_per_eval_milli: number; budget_milli: number }): string {
  return `out: ${formatBits(lb.bits_per_eval_milli)} bits / budget ${formatBits(lb.budget_milli)} bits`;
}
