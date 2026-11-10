// npm run replay (WS4-T16, DEC I-22): offline check of the NEAR AI response signatures the bench recorded for its DIRECT calls.
// Nothing here touches the chain: a response hash or signature never goes into an on-chain eval output (Invariant 5), so this
// reads only bench/results and the raw request/response files next to it.
// Per record:
//   1. text == "<model>:<sha256(request)>:<sha256(response)>" (provider_tee) or "<sha256(request)>:<sha256(response)>" (gateway)
//   2. EIP-191 recover(text, signature) == signing_address (a gateway record without an address must recover to an attested one)
//   3. the raw request/response files, when they are on disk, hash to request_sha256 / response_sha256
//   4. the signing address is listed in an attestation snapshot taken during the bench ("attested at bench time")
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { sha256Hex } from "@arrow/sdk";
import { repoRoot } from "./lib/env.ts";
import { mask } from "./lib/log.ts";

const Nullish = <T extends z.ZodType>(t: T) => t.nullable().optional();
const Item = z.looseObject({
  case_id: Nullish(z.string()),
  chat_id: Nullish(z.string()),
  model: z.string(),
  request_sha256: z.string(),
  response_sha256: Nullish(z.string()),
  request_file: Nullish(z.string()),
  response_file: Nullish(z.string()),
  status: Nullish(z.string()),
  signature_kind: Nullish(z.string()),
  text: Nullish(z.string()),
  signature: Nullish(z.string()),
  signing_address: Nullish(z.string()),
});
/** the WS-6 file: totals from the run plus one item per direct call */
const SignaturesFile = z.looseObject({
  attestation_file: Nullish(z.string()),
  attested_signing_addresses: z.array(z.string()).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(Item),
});

export interface Rec {
  id: string;
  model: string;
  kind: string | null;
  captured: boolean;
  request_sha256: string;
  response_sha256: string | null;
  request_file: string | null;
  response_file: string | null;
  text: string | null;
  signature: string | null;
  signing_address: string | null;
}

export interface Checked {
  id: string;
  captured: boolean;
  ok: boolean;
  attested: boolean;
  reason?: string;
}

export interface ReplayReport {
  line: string;
  failures: string[];
  verified: number;
  total: number;
  attested: number;
  exit: number;
}

const low = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Reads bench/results/signatures.json: the WS-6 object, or a plain array of signature records. */
export function loadRecords(path: string): { records: Rec[]; total: number; attestedAddresses: string[]; attestationFile: string | null } {
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  const wrapped = Array.isArray(json) ? { items: json } : json;
  const f = SignaturesFile.parse(wrapped);
  const records = f.items.map((i, n): Rec => ({
    id: i.case_id ?? i.chat_id ?? `#${n + 1}`,
    model: i.model,
    kind: i.signature_kind ?? null,
    // a plain record array holds only fetched signatures; the WS-6 file marks the others by status
    captured: i.status === undefined || i.status === null ? Boolean(i.signature) : i.status === "captured",
    request_sha256: i.request_sha256,
    response_sha256: i.response_sha256 ?? null,
    request_file: i.request_file ?? null,
    response_file: i.response_file ?? null,
    text: i.text ?? null,
    signature: i.signature ?? null,
    signing_address: i.signing_address ?? null,
  }));
  return { records, total: f.total ?? records.length, attestedAddresses: f.attested_signing_addresses ?? [], attestationFile: f.attestation_file ?? null };
}

/** Every signing address named by an attestation snapshot taken at bench time. */
export function attestedAddresses(root: string, listed: string[], attestationFile: string | null): Set<string> {
  const found = new Set(listed.map(low));
  const files: string[] = [];
  if (attestationFile) files.push(resolve(root, attestationFile));
  for (const dir of [resolve(root, "bench/results"), resolve(root, "bench/results/baselines")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (/^(nearai-)?attestation-.*\.json$/.test(name)) files.push(resolve(dir, name));
  }
  for (const file of new Set(files)) {
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/"signing_address"\s*:\s*"(0x[0-9a-fA-F]{40})"/g)) found.add(low(m[1]));
  }
  return found;
}

export async function checkRecord(r: Rec, attested: Set<string>, root: string): Promise<Checked> {
  const bad = (reason: string): Checked => ({ id: r.id, captured: true, ok: false, attested: false, reason });
  if (!r.captured) return { id: r.id, captured: false, ok: false, attested: false };
  if (!r.text || !r.signature || !r.response_sha256) return bad("captured record without text, signature or response hash");
  const tee = `${r.model}:${r.request_sha256}:${r.response_sha256}`;
  const gateway = `${r.request_sha256}:${r.response_sha256}`;
  const allowed = r.kind === "provider_tee" ? [tee] : r.kind === "gateway" ? [gateway] : [tee, gateway];
  if (!allowed.includes(r.text)) return bad("text does not match <model>:<request_sha256>:<response_sha256>");
  for (const [label, file, want] of [["request", r.request_file, r.request_sha256], ["response", r.response_file, r.response_sha256]] as const) {
    const path = file ? resolve(root, file) : null;
    if (path && existsSync(path) && sha256Hex(new Uint8Array(readFileSync(path))) !== low(want)) return bad(`${label} file ${file} does not hash to the recorded sha256`);
  }
  let recovered: string;
  try {
    recovered = low(await recoverMessageAddress({ message: r.text, signature: r.signature as `0x${string}` }));
  } catch {
    return bad("signature cannot be recovered");
  }
  if (r.signing_address) {
    if (recovered !== low(r.signing_address)) return bad(`signature recovers to ${recovered}, not to the recorded signing_address`);
  } else if (!attested.has(recovered)) return bad("no signing_address and the recovered address is not in an attestation snapshot");
  return { id: r.id, captured: true, ok: true, attested: attested.has(recovered) };
}

export async function replay(root: string = repoRoot()): Promise<ReplayReport> {
  const file = resolve(root, "bench/results/signatures.json");
  if (!existsSync(file)) return { line: "NEAR AI signatures: 0/0 (no bench signatures recorded yet)", failures: [], verified: 0, total: 0, attested: 0, exit: 0 };
  const { records, total, attestedAddresses: listed, attestationFile } = loadRecords(file);
  const addresses = attestedAddresses(root, listed, attestationFile);
  const checked = await Promise.all(records.map((r) => checkRecord(r, addresses, root)));
  const verified = checked.filter((c) => c.ok).length;
  const attested = checked.filter((c) => c.ok && c.attested).length;
  const failures = checked.filter((c) => c.captured && !c.ok).map((c) => `FAIL ${c.id}: ${c.reason}`);
  const snapshot = addresses.size === 0 ? " · attestation snapshot missing" : "";
  return {
    line: `NEAR AI signatures: ${verified}/${Math.max(total, records.length)} verified · ${attested} attested at bench time${snapshot} · direct bench calls only (never on-chain)`,
    failures, verified, total: Math.max(total, records.length), attested,
    exit: failures.length ? 1 : 0,
  };
}

export async function main(root?: string): Promise<number> {
  const r = await replay(root);
  for (const f of r.failures) console.log(mask(f));
  console.log(r.line);
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main().catch((e) => (console.error(mask(e instanceof Error ? e.message : String(e))), 1)));
}
