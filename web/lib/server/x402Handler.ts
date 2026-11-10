import { ArrowViews } from "@arrow/sdk/contract";
import { RpcError } from "@arrow/sdk/rpc";
import type { Listing } from "@arrow/sdk/schemas";
import { buildPaymentRequired } from "@arrow/sdk/x402";
import { CONTRACTS, DEFAULT_NETWORK, SITE_DOMAIN, type Network } from "../config.ts";
import { clientIp } from "../ip.ts";
import { type Limiter, limits } from "../ratelimit.ts";
import { apiError, rateLimited } from "./http.ts";

export interface X402Deps {
  limiter: Limiter;
  listing(net: Network, id: string): Promise<Listing | null>;
}

export const realX402Deps: X402Deps = {
  limiter: limits.x402,
  listing: (net, id) => new ArrowViews(net, CONTRACTS[net]).listing(id),
};

const originOf = (req: Request) => (SITE_DOMAIN ? `https://${SITE_DOMAIN}` : new URL(req.url).origin);

/** GET and HEAD. The status, headers and body all come from the sdk builder; this route adds nothing (DEC M-04). */
export async function handleX402(req: Request, id: string, d: X402Deps = realX402Deps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "BAD_ID", "listing id must be a number");

  const netParam = new URL(req.url).searchParams.get("network");
  if (netParam !== null && netParam !== "mainnet" && netParam !== "testnet") return apiError(400, "BAD_REQUEST", "network must be mainnet or testnet");
  const network: Network = (netParam as Network | null) ?? DEFAULT_NETWORK;

  let listing: Listing | null;
  try {
    listing = await d.listing(network, id);
  } catch (e) {
    // a market contract that is not deployed on this network has no listings, so the listing is "not found"
    if (e instanceof RpcError && /CodeDoesNotExist|UNKNOWN_ACCOUNT|does not exist/.test(e.message)) {
      return apiError(404, "LISTING_NOT_FOUND", `no listing ${id} on ${network}: the market contract is not deployed there`);
    }
    return apiError(502, "RPC_ERROR", "Could not read the listing from NEAR RPC.", { detail: e instanceof RpcError ? e.message.slice(0, 300) : undefined });
  }
  if (!listing) return apiError(404, "LISTING_NOT_FOUND", `no listing ${id} on ${network}`);

  const leftMilli = Math.max(0, listing.max_evals - listing.evals_used) * listing.bits_per_eval_milli;
  const pr = buildPaymentRequired({
    network,
    contractId: CONTRACTS[network],
    listingId: id,
    leakBudgetLeftBits: leftMilli / 1000,
    origin: originOf(req),
  });
  return new Response(req.method === "HEAD" ? null : JSON.stringify(pr.body), { status: pr.status, headers: pr.headers });
}
