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

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P = 2n ** 255n - 19n;
const modPow = (b: bigint, e: bigint, m: bigint): bigint => {
  let r = 1n;
  for (b %= m; e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m;
  return r;
};
const D = (((P - 121665n) % P) * modPow(121666n, P - 2n, P)) % P; // -121665 / 121666

/** The 32 bytes of a base58 address, or null when it does not decode to exactly 32 bytes. */
function base58To32(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const zeros = s.length - s.replace(/^1+/, "").length;
  const tail: number[] = [];
  for (; n > 0n; n >>= 8n) tail.unshift(Number(n & 0xffn));
  if (zeros + tail.length !== 32) return null;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...tail]);
}

/**
 * True when the address is a point on the ed25519 curve, i.e. a wallet key that can sign. A token account (an ATA or any
 * program-derived address) is off the curve: USDC sent there for a new owner could never be moved.
 */
export function isSolanaWallet(address: string): boolean {
  const b = base58To32(address);
  if (!b) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? b[i]! & 0x7f : b[i]!);
  const signBit = (b[31]! & 0x80) !== 0;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modPow(v, P - 2n, P)) % P;
  if (x2 === 0n) return !signBit;
  return modPow(x2, (P - 1n) / 2n, P) === 1n;
}

/** Validated withdrawal in USDC base units. The amount must be positive and at most the Intents balance. */
export function parseWithdrawal(p: { solana: string; amount: string; balance: bigint }): { solana: string; units: bigint } {
  const solana = p.solana.trim();
  if (!isSolanaAddress(solana)) throw new WithdrawInputError("That is not a Solana address (base58, 32 to 44 characters).");
  if (!isSolanaWallet(solana)) throw new WithdrawInputError("That looks like a token account or a program address, not a wallet. Use the address of your wallet: money sent to a token account cannot be moved again.");
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

/** True when a quote error looks like a missing Solana token account (research D-10). */
export const looksLikeMissingTokenAccount = (message: string): boolean => /token account|\bata\b|associated|account.*(not found|does not exist|rent)/i.test(message);
