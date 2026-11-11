// Daily garbage collection of the Blob store (X12-4): a hosted ciphertext that no listing of any Arrow market points to,
// 24 hours after upload, is deleted. Fails closed: if any listing read fails, nothing is deleted.
import { timingSafeEqual } from "node:crypto";
import { del, list } from "@vercel/blob";
import { ArrowViews } from "@arrow/sdk/contract";
import { RpcError } from "@arrow/sdk/rpc";
import { CONTRACTS, type Network } from "../config.ts";
import { apiError, json } from "./http.ts";

export const GC_GRACE_MS = 86_400_000;
/** Every market whose listings may point into this store: the configured ones plus the earlier deploys that keep their listings. */
export const GC_MARKETS: [Network, string][] = [
  ...new Map<string, [Network, string]>(
    ([["mainnet", CONTRACTS.mainnet], ["mainnet", "arrow-market-v2.near"], ["testnet", CONTRACTS.testnet], ["testnet", "arrow.arrowhq.testnet"]] as [Network, string][]).map((m) => [m[1], m]),
  ).values(),
];
const PATH = /^blobs\/([0-9a-f]{64})\.bin$/;

export interface StoredBlob {
  pathname: string;
  url: string;
  uploadedAt: Date;
}

export interface GcDeps {
  secret(): string | undefined;
  token(): string | undefined;
  blobs(token: string): Promise<StoredBlob[]>;
  /** Every listing of one market as {blob_sha256, blob_url}; [] when the contract has no code yet. Throws on any other error. */
  listings(net: Network, contract: string): Promise<{ blob_sha256: string; blob_url: string }[]>;
  del(urls: string[], token: string): Promise<void>;
  now(): number;
}

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The sha256 of every ciphertext a listing still needs: the bound hash, and the path of its current URL. */
export function referencedShas(listings: { blob_sha256: string; blob_url: string }[]): Set<string> {
  const out = new Set<string>();
  for (const l of listings) {
    out.add(l.blob_sha256);
    try {
      const m = PATH.exec(new URL(l.blob_url).pathname.slice(1));
      if (m) out.add(m[1]);
    } catch {
      // not a URL: the bound hash above still keeps the blob
    }
  }
  return out;
}

export async function handleBlobGc(req: Request, d: GcDeps): Promise<Response> {
  if (!authorized(req.headers.get("authorization"), d.secret())) return apiError(401, "UNAUTHORIZED", "Unauthorized.");
  const token = d.token();
  if (!token) return apiError(503, "BLOB_NOT_CONFIGURED", "Blob storage is not configured on this deployment.");

  let keep: Set<string>;
  try {
    const all = await Promise.all(GC_MARKETS.map(([net, contract]) => d.listings(net, contract)));
    keep = referencedShas(all.flat());
  } catch {
    return apiError(503, "LISTINGS_UNREADABLE", "Could not read every listing, so nothing was deleted.");
  }

  const cutoff = d.now() - GC_GRACE_MS;
  const stored = await d.blobs(token);
  const doomed = stored.filter((b) => {
    const m = PATH.exec(b.pathname);
    return m !== null && b.uploadedAt.getTime() < cutoff && !keep.has(m[1]);
  });
  for (let i = 0; i < doomed.length; i += 100) await d.del(doomed.slice(i, i + 100).map((b) => b.url), token);
  return json(200, { scanned: stored.length, kept: stored.length - doomed.length, deleted: doomed.map((b) => b.pathname) });
}

async function allBlobs(token: string): Promise<StoredBlob[]> {
  const out: StoredBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix: "blobs/", limit: 1000, cursor });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export const realGcDeps: GcDeps = {
  secret: () => process.env.CRON_SECRET,
  token: () => process.env.BLOB_READ_WRITE_TOKEN,
  blobs: allBlobs,
  listings: async (net, contract) => {
    try {
      return await new ArrowViews(net, contract).allListings();
    } catch (e) {
      if (e instanceof RpcError && /CodeDoesNotExist/.test(e.message)) return []; // not deployed yet: no listing can point anywhere
      throw e;
    }
  },
  del: (urls, token) => del(urls, { token }),
  now: () => Date.now(),
};
