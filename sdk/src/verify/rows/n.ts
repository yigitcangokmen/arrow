import { bytesToHex } from "../../crypto.ts";
import { NEAR_AI_API, NEAR_AI_MODEL } from "../config.ts";
import type { VerifyCtx } from "../context.ts";
import { row, why } from "./util.ts";

const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)}Z`;

/** N1: always NOT PROVEN. The endpoint answers with its state now, which says nothing about the model at eval time. */
export async function n1(ctx: VerifyCtx) {
  const title = `model attestation at eval time (current endpoint state only, fetched ${hhmm(ctx.now)})`;
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const url = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(NEAR_AI_MODEL)}&provider=near&signing_algo=ecdsa&nonce=${nonce}`;
  try {
    const res = await ctx.fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return row("N1", "NOT PROVEN", false, title, `endpoint answered HTTP ${res.status}; it would not bind to an eval anyway`);
    const body: any = await res.json();
    const addr = body?.gateway_attestation?.signing_address;
    const models = Array.isArray(body?.model_attestations) ? body.model_attestations.length : 0;
    return row("N1", "NOT PROVEN", false, title, `current endpoint state, not eval-time${addr ? ` · gateway signing address ${addr}` : ""} · ${models} model attestation${models === 1 ? "" : "s"}`);
  } catch (e) {
    return row("N1", "NOT PROVEN", false, title, `current endpoint state, not eval-time; fetch failed: ${why(e)}`);
  }
}

/** N2: always NOT PROVEN. */
export function n2() {
  return row("N2", "NOT PROVEN", false, "TDX quote is not verified on chain", "no contract checks a quote; /verify runs DCAP in the browser and OutLayer's record is the binding");
}
