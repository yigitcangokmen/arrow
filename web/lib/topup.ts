const STEP = 500_000n; // 0.50 USDC

/** How much to suggest adding: what is missing, rounded up to 0.50 USDC, at least 0.50. */
export function suggestTopUp(needed: bigint, balance: bigint): bigint {
  const missing = needed > balance ? needed - balance : 0n;
  const rounded = ((missing + STEP - 1n) / STEP) * STEP;
  return rounded < STEP ? STEP : rounded;
}
