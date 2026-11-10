// MCP server "arrow" over stdio (WS4-T12): inspect_before_buy, buy, get_listing, list_listings.
// stdout carries JSON-RPC and nothing else; every log line goes to stderr. Spend guard (DEC D4-17):
//   testnet by default; mainnet inspect/buy need ARROW_MCP_ALLOW_MAINNET=1; each call is capped by ARROW_MCP_MAX_USDC (default 1.00);
//   buy needs confirm: true.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatUsdc, type Network, parseUsdc } from "@arrow/sdk";
import { loadEnv } from "../../scripts/src/lib/env.ts";
import { mask } from "../../scripts/src/lib/log.ts";
import { buildCtx } from "./cli.ts";
import { buyCommand, CliError, type Ctx, evalCommand, listingSummary, statusCommand } from "./commands.ts";
import { SettleTimeout } from "./settle.ts";

const NETWORK = z.enum(["testnet", "mainnet"]).optional().describe("testnet (default) or mainnet; mainnet is disabled unless the operator set ARROW_MCP_ALLOW_MAINNET=1");

export interface McpDeps {
  env?: Record<string, string | undefined>;
  /** Builds the command context for a network; tests and the real server both use the CLI's. */
  ctx?: (network: Network) => Ctx;
}

class GuardError extends Error {}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: mask(typeof v === "string" ? v : JSON.stringify(v)) }] });
const fail = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: mask(message) }] });

