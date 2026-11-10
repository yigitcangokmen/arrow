import { formatBits as sdkFormatBits } from "@arrow/sdk/bits";
import type { Mode, State } from "@arrow/sdk/state";
import { formatUsdc as sdkFormatUsdc } from "@arrow/sdk/usdc";

/** DEC K-05: the only refund sentence in the UI. Returning to a Base wallet is a separate 1Click withdrawal. */
export const REFUND_LINE = "Refunded to your NEAR Intents balance.";

/** Milli-bits to text, at most 2 decimals, trailing zeros dropped: 5673 -> "5.67", 283650 -> "283.65". */
export function formatBits(milli: number): string {
  return sdkFormatBits(milli).replace(/\.?0+$/, "");
}

/** Base units (a decimal string) to USDC text without floats: "250000" -> "0.25". */
export function formatUsdc(base: string): string {
  return sdkFormatUsdc(BigInt(base));
}

/** "PASS · fit 4 · novelty 1"; verdict mode has no scores; a missing novelty reads "n/a" (DEC I-16). */
export function stateLine(s: State, mode: Mode): string {
  if (mode === "verdict") return s.verdict;
  return `${s.verdict} · fit ${s.fit ?? "n/a"} · novelty ${s.novelty ?? "n/a"}`;
}
