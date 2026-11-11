// One place that turns thrown errors from the wallet, the relay and the contract into a sentence for the user.
// Matches on `name` so it works across module copies and in tests without importing the heavy sdk modules.

export interface Described {
  message: string;
  /** What the user can do instead (the API's `fallback`, or a stock hint). */
  fallback?: string;
}

const hasName = (e: unknown, n: string): e is Error => e instanceof Error && e.name === n;
const code = (e: unknown): number | undefined => {
  const o = e as { code?: number; cause?: { code?: number } } | null;
  return o?.code ?? o?.cause?.code;
};

export function describeError(e: unknown): Described {
  const text = e instanceof Error ? e.message : String(e);
  if (code(e) === 4001 || hasName(e, "UserRejectedRequestError") || /user (rejected|denied)|rejected the request/i.test(text)) {
    return { message: "You rejected the request in your wallet. Nothing was sent." };
  }
  if (hasName(e, "NoWalletError")) return { message: text };
  if (hasName(e, "RelayRateLimited")) {
    // EVAL_DAILY_CAP counts this wallet's day and EVAL_RATE_LIMITED all wallets: the relay's own text says which, not "this network".
    if ((e as unknown as { code?: string }).code !== "RATE_LIMITED") return { message: text.slice(0, 240) };
    const s = (e as unknown as { retryAfter: number | null }).retryAfter;
    return { message: `Too many requests from this network. Try again${s ? ` in ${s} s` : " in a minute"}.` };
  }
  if (hasName(e, "PaymentPending") || hasName(e, "PaymentUnclear")) return { message: text };
  if (hasName(e, "RelayUnavailable") && (e as unknown as { code?: string }).code === "RELAYER_BUSY") {
    return { message: text.slice(0, 240), fallback: (e as unknown as { fallback?: string }).fallback };
  }
  if (hasName(e, "RelayUnavailable")) {
    return { message: "The hosted relayer is not available right now.", fallback: (e as unknown as { fallback?: string }).fallback ?? "Try again in a few minutes." };
  }
  if (hasName(e, "SimulateFailed")) {
    const detail = (e as unknown as { detail?: string }).detail ?? "";
    return /balance|insufficient/i.test(detail + text)
      ? { message: "Your NEAR Intents balance is too low for this payment.", fallback: "Add USDC from Base, then try again." }
      : { message: `NEAR Intents rejected the signed intent${detail ? `: ${detail.slice(0, 200)}` : "."}` };
  }
  if (hasName(e, "RelayRejected")) {
    const code = (e as unknown as { code?: string }).code;
    if (code === "RELAY_UNCLEAR") return { message: "Your payment may or may not have gone through. Do not pay again: use Check payment." };
    if (code === "ALREADY_RELAYED") return { message: "This exact payment was already submitted. Do not pay again: use Check payment." };
    return { message: text.slice(0, 240) };
  }
  if (hasName(e, "PaymentRefused")) {
    if (/E21\b/.test(text)) return { message: "Five inspections are already running on this listing. Your payment was refunded to your NEAR Intents balance; try again in a minute." };
    if (/E22\b/.test(text)) return { message: "You already bought this listing with this viewing key. Open it under \"Your earlier payments on this listing\"." };
    if (/E23\b/.test(text)) return { message: "Only the seller of this listing can change where its file is hosted." };
    if (/E24\b/.test(text)) return { message: "Nothing is owed to that account." };
    return { message: `The market contract refused the payment: ${text.slice(0, 240)}` };
  }
  if (hasName(e, "NotEoaError")) return { message: text };
  if (hasName(e, "WithdrawPayloadError")) return { message: text };
  if (hasName(e, "SettleTimeout")) return { message: `${text}. It may still finish; check the transaction link.` };
  if (hasName(e, "SellInputError") || hasName(e, "BuyInputError")) return { message: text };
  if (hasName(e, "AbortError")) return { message: "Cancelled." };
  return { message: `Something went wrong: ${text.slice(0, 200)}` };
}
