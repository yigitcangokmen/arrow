// Pure logic of /seller: address and amount checks, which listings are mine.
import { parseUsdc } from "@arrow/sdk/usdc";
import type { ListingView } from "./server/listingsCache.ts";

export class WithdrawInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawInputError";
  }
}

/** A Solana address is base58 (no 0, O, I, l) and 32 to 44 characters long. */
export const isSolanaAddress = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Validated withdrawal in USDC base units. The amount must be positive and at most the Intents balance. */
export function parseWithdrawal(p: { solana: string; amount: string; balance: bigint }): { solana: string; units: bigint } {
  const solana = p.solana.trim();
  if (!isSolanaAddress(solana)) throw new WithdrawInputError("That is not a Solana address (base58, 32 to 44 characters).");
  let units: bigint;
  try {
    units = parseUsdc(p.amount.trim());
  } catch {
    throw new WithdrawInputError("Enter a USDC amount with up to 6 decimals, for example 2.50.");
  }
  if (units <= 0n) throw new WithdrawInputError("The amount must be more than zero.");
  if (units > p.balance) throw new WithdrawInputError("That is more than your NEAR Intents balance.");
  return { solana, units };
}

/** Listings whose seller is this Intents account (the lowercase 0x address). */
export const listingsOf = (all: readonly ListingView[], intentsId: string): ListingView[] =>
  all.filter((l) => l.seller.toLowerCase() === intentsId.toLowerCase());

/** True when a quote error looks like a missing Solana token account (research D-10): the user must receive any USDC once. */
export const looksLikeMissingTokenAccount = (message: string): boolean => /token account|\bata\b|associated|account.*(not found|does not exist|rent)/i.test(message);
