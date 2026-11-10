import { USDC_DECIMALS } from "./config.ts";

const UNIT = 10n ** BigInt(USDC_DECIMALS);

/** "0.25" -> 250000n. String arithmetic only (DEC D4-10); more than 6 decimals, signs and exponents are rejected. */
export function parseUsdc(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`invalid USDC amount "${s}" (digits with up to ${USDC_DECIMALS} decimals)`);
  return BigInt(m[1]) * UNIT + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
}

/** 250000n -> "0.25", 1999596n -> "1.999596", 1000000n -> "1". */
export function formatUsdc(units: bigint): string {
  if (units < 0n) throw new Error("negative USDC amount");
  const frac = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${units / UNIT}.${frac}` : `${units / UNIT}`;
}
