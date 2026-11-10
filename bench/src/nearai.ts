// Direct NEAR AI calls for the bench baselines and signature capture (WS6-T05, card section H item 9, DEC I-22).
// These calls never feed an on-chain eval (Invariant 5). The request body is built ONCE as a string; the same
// bytes are hashed and sent, so the signature can be checked against them later.
import { createHash } from "node:crypto";

export const API_BASE = () => process.env.NEARAI_API_BASE ?? "https://cloud-api.near.ai/v1";
export const sha256Hex = (b: string | Uint8Array): string => createHash("sha256").update(b).digest("hex");

export type FetchLike = typeof fetch;
export type ChatResult = { status: number; reqBytes: Uint8Array; reqSha256: string; respBytes: Uint8Array; respSha256: string; chatId: string | null; latencyMs: number };

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Accept-Encoding": "identity", "x-no-aliasing": "true" };
}

/** POST {base}/chat/completions with the body string as given. Stream is never requested. */
export async function chatRaw(body: string, key: string, f: FetchLike = fetch): Promise<ChatResult> {
  const reqBytes = new TextEncoder().encode(body);
  const t0 = Date.now();
  const res = await f(`${API_BASE()}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    body: reqBytes, // the exact bytes that were hashed
    signal: AbortSignal.timeout(120_000),
  });
  const respBytes = new Uint8Array(await res.arrayBuffer());
  let chatId: string | null = null;
  try { chatId = (JSON.parse(new TextDecoder().decode(respBytes)) as { id?: string }).id ?? null; } catch { /* not JSON */ }
  return { status: res.status, reqBytes, reqSha256: sha256Hex(reqBytes), respBytes, respSha256: sha256Hex(respBytes), chatId, latencyMs: Date.now() - t0 };
}

export type SigResult = { status: "captured" | "not_found" | "unavailable" | "error"; kind: "provider_tee" | "gateway" | null; text: string | null; signature: string | null; signingAddress: string | null };

/** GET /signature/{chatId}?signing_algo=ecdsa. 404 is retried up to 5 times over ~30 s; a 2xx with error_code is "unavailable". */
export async function fetchSignature(chatId: string, key: string, model: string, f: FetchLike = fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<SigResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await f(`${API_BASE()}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, { headers: authHeaders(key), signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) { await sleep(6000); continue; }
    if (!res.ok) return { status: "error", kind: null, text: null, signature: null, signingAddress: null };
    const j = (await res.json()) as { error_code?: unknown; text?: string; signature?: string; signing_address?: string; signing_algo?: string };
    if (j.error_code) return { status: "unavailable", kind: null, text: null, signature: null, signingAddress: null };
    return { status: "captured", kind: j.signing_address ? "provider_tee" : "gateway", text: j.text ?? null, signature: j.signature ?? null, signingAddress: j.signing_address ?? null };
  }
  return { status: "not_found", kind: null, text: null, signature: null, signingAddress: null };
}

/** GET /attestation/report with a fresh nonce. The report names the signing addresses the signatures are checked against. */
export async function fetchAttestation(model: string, key: string, f: FetchLike = fetch): Promise<{ status: number; body: string; nonce: string }> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const url = `${API_BASE()}/attestation/report?model=${encodeURIComponent(model)}&provider=near&include_tls_fingerprint=false&signing_algo=ecdsa&nonce=${nonce}`;
  const res = await f(url, { headers: authHeaders(key), signal: AbortSignal.timeout(60_000) });
  return { status: res.status, body: await res.text(), nonce };
}
