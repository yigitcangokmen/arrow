// x402-shaped 402 response (DEC M-04, M-05). Single source: the web routes /api/x402/[id] and /l/[id]/data call this.
// There is no PAYMENT-REQUIRED header on purpose: @x402/core 2.30.0 rejects an empty `accepts` (V-13 failed), and
// `accepts` stays empty because payment goes through NEAR Intents, not an x402 facilitator.
import type { Network } from "./config.ts";

export interface PaymentRequired {
  status: 402;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const INFO_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["listing", "inspect", "mcp_tool", "pay_via"],
  properties: {
    listing: { type: "string", description: "contract/listing_id" },
    inspect: { type: "string", description: "command that returns a capped verdict before any purchase" },
    mcp_tool: { type: "string" },
    leak_budget_left_bits: { type: "number", description: "bits of verdict information this listing can still release" },
    pay_via: { type: "string" },
  },
};

export function buildPaymentRequired(p: {
  network: Network;
  contractId: string;
  listingId: string;
  leakBudgetLeftBits: number;
  origin: string;
}): PaymentRequired {
  const listing = `${p.contractId}/${p.listingId}`;
  return {
    status: 402,
    headers: {
      "X-Arrow-Listing": listing,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Arrow-Listing",
    },
    body: {
      x402Version: 2,
      error: "inspect before you pay",
      resource: {
        url: `${p.origin.replace(/\/+$/, "")}/l/${p.listingId}/data`,
        description: `Arrow listing ${listing}`,
        mimeType: "application/octet-stream",
      },
      accepts: [],
      extensions: {
        "arrow-inspect": {
          info: {
            listing,
            inspect: `npm run arrow -- eval ${p.listingId} --criteria <file> --network ${p.network}`,
            mcp_tool: "inspect_before_buy",
            leak_budget_left_bits: p.leakBudgetLeftBits,
            pay_via: "NEAR Intents (mt_on_transfer)",
          },
          schema: INFO_SCHEMA,
        },
      },
    },
  };
}
