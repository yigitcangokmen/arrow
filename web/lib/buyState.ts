// Pure decisions of /buy that the component only renders: what the buyer must hold, whether Buy exists, which warning it needs.
import type { State } from "@arrow/sdk/state";

/** USDC the buyer still needs on the Intents balance. The inspection fee is spent once the verdict is in. */
export function neededFor(p: { evalFee: bigint; price: bigint; mayBuy: boolean; verdictIn: boolean; exhausted: boolean; bought: boolean }): bigint {
  if (p.bought) return 0n;
  if (p.verdictIn || p.exhausted) return p.price;
  return p.evalFee + (p.mayBuy ? p.price : 0n);
}

/**
 * The Buy section needs a viewing key and nothing else about this tab's history: a buy-only listing (budget used up), a refunded
 * inspection and a reload all leave the contract willing to sell, so the page must be willing to ask.
 */
export function showBuy(s: { vk: boolean; bought: boolean; readOnly: boolean; wrongDomain: boolean; locked: boolean }): boolean {
  return s.vk && !s.bought && !s.readOnly && !s.wrongDomain && !s.locked;
}

export type BuyGate = "direct" | "pass" | "unverified";

/** BUY verdict: pay at once. PASS: ask. No verdict from this tab: ask, and say so. */
export function buyGate(verdict: Pick<State, "verdict"> | null): BuyGate {
  if (verdict === null) return "unverified";
  return verdict.verdict === "BUY" ? "direct" : "pass";
}

/** Inspect is possible again after a refund or a refusal, never after a verdict, never mid-flight. */
export function canInspectAgain(s: { busy: boolean; verdictIn: boolean }): boolean {
  return !s.busy && !s.verdictIn;
}

/** Why Inspect is off, in the order a buyer can act on them. Empty means it is on. */
export function whyNotInspect(s: {
  readOnly: boolean;
  programKeyMissing: boolean;
  wrongDomain: boolean;
  vk: boolean;
  lowBalance: boolean;
  exhausted: boolean;
  criteriaEmpty: boolean;
  busy: boolean;
  verdictIn: boolean;
  paymentPending: boolean;
  blockers: readonly string[];
}): string[] {
  const why: string[] = [];
  if (s.readOnly) why.push("This page is read-only on this network.");
  if (s.programKeyMissing) why.push("The enclave key is not published yet.");
  if (s.wrongDomain) why.push("Open Arrow on its own domain; viewing keys are bound to it.");
  if (!s.vk) why.push("Sign to derive your viewing key (step 1).");
  if (s.lowBalance) why.push("Your Intents balance is too low (step 2).");
  if (s.exhausted) why.push("The inspection budget is used up: you can only buy.");
  if (s.criteriaEmpty) why.push("Describe what you need in step 3 (required).");
  if (s.paymentPending) why.push("An earlier payment is not confirmed yet: check it first.");
  if (s.verdictIn) why.push("You already have a verdict for this listing from this page.");
  if (s.busy) why.push("Another step is running.");
  why.push(...s.blockers);
  return why;
}

export type Announce =
  | { kind: "verdict"; line: string }
  | { kind: "refunded" };

/** What the page's always-mounted live region says; empty while nothing new has happened. */
export function announceText(s: { waiting: "inspect" | "buy" | null; slow: boolean; outcome: Announce | null; purchaseRefund: boolean; saved: boolean; error: string | null }): string {
  if (s.error) return `That step did not finish: ${s.error}`;
  if (s.saved) return "The file is decrypted and ready to save.";
  if (s.purchaseRefund) return "The purchase failed on chain and was refunded to your NEAR Intents balance.";
  if (s.waiting) return s.slow ? "Still waiting for the enclave." : s.waiting === "inspect" ? "The enclave and NEAR AI are evaluating the listing. This takes 45 to 120 seconds." : "Waiting for the purchase key.";
  if (s.outcome?.kind === "verdict") return `Result: ${s.outcome.line}`;
  if (s.outcome?.kind === "refunded") return "The inspection failed on chain and was refunded to your NEAR Intents balance.";
  return "";
}
