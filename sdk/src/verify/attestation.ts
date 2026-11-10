// OutLayer attestation records (GET {api}/attestations/by-request/<request_id>) and the two checks that need no
// signature verification: the binding fields and the report_data recomputation. The TDX quote signature itself is
// NOT checked here (the browser does DCAP on /verify).
import { sha256 } from "@noble/hashes/sha2.js";
import { b64, bytesToHex } from "../crypto.ts";

export interface Attestation {
  task_type: string;
  task_id: number;
  request_id: number;
  caller_account_id: string;
  transaction_hash: string;
  block_height: number;
  build_target: string;
  wasm_hash: string;
  executed_wasm_sha256?: string;
  input_hash: string;
  output_hash: string;
  tdx_quote: string;
  timestamp: number;
  repo_url?: string | null;
  commit_hash?: string | null;
  project_id?: string | null;
  secrets_ref?: string | null;
  attached_usd?: string | null;
  [k: string]: unknown;
}

/** null when OutLayer has no record: storage is best-effort on the worker, so absence is not an error. */
export async function fetchAttestation(api: string, requestId: number, fetchImpl: typeof fetch = fetch): Promise<Attestation | null> {
  const res = await fetchImpl(`${api.replace(/\/+$/, "")}/attestations/by-request/${requestId}`, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`attestation request ${requestId}: HTTP ${res.status}`);
  const body = (await res.json()) as Attestation;
  if (!body || typeof body !== "object" || typeof body.wasm_hash !== "string") throw new Error(`attestation request ${requestId}: unexpected body`);
  return body;
}

const te = new TextEncoder();
const text = (s: unknown): Uint8Array => te.encode(typeof s === "string" ? s : "");
function int64le(n: number | bigint, signed: boolean): Uint8Array {
  const out = new Uint8Array(8);
  const v = new DataView(out.buffer);
  if (signed) v.setBigInt64(0, BigInt(n), true);
  else v.setBigUint64(0, BigInt(n), true);
  return out;
}
const cat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** First 32 bytes of the TDX report_data: quote offset 568 (48-byte header + 520 into the TD report body). */
export function quoteReportData(tdxQuoteB64: string): string {
  const quote = b64.dec(tdxQuoteB64);
  if (quote.length < 600) throw new Error(`TDX quote too short (${quote.length} bytes)`);
  return bytesToHex(quote.subarray(568, 600));
}

/**
 * Worker source (tdx_attestation.rs): report_data = sha256 over the fields as UTF-8 text (hashes as their hex text,
 * missing optionals as empty), integers little endian. V0 stops after block_height, V1 appends caller, project,
 * secrets ref, timestamp and attached USD. Checked against live records 100 (V0) and 4000 (V1).
 */
export function expectedReportData(a: Attestation, version: "V0" | "V1"): string {
  const v0 = [
    text(a.task_type), int64le(a.task_id, true), text(a.repo_url), text(a.commit_hash), text(a.build_target),
    text(a.wasm_hash), text(a.input_hash), text(a.output_hash), int64le(a.block_height, false),
  ];
  const v1 = [text(a.caller_account_id), text(a.project_id), text(a.secrets_ref), int64le(a.timestamp, true), text(a.attached_usd)];
  return bytesToHex(sha256(cat(version === "V0" ? v0 : [...v0, ...v1])));
}

/** "V1" or "V0" when the quote's report_data matches the recomputation, null when neither does. */
export function reportDataVersion(a: Attestation): "V1" | "V0" | null {
  const got = quoteReportData(a.tdx_quote);
  for (const v of ["V1", "V0"] as const) if (expectedReportData(a, v) === got) return v;
  return null;
}

const sha256Text = (s: string): string => bytesToHex(sha256(te.encode(s)));

/**
 * output_hash = sha256(serde_json::to_string(output)). The key order depends on serde_json's `preserve_order` feature,
 * so both orders are tried: written order (v, ok, r, h) and sorted order (h, ok, r, v). Returns which one matched.
 */
export function outputHashOrder(a: Pick<Attestation, "output_hash">, r: string, h: string): "written" | "sorted" | null {
  const written = JSON.stringify({ v: 1, ok: true, r, h });
  const sorted = JSON.stringify({ h, ok: true, r, v: 1 });
  if (sha256Text(written) === a.output_hash) return "written";
  if (sha256Text(sorted) === a.output_hash) return "sorted";
  return null;
}

/** input_hash = sha256(input_data string) (worker source; confirmed on the S1-b runs). */
export const inputHashOf = (inputData: string): string => sha256Text(inputData);
