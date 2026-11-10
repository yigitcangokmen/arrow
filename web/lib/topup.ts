const STEP = 500_000n; // 0.50 USDC
/** 1Click may deliver up to 0.5 % less than it was sent (50 bps slippage) and takes a small fee; the suggestion covers 1 %. */
const GROSS_UP_NUM = 100n;
const GROSS_UP_DEN = 99n;

/** How much to suggest adding: what is missing plus the swap's loss, rounded up to 0.50 USDC, at least 0.50. */
export function suggestTopUp(needed: bigint, balance: bigint): bigint {
  const missing = needed > balance ? needed - balance : 0n;
  const withLoss = (missing * GROSS_UP_NUM + GROSS_UP_DEN - 1n) / GROSS_UP_DEN;
  const rounded = ((withLoss + STEP - 1n) / STEP) * STEP;
  return rounded < STEP ? STEP : rounded;
}

/** The sentence for a failed Base transfer; a wallet with USDC but no ETH on Base gets told what is missing. */
export function topUpErrorMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : "";
  if (/rejected|denied/i.test(msg)) return "You rejected the request in your wallet.";
  if (/insufficient funds|exceeds the balance|gas required exceeds|not enough (eth|funds for gas)/i.test(msg)) {
    return "Your wallet has no ETH on Base to pay the network fee. Add a little ETH on Base (about $0.01) and try again.";
  }
  return msg ? `${fallback} (${msg.slice(0, 160)})` : fallback;
}
