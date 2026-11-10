// The list / eval / buy message flows shared by CLI, MCP, web, e2e and bench.
import { b64, encryptFile, seal, sealedKPayload, sha256Hex, unseal } from "./crypto.ts";
import { type Mode, decodeState, type State } from "./state.ts";
import { BuyMsg, Criteria, criteriaBytes, EvalMsg, ListMsg, MAX_CRITERIA_BYTES } from "./schemas.ts";

export const MAX_BLOB_BYTES = 5 * 1024 * 1024;

export class CriteriaTooLarge extends Error {
  constructor(public readonly bytes: number, public readonly limit = MAX_CRITERIA_BYTES) {
    super(`criteria too large: shorten text (${bytes} bytes, limit ${limit})`);
    this.name = "CriteriaTooLarge";
  }
}
export class BlobHashMismatch extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`blob sha256 mismatch: expected ${expected}, got ${actual}`);
    this.name = "BlobHashMismatch";
  }
}

/** Encrypts the file and builds the `list` msg. K is sealed to the program key and wiped; it is never returned. */
export function prepareList(p: {
  plaintext: Uint8Array;
  title: string;
  publicDesc: string;
  columns: string[];
  rowsClaimed: number;
  blobUrl: string;
  price: string;
  evalFee: string;
  maxEvals?: number;
  mode: Mode;
  programPk: string;
  payout?: string;
  /** Only for a reproducible ciphertext (the CLI derives both from a local secret so the blob can be uploaded before listing). */
  key?: Uint8Array;
  nonce?: Uint8Array;
}): { msg: string; blob: Uint8Array; blobSha256: string } {
  const { key, blob, blobSha256 } = encryptFile(p.plaintext, p.key, p.nonce);
  const sealedK = b64.enc(seal(p.programPk, sealedKPayload(key, blobSha256)));
  key.fill(0);
  const msg = ListMsg.parse({
    op: "list",
    title: p.title,
    public_desc: p.publicDesc,
    columns: p.columns,
    rows_claimed: p.rowsClaimed,
    blob_url: p.blobUrl,
    blob_sha256: blobSha256,
    sealed_k: sealedK,
    price: p.price,
    eval_fee: p.evalFee,
    max_evals: p.maxEvals ?? 50,
    mode: p.mode,
    ...(p.payout !== undefined && { payout: p.payout }),
  });
  return { msg: JSON.stringify(msg), blob, blobSha256 };
}

/** ECIES(program key) over the minified criteria JSON, base64. */
export function sealCriteria(programPk: string, criteria: Criteria): string {
  const bytes = criteriaBytes(criteria);
  if (bytes > MAX_CRITERIA_BYTES) throw new CriteriaTooLarge(bytes);
  const parsed = Criteria.parse(criteria);
  return b64.enc(seal(programPk, new TextEncoder().encode(JSON.stringify(parsed))));
}

export function prepareEval(p: { listingId: number; criteria: Criteria; buyerPk: string; programPk: string }): string {
  return JSON.stringify(
    EvalMsg.parse({ op: "eval", listing_id: p.listingId, sealed_criteria: sealCriteria(p.programPk, p.criteria), buyer_pk: p.buyerPk }),
  );
}

export function prepareBuy(p: { listingId: number; buyerPk: string }): string {
  return JSON.stringify(BuyMsg.parse({ op: "buy", listing_id: p.listingId, buyer_pk: p.buyerPk }));
}

/** `r` from the eval output: ECIES to the buyer key over one state-index byte. */
export function decodeEvalResult(rB64: string, scalarHex: string, mode: Mode): State {
  const plain = unseal(scalarHex, b64.dec(rB64));
  if (plain.length !== 1) throw new Error(`eval result must be 1 byte, got ${plain.length}`);
  return decodeState(plain[0], mode);
}

/** `k` from the release output: ECIES to the buyer key over the 32-byte file key. */
export function openRelease(kB64: string, scalarHex: string): Uint8Array {
  const k = unseal(scalarHex, b64.dec(kB64));
  if (k.length !== 32) throw new Error(`release key must be 32 bytes, got ${k.length}`);
  return k;
}

/** Downloads the ciphertext (at most 5 MB) and checks its sha256 against the on-chain value. */
export async function fetchAndCheckBlob(url: string, expectedSha: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`blob download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_BLOB_BYTES) throw new Error(`blob too large: ${declared} bytes (limit ${MAX_BLOB_BYTES})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BLOB_BYTES) throw new Error(`blob too large: ${bytes.length} bytes (limit ${MAX_BLOB_BYTES})`);
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha) throw new BlobHashMismatch(expectedSha, actual);
  return bytes;
}
