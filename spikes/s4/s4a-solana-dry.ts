// S4-a (outbound half): a dry quote of the seller's Intents USDC -> Solana USDC (DEC K-02, H-04). Free: dry:true creates no deposit.
// Needs SOLANA_PAYOUT_ADDRESS in .env (an address, never a key) and the seller EOA address. The result file never holds the address.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { oneclick, formatUsdc, parseUsdc } from "@arrow/sdk";
import { loadEnv } from "../../scripts/src/lib/env.ts";
import { log } from "../../scripts/src/lib/log.ts";

loadEnv();
const { values } = parseArgs({
  options: {
    amount: { type: "string", default: "3" },
    solana: { type: "string" },
    seller: { type: "string" },
    out: { type: "string", default: resolve(dirname(fileURLToPath(import.meta.url)), "s4a-solana-dry.json") },
  },
});

const solana = values.solana || process.env.SOLANA_PAYOUT_ADDRESS;
if (!solana) {
  console.error("SOLANA_PAYOUT_ADDRESS is empty in .env: waiting for H-04 (a Phantom address, never a key). Pass --solana <address> for a throwaway check.");
  process.exit(2);
}
if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solana)) throw new Error("SOLANA_PAYOUT_ADDRESS is not a base58 Solana address");

const sellerKey = process.env.E2E_SELLER_EVM_PRIVATE_KEY;
const seller = (values.seller || (sellerKey ? privateKeyToAccount(sellerKey as `0x${string}`).address : "")) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(seller)) throw new Error("no seller address: set E2E_SELLER_EVM_PRIVATE_KEY (new-evm-wallet.ts --role seller) or pass --seller 0x...");

const amount = parseUsdc(values.amount!);
const res = await oneclick.quote(oneclick.outboundQuoteRequest({ amount: amount.toString(), sellerEvm: seller, solana, dry: true }));
const q = res.quote;
const ataProblem = /\b(ata|associated token|token account)\b/i.test(JSON.stringify(q));

log(`dry quote 200 · amountIn ${formatUsdc(amount)} · amountOut ${q.amountOutFormatted} (${q.amountOut}) · withdrawFee ${q.withdrawFee ?? "n/a"} · timeEstimate ${q.timeEstimate} s`);
log(ataProblem ? "ATA/account warning present in the response: check the Solana USDC token account (DEC D-10 fallback)" : "no ATA error");

writeFileSync(
  values.out!,
  JSON.stringify(
    {
      timestamp_utc: new Date().toISOString(),
      amount_in: amount.toString(),
      amount_out: q.amountOut,
      amount_out_formatted: q.amountOutFormatted,
      withdraw_fee: q.withdrawFee ?? null,
      time_estimate_s: q.timeEstimate,
      ata_warning: ataProblem,
      note: "dry:true quote; destination and seller addresses are not stored",
    },
    null,
    2,
  ) + "\n",
);
log(`wrote ${values.out}`);
process.exit(ataProblem ? 1 : 0);
