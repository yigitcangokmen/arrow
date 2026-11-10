import { inputHashOf } from "../attestation.ts";
import type { VerifyCtx } from "../context.ts";
import { num } from "../context.ts";
import { shortHash, txLink } from "../links.ts";
import { row, why } from "./util.ts";

export const TITLE = "G3: listing.blob_sha256 == eval.h == purchase.h == sha256(download)";

/** The enclave's own input for this listing: its blob hash, and (if stored) the attestation's input_hash. */
async function inputCheck(ctx: VerifyCtx, listingId: number, blobSha: string): Promise<{ ok: boolean; text: string }> {
  const evalRun = ctx.runs("eval").find((r) => r.tx && r.listing_id !== null && num(r.listing_id) === listingId);
  if (!evalRun) return { ok: true, text: "enclave input not checked (no eval tx of this listing in evidence)" };
  const f = await ctx.facts(evalRun);
  if (!f.inputData) return { ok: true, text: `enclave input not checked (${f.note})` };
  let seen: unknown;
  try {
    seen = JSON.parse(f.inputData)?.listing?.blob_sha256;
  } catch {
    return { ok: false, text: `eval ${evalRun.id}: request_execution input_data is not JSON` };
  }
  if (seen !== blobSha) return { ok: false, text: `eval ${evalRun.id}: enclave input names blob ${String(seen)}, listing has ${blobSha}` };
  if (!f.attestation) return { ok: true, text: `enclave input names the same blob (attestation: ${f.note})` };
  if (inputHashOf(f.inputData) === f.attestation.input_hash) return { ok: true, text: "enclave input hash == attestation.input_hash" };
  const confirmed = (ctx.opts.semantics ?? "source-read") === "confirmed-s1b";
  return { ok: !confirmed, text: `sha256(input_data) != attestation.input_hash${confirmed ? "" : " (hash semantics not confirmed, detail only)"}` };
}

/** R3: for at least one completed purchase the four hashes are equal, and no completed purchase contradicts. */
export async function r3(ctx: VerifyCtx) {
  const buys = ctx.runs("buy").filter((r) => r.purchase_id !== null);
  if (buys.length === 0) return row("R3", "NOT PROVEN", true, TITLE, "no buy run in evidence");
  const good: string[] = [];
  const bad: string[] = [];
  const skipped: string[] = [];
  const links: string[] = [];
  for (const run of buys) {
    const id = num(run.purchase_id!);
    try {
      const p = await ctx.purchase(id);
      if (!p) {
        bad.push(`purchase #${id} not found`);
        continue;
      }
      if (p.status !== "done") {
        skipped.push(`#${id} ${p.status}${p.refund_reason ? ` (${p.refund_reason})` : ""}`);
        continue;
      }
      const listing = await ctx.views.listing(p.listing_id);
      if (!listing) {
        bad.push(`purchase #${id}: listing ${p.listing_id} not found`);
        continue;
      }
      const evals = (await ctx.evalsOf(listing.id)).filter((e) => e.status === "done" && e.h);
      const downloaded = await ctx.urlSha256(listing.blob_url);
      const problems: string[] = [];
      if (evals.length === 0) problems.push("no completed eval with h on this listing");
      for (const e of evals) if (e.h !== listing.blob_sha256) problems.push(`eval #${e.id}.h ${shortHash(e.h!)} != listing`);
      if (p.h !== listing.blob_sha256) problems.push(`purchase.h ${p.h ? shortHash(p.h) : "null"} != listing`);
      if (downloaded !== listing.blob_sha256) problems.push(`sha256(download) ${shortHash(downloaded)} != listing`);
      const input = await inputCheck(ctx, num(listing.id), listing.blob_sha256);
      if (!input.ok) problems.push(input.text);
      if (problems.length) bad.push(`purchase #${id}: ${problems.join(", ")}`);
      else {
        good.push(`purchase #${id}: ${shortHash(listing.blob_sha256)} on ${evals.length} eval${evals.length === 1 ? "" : "s"}, listing, release and download; ${input.text}`);
        if (run.tx) links.push(txLink(ctx.network, "near", run.tx));
      }
    } catch (e) {
      bad.push(`purchase #${id}: ${why(e)}`);
    }
  }
  if (bad.length) return row("R3", "NOT PROVEN", true, TITLE, bad.join("; "), links);
  if (good.length === 0) return row("R3", "NOT PROVEN", true, TITLE, `no completed purchase to check${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
  return row("R3", "PROVEN", true, TITLE, good.slice(0, 2).join(" | "), links.slice(0, 3));
}