export function createServer(deps: McpDeps = {}): McpServer {
  const env = deps.env ?? process.env;
  const defaultNetwork = (env.ARROW_NETWORK === "mainnet" ? "mainnet" : "testnet") as Network;
  const maxUsdc = parseUsdc(env.ARROW_MCP_MAX_USDC || "1.00");

  const ctxFor = (network: Network): Ctx => {
    const base = deps.ctx ? deps.ctx(network) : buildCtx({ network, json: true, yes: true }, env);
    // The spend plan is printed to stdout by the CLI's confirm step; here the guards below are the confirmation.
    return { ...base, confirm: async () => {} };
  };
  const guard = (network: Network, tool: string) => {
    if (network === "mainnet" && env.ARROW_MCP_ALLOW_MAINNET !== "1") throw new GuardError(`${tool} on mainnet: ARROW_MCP_ALLOW_MAINNET=1 required (set by the operator, not by the agent)`);
  };
  const cap = (what: string, units: string) => {
    if (BigInt(units) > maxUsdc) throw new GuardError(`${what} ${formatUsdc(BigInt(units))} USDC exceeds the per-call cap ${formatUsdc(maxUsdc)} USDC (ARROW_MCP_MAX_USDC)`);
  };
  const id = (v: string) => {
    if (!/^\d+$/.test(v)) throw new GuardError(`listing_id must be a number, got "${v}"`);
    return Number(v);
  };
  const handle = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try {
      return text(await fn(a));
    } catch (e) {
      if (e instanceof SettleTimeout) return fail(`${e.message} (pending, not failed)`);
      if (e instanceof GuardError || e instanceof CliError || e instanceof Error) return fail(e.message);
      return fail(String(e));
    }
  };

  const server = new McpServer({ name: "arrow", version: "0.1.0" });

  server.registerTool(
    "inspect_before_buy",
    {
      title: "Inspect a dataset before buying it",
      description:
        "Pays the eval fee (USDC) and has a sealed AI evaluate a dataset against your criteria inside a TEE. Returns only a capped verdict: PASS or BUY, optionally fit 1-5 and novelty 1-5, at most 5.67 bits per call. You never see the data. If the evaluation fails the fee is refunded to your NEAR Intents balance.",
      inputSchema: {
        listing_id: z.string().describe("listing id from list_listings"),
        criteria: z.union([z.string(), z.record(z.string(), z.any())]).describe("what you need: a criteria object, JSON text, or the path of a criteria JSON file ({v:1, text, required_columns?, min_rows?, min_fit?, min_novelty?})"),
        my_list_path: z.string().optional().describe("optional CSV/JSONL of keys you already own; only a 128-value MinHash of it leaves your machine, used for the novelty score"),
        key_column: z.string().optional().describe("column of my_list_path that holds the keys"),
        network: NETWORK,
      },
    },
    handle(async (a: { listing_id: string; criteria: string | Record<string, unknown>; my_list_path?: string; key_column?: string; network?: Network }) => {
      const network = a.network ?? defaultNetwork;
      guard(network, "inspect_before_buy");
      const ctx = ctxFor(network);
      const listingId = id(a.listing_id);
      const listing = await ctx.views.listing(listingId);
      if (!listing) throw new GuardError(`listing #${listingId} not found on ${network}`);
      cap("eval fee", listing.eval_fee);
      const criteria = typeof a.criteria === "string" && a.criteria.trim().startsWith("{") ? (JSON.parse(a.criteria) as Record<string, unknown>) : a.criteria;
      const r = await evalCommand(ctx, { listingId, criteria, myList: a.my_list_path, keyColumn: a.key_column });
      return {
        verdict: r.verdict ?? null, fit: r.fit ?? null, novelty: r.novelty ?? null, bits_out: Number(r.bits_out), budget_left_bits: Number(r.budget_left_bits),
        eval_id: r.eval_id, tx_url: r.tx_url, ...(r.status === "refunded" && { refunded: { reason: r.refund_reason } }),
      };
    }),
  );

  server.registerTool(
    "buy",
    {
      title: "Buy a dataset",
      description: "Pays the listing price (USDC), receives the decryption key from the TEE, downloads the encrypted file, checks that its sha256 equals the on-chain hash and writes the decrypted file to out_path. Call inspect_before_buy first. Spends real funds on mainnet.",
      inputSchema: {
        listing_id: z.string(),
        confirm: z.literal(true).describe("must be true: the caller confirms the purchase"),
        out_path: z.string().optional().describe("where to write the decrypted file (default: a temp folder)"),
        network: NETWORK,
      },
    },
    handle(async (a: { listing_id: string; confirm: true; out_path?: string; network?: Network }) => {
      const network = a.network ?? defaultNetwork;
      guard(network, "buy");
      const ctx = ctxFor(network);
      const listingId = id(a.listing_id);
      const listing = await ctx.views.listing(listingId);
      if (!listing) throw new GuardError(`listing #${listingId} not found on ${network}`);
      cap("price", listing.price);
      const r = await buyCommand(ctx, { listingId, out: a.out_path ?? join(tmpdir(), "arrow-purchases", `listing-${listingId}.dat`) });
      return {
        purchase_id: r.purchase_id, listing_id: r.listing_id, status: r.status, tx_url: r.tx_url,
        ...(r.status === "refunded" ? { refunded: { reason: r.refund_reason } } : { hashes_ok: r.decrypt!.ok, checks: r.decrypt!.checks, out_path: r.decrypt!.out ?? null, bytes: r.decrypt!.bytes ?? null }),
      };
    }),
  );

  server.registerTool(
    "get_listing",
    {
      title: "Read one listing",
      description: "Returns a listing's public fields (title, description, column names, price, eval fee, mode) and its remaining leak budget in bits. Read-only, free.",
      inputSchema: { listing_id: z.string(), network: NETWORK },
    },
    handle(async (a: { listing_id: string; network?: Network }) => {
      const ctx = ctxFor(a.network ?? defaultNetwork);
      const listing = await ctx.views.listing(id(a.listing_id));
      if (!listing) throw new GuardError(`listing #${a.listing_id} not found on ${ctx.network}`);
      return listingSummary(ctx, listing);
    }),
  );

  server.registerTool(
    "list_listings",
    {
      title: "List datasets for sale",
      description: "Returns up to 50 listings (id, title, price, eval fee, evals used, remaining leak budget). Read-only, free.",
      inputSchema: { from: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional(), network: NETWORK },
    },
    handle(async (a: { from?: number; limit?: number; network?: Network }) => statusCommand(ctxFor(a.network ?? defaultNetwork), { from: a.from, limit: a.limit })),
  );

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log = (...args: unknown[]) => console.error(...args); // stdout is the JSON-RPC channel
  loadEnv();
  await createServer().connect(new StdioServerTransport());
}
