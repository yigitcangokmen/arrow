// WS4-T07 acceptance: the x402-shaped 402 response (DEC M-04, M-05).
import { describe, expect, it } from "vitest";
import { buildPaymentRequired } from "../src/index.ts";

const base = { network: "mainnet" as const, contractId: "arrow-market.near", listingId: "7", leakBudgetLeftBits: 266.631, origin: "https://arrow-market.vercel.app" };

describe("buildPaymentRequired", () => {
  it("x402_body_snapshot", () => {
    const { body } = buildPaymentRequired(base);
    expect(body).toEqual({
      x402Version: 2,
      error: "inspect before you pay",
      resource: {
        url: "https://arrow-market.vercel.app/l/7/data",
        description: "Arrow listing arrow-market.near/7",
        mimeType: "application/octet-stream",
      },
      accepts: [],
      extensions: {
        "arrow-inspect": {
          info: {
            listing: "arrow-market.near/7",
            inspect: "npm run arrow -- eval 7 --criteria <file> --network mainnet",
            mcp_tool: "inspect_before_buy",
            leak_budget_left_bits: 266.631,
            pay_via: "NEAR Intents (mt_on_transfer)",
          },
          schema: {
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
          },
        },
      },
    });
  });

  it("x402_status_and_listing_header", () => {
    const m = buildPaymentRequired(base);
    expect(m.status).toBe(402);
    expect(m.headers["X-Arrow-Listing"]).toBe("arrow-market.near/7");
    const t = buildPaymentRequired({ ...base, network: "testnet", contractId: "arrow.arrowhq.testnet" });
    expect(t.headers["X-Arrow-Listing"]).toBe("arrow.arrowhq.testnet/7");
    expect((t.body.extensions as any)["arrow-inspect"].info.inspect).toContain("--network testnet");
    expect(m.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Arrow-Listing",
    });
  });

  it("x402_no_payment_required_header", () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const keys = Object.keys(buildPaymentRequired({ ...base, network }).headers).map((k) => k.toLowerCase());
      expect(keys).not.toContain("payment-required");
    }
  });

  it("x402_extension_info_schema_shape", () => {
    const { body } = buildPaymentRequired(base) as any;
    expect(Object.keys(body.extensions)).toEqual(["arrow-inspect"]);
    expect(Object.keys(body.extensions["arrow-inspect"]).sort()).toEqual(["info", "schema"]);
    expect(body.resource.url.endsWith("/l/7/data")).toBe(true);
    expect(body.accepts).toEqual([]);
    expect(buildPaymentRequired({ ...base, origin: "https://x.app/" }).body.resource).toMatchObject({ url: "https://x.app/l/7/data" });
  });

  it("x402_forbidden_words", () => {
    const text = JSON.stringify(buildPaymentRequired(base));
    for (const re of [/x402 extension/i, /x402[- ]compatible/i, /\bstandard\b/i, /x402 payment/i, /npx arrow/i, /\bfirst\b/i, /trustless/i]) {
      expect(text, String(re)).not.toMatch(re);
    }
    expect(text).toContain("npm run arrow");
  });
});
