// --decrypt-demo: opens the first purchase made with the public demo viewing key (DEC J-06) to show that the whole chain
// works for a buyer. The plaintext is returned to the caller to write to a file; it is never part of the printed lines.
import { decryptFile, sha256Hex } from "../crypto.ts";
import { fetchAndCheckBlob, openRelease } from "../flows.ts";
import { demoViewingKey } from "../viewingKey.ts";
import { VerifyCtx, num } from "./context.ts";
import type { VerifyOptions } from "./types.ts";

export interface DemoDecrypt {
  purchaseId: number;
  /** How the purchase was recognised: "demo:true" or "demo:e2e" in the run's text, else the buyer key. */
  marker: string;
  bytes: number;
  plaintext: Uint8Array;
  fileName: string;
  /** The two printable lines once the caller has written the plaintext to `path`. Never contains plaintext. */
  lines: (path: string) => string[];
}

export async function decryptDemo(opts: VerifyOptions): Promise<DemoDecrypt> {
  const ctx = new VerifyCtx(opts);
  const key = demoViewingKey();
  const buys = ctx.runs("buy").filter((r) => r.purchase_id !== null);
  const pick =
    buys.map((r) => ({ r, m: "demo:true" })).find(({ r }) => r.observed.includes("demo:true")) ??
    buys.map((r) => ({ r, m: "demo:e2e" })).find(({ r }) => r.observed.includes("demo:e2e")) ??
    null;
  let chosen: { id: number; marker: string } | null = pick ? { id: num(pick.r.purchase_id!), marker: pick.m } : null;
  if (!chosen) {
    for (const r of buys) {
      const p = await ctx.purchase(num(r.purchase_id!));
      if (p && p.status === "done" && p.buyer_pk === key.buyerPk) {
        chosen = { id: num(p.id), marker: "buyer key = demo viewing key" };
        break;
      }
    }
  }
  if (!chosen) throw new Error("no demo purchase in evidence (a buy run marked demo:true, or one made with the demo viewing key)");

  const p = await ctx.purchase(chosen.id);
  if (!p || p.status !== "done" || !p.sealed_k_buyer) throw new Error(`purchase #${chosen.id} is not a completed purchase`);
  if (p.buyer_pk !== key.buyerPk) throw new Error(`purchase #${chosen.id} was not made with the demo viewing key`);
  const listing = await ctx.views.listing(p.listing_id);
  if (!listing) throw new Error(`listing ${p.listing_id} not found`);

  const k = openRelease(p.sealed_k_buyer, key.scalarHex);
  const blob = await fetchAndCheckBlob(listing.blob_url, listing.blob_sha256, ctx.fetch);
  if (p.h !== sha256Hex(blob)) throw new Error("purchase.h differs from sha256 of the downloaded blob");
  const plaintext = decryptFile(blob, k);
  k.fill(0);

  const fileName = `demo-${chosen.id}.csv`;
  return {
    purchaseId: chosen.id,
    marker: chosen.marker,
    bytes: plaintext.length,
    plaintext,
    fileName,
    lines: (path) => [
      `demo purchase #${chosen.id} on listing ${listing.id} (${chosen.marker})`,
      `sha256 match ✔ · wrote ${path} (${plaintext.length} bytes)`,
    ],
  };
}
