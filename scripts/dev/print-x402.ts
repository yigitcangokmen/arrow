// Prints the 402 body for listing 7 on mainnet (input for x402-compat.mjs). Dev helper, not shipped.
import { buildPaymentRequired } from "@arrow/sdk";

const { body } = buildPaymentRequired({
  network: "mainnet", contractId: "arrow-market.near", listingId: "7", leakBudgetLeftBits: 266.631, origin: "https://arrow-market.vercel.app",
});
console.log(JSON.stringify(body, null, 2));
