// The list / eval / buy message flows shared by CLI, MCP, web, e2e and bench.
import { b64, criteriaBind, encryptFile, seal, sealedKPayload, sha256Hex, unseal } from "./crypto.ts";
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

/**
 * Encrypts the file and builds the `list` msg. K is sealed to the program key together with the seller's account id
 * and wiped; it is never returned. `seller` must be the account that sends the list payment (the contract's `sender_id`).
 */
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
  seller: string;
  payout?: string;
  /** Only for a reproducible ciphertext (the CLI derives both from a local secret so the blob can be uploaded before listing). */
  key?: Uint8Array;
  nonce?: Uint8Array;
}): { msg: string; blob: Uint8Array; blobSha256: string } {
  const { key, blob, blobSha256 } = encryptFile(p.plaintext, p.key, p.nonce);
  let sealedK: string;
  try {
    sealedK = b64.enc(seal(p.programPk, sealedKPayload(key, blobSha256, p.seller)));
  } finally {
    key.fill(0);
  }
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

/**
 * ECIES(program key) over criteriaBind(buyer_pk, listing_id) || minified criteria JSON, base64. The bind stops a
 * sealed criteria blob copied from the chain from being replayed under another buyer key or on another listing.
 * PRIV-1: the JSON is padded with trailing spaces to MAX_CRITERIA_BYTES (JSON allows trailing whitespace, and the enclave
 * accepts up to 3072 bytes), so every sealed_criteria is 4140 base64 characters and the public tx args no longer give the
 * criteria length (whether a key list was sent, which key column, how long the text is).
 */
export function sealCriteria(programPk: string, criteria: Criteria, bind: { buyerPk: string; listingId: number }): string {
  const bytes = criteriaBytes(criteria);
  if (bytes > MAX_CRITERIA_BYTES) throw new CriteriaTooLarge(bytes);
  const parsed = Criteria.parse(criteria);
  const json = new TextEncoder().encode(JSON.stringify(parsed));
  const plain = new Uint8Array(32 + MAX_CRITERIA_BYTES).fill(0x20);
  plain.set(criteriaBind(bind.buyerPk, bind.listingId), 0);
  plain.set(json, 32);
  return b64.enc(seal(programPk, plain));
}

export function prepareEval(p: { listingId: number; criteria: Criteria; buyerPk: string; programPk: string }): string {
  const sealed = sealCriteria(p.programPk, p.criteria, { buyerPk: p.buyerPk, listingId: p.listingId });
  return JSON.stringify(EvalMsg.parse({ op: "eval", listing_id: p.listingId, sealed_criteria: sealed, buyer_pk: p.buyerPk }));
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

const BLOB_FETCH_TIMEOUT_MS = 60_000;

/** Reads the body in chunks and stops at MAX_BLOB_BYTES: a host that sends no content-length cannot make us buffer more. */
async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BLOB_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`blob too large: more than ${MAX_BLOB_BYTES} bytes (limit ${MAX_BLOB_BYTES})`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/** Downloads the ciphertext (at most 5 MB, 60 s) and checks its sha256 against the on-chain value. */
export async function fetchAndCheckBlob(url: string, expectedSha: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(BLOB_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`blob download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_BLOB_BYTES) throw new Error(`blob too large: ${declared} bytes (limit ${MAX_BLOB_BYTES})`);
  const bytes = await readCapped(res);
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha) throw new BlobHashMismatch(expectedSha, actual);
  return bytes;
}
