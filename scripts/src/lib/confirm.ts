// Spend plan and confirmation for anything that moves value (DEC D4-19). Agents never pass --yes on mainnet.
import { createInterface } from "node:readline/promises";
import { log } from "./log.ts";

export const EXIT_NEEDS_CONFIRM = 5;

/** Prints the plan. Proceeds on --yes, asks y/N on a TTY, and exits 5 on a non-TTY without --yes. */
export async function confirmSpend(plan: string[], yes: boolean): Promise<void> {
  log("spend plan:");
  for (const line of plan) log(`  ${line}`);
  if (yes) return;
  if (!process.stdin.isTTY) {
    console.error("refusing to spend without a terminal: rerun in a terminal and answer y, or pass --yes (a human step on mainnet)");
    process.exit(EXIT_NEEDS_CONFIRM);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("proceed? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    log("aborted: nothing sent");
    process.exit(EXIT_NEEDS_CONFIRM);
  }
}
