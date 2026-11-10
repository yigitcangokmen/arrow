// Pure helpers of /sell: file header to columns, form validation, the list msg. No DOM, so vitest runs them directly.
import { BITS_PER_EVAL_MILLI } from "@arrow/sdk/bits";
import { isAddress } from "viem";
import { MAX_BLOB_BYTES, prepareList } from "@arrow/sdk/flows";
import type { Mode } from "@arrow/sdk/state";
import { parseUsdc } from "@arrow/sdk/usdc";
import { formatBits } from "./format.ts";

export const MAX_PLAINTEXT_BYTES = MAX_BLOB_BYTES - 40; // nonce 24 + tag 16
export const TITLE_PREFIXES = ["", "[synthetic]", "[team-made]"] as const;
export type TitlePrefix = (typeof TITLE_PREFIXES)[number];

/** The label choices of the /sell dropdown. [team-made] is believed only from a team account (labels.ts), so only they are offered it. */
export const prefixesFor = (isTeam: boolean): TitlePrefix[] => TITLE_PREFIXES.filter((p) => p !== "[team-made]" || isTeam);

export class SellInputError extends Error {
  /** The id of the form control the message is about, so the page can mark it invalid and focus it. */
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "SellInputError";
  }
}

const cp = (s: string) => [...s].length;
const utf8 = (s: string) => new TextEncoder().encode(s).length;

// The market refuses control characters and invisible or bidirectional format characters in anything buyers read (ZWJ and ZWNJ stay allowed).
const CONTROL = /\p{Cc}/u;
const HIDDEN = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
export const TITLE_MAX_BYTES = 240;
export const DESC_MAX_BYTES = 840;
export const COLUMNS_MAX_BYTES = 2560;

/** What is wrong with a seller-visible string, or null. Checked before the bond is paid, because the contract panics on it afterwards. */
function badText(s: string): string | null {
  if (CONTROL.test(s)) return "contains a line break, tab or other control character";
  if (HIDDEN.test(s)) return "contains an invisible or text-direction character";
  if (s.includes("EVENT_JSON")) return "contains the reserved word EVENT_JSON";
  return null;
}

/** Bytes of the column list as the contract counts them: UTF-8, with " and \ counting twice (JSON escaping). */
export const columnsBytes = (columns: readonly string[]): number => columns.reduce((n, c) => n + utf8(c) + (c.match(/["\\]/g)?.length ?? 0), 0);

/** CSV records with quoted fields (commas and newlines inside quotes, "" as an escaped quote). Empty lines are skipped. */
export function csvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export function validateColumns(columns: string[]): string[] {
  if (columns.length < 1) throw new SellInputError("The file has no header columns.");
  if (columns.length > 64) throw new SellInputError(`The file has ${columns.length} columns; the limit is 64.`);
  for (const c of columns) {
    if (cp(c) < 1) throw new SellInputError("A column name is empty.");
    if (cp(c) > 40) throw new SellInputError(`Column name "${c.slice(0, 20)}…" is longer than 40 characters.`);
  }
  return columns;
}

/** Column names from the CSV header line (BOM and quotes handled). */
export function columnsFromHeader(csvText: string): string[] {
  const head = csvRecords(csvText)[0];
  if (!head) throw new SellInputError("The file is empty.");
  return validateColumns(head.map((c) => c.trim()));
}

export type FileKind = "csv" | "jsonl";

export const fileKind = (name: string): FileKind => {
  if (/\.csv$/i.test(name)) return "csv";
  if (/\.jsonl$/i.test(name)) return "jsonl";
  throw new SellInputError("Choose a .csv or .jsonl file.");
};

/** Columns and the data row count of the plaintext file. Runs in the browser; nothing here is sent anywhere. */
export function inspectFile(kind: FileKind, text: string): { columns: string[]; rows: number } {
  if (kind === "csv") {
    const recs = csvRecords(text);
    return { columns: columnsFromHeader(text), rows: Math.max(0, recs.length - 1) };
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new SellInputError("The file is empty.");
  let first: unknown;
  try {
    first = JSON.parse(lines[0]);
  } catch {
    throw new SellInputError("The first line is not valid JSON.");
  }
  if (typeof first !== "object" || first === null || Array.isArray(first)) throw new SellInputError("Each .jsonl line must be a JSON object.");
  return { columns: validateColumns(Object.keys(first)), rows: lines.length };
}

export interface SellFields {
  prefix: TitlePrefix;
  title: string;
  publicDesc: string;
  columns: string[];
  rowsClaimed: number;
  /** USDC as typed, e.g. "0.25". */
  price: string;
  evalFee: string;
  maxEvals: number;
  mode: Mode;
  payout?: string;
}

export interface SellLimits {
  minPrice: bigint;
  minEvalFee: bigint;
}
export const DEFAULT_LIMITS: SellLimits = { minPrice: 100_000n, minEvalFee: 50_000n };

export const fullTitle = (f: Pick<SellFields, "prefix" | "title">): string => (f.prefix ? `${f.prefix} ${f.title.trim()}` : f.title.trim());

/** Throws SellInputError with a sentence the user can act on. */
export function validateFields(f: SellFields, limits: SellLimits = DEFAULT_LIMITS): void {
  const title = fullTitle(f);
  if (cp(f.title.trim()) < 1) throw new SellInputError("Add a title.", "title");
  const bad = badText(title) ?? null;
  if (bad) throw new SellInputError(`The title ${bad}.`, "title");
  if (utf8(title) > TITLE_MAX_BYTES) throw new SellInputError(`The title is ${utf8(title)} bytes; the limit is ${TITLE_MAX_BYTES}.`, "title");
  const badDesc = badText(f.publicDesc);
  if (badDesc) throw new SellInputError(`The description ${badDesc}. Use one line of plain text.`, "desc");
  if (utf8(f.publicDesc) > DESC_MAX_BYTES) throw new SellInputError(`The description is ${utf8(f.publicDesc)} bytes; the limit is ${DESC_MAX_BYTES}.`, "desc");
  if (f.payout !== undefined) normalizePayout(f.payout);
  if (cp(title) > 80) throw new SellInputError(`The title (with its prefix) is ${cp(title)} characters; the limit is 80.`, "title");
  if (cp(f.publicDesc) > 280) throw new SellInputError(`The description is ${cp(f.publicDesc)} characters; the limit is 280.`, "desc");
  validateColumns(f.columns);
  for (const c of f.columns) {
    const b = badText(c);
    if (b) throw new SellInputError(`The column name "${c.slice(0, 20)}" ${b}.`, "file");
  }
  if (columnsBytes(f.columns) > COLUMNS_MAX_BYTES) throw new SellInputError(`The column names together are ${columnsBytes(f.columns)} bytes; the limit is ${COLUMNS_MAX_BYTES}.`, "file");
  if (!Number.isInteger(f.rowsClaimed) || f.rowsClaimed < 0) throw new SellInputError("Rows claimed must be a whole number.", "rows");
  if (!Number.isInteger(f.maxEvals) || f.maxEvals < 1 || f.maxEvals > 500) throw new SellInputError("Max inspections must be between 1 and 500.", "max");
  let price: bigint;
  let fee: bigint;
  try {
    price = parseUsdc(f.price);
    fee = parseUsdc(f.evalFee);
  } catch {
    throw new SellInputError("Prices are USDC amounts with up to 6 decimals, for example 0.25.", "price");
  }
  if (price < limits.minPrice) throw new SellInputError(`The price must be at least ${Number(limits.minPrice) / 1e6} USDC.`, "price");
  if (fee < limits.minEvalFee) throw new SellInputError(`The inspection fee must be at least ${Number(limits.minEvalFee) / 1e6} USDC.`, "fee");
  if (fee > price) throw new SellInputError("The inspection fee cannot be higher than the price: buyers would pay more to look than to buy.", "fee");
}

/** "50 inspections × 5.673 bits = 283.65 bits": the most the chain will ever let out for this listing. The factor is shown at milli precision so the product is the number printed. */
export function budgetPreview(maxEvals: number, mode: Mode): string {
  const per = BITS_PER_EVAL_MILLI[mode];
  return `${maxEvals} inspections × ${(per / 1000).toFixed(3)} bits = ${formatBits(maxEvals * per)} bits`;
}

/**
 * The `list` msg for a ciphertext that is already uploaded. `key` and `nonce` are the ones the blob was encrypted
 * with, so prepareList reproduces the same ciphertext and seals K || sha256 || sha256(seller) to the program key.
 * `seller` is the account that pays the bond (the contract's sender_id). It wipes `key`.
 */
export function buildListMsg(p: {
  fields: SellFields;
  plaintext: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
  blobUrl: string;
  programPk: string;
  seller: string;
}): { msg: string; blob: Uint8Array; blobSha256: string } {
  const f = p.fields;
  return prepareList({
    plaintext: p.plaintext,
    key: p.key,
    nonce: p.nonce,
    title: fullTitle(f),
    publicDesc: f.publicDesc,
    columns: f.columns,
    rowsClaimed: f.rowsClaimed,
    blobUrl: p.blobUrl,
    price: parseUsdc(f.price).toString(),
    evalFee: parseUsdc(f.evalFee).toString(),
    maxEvals: f.maxEvals,
    mode: f.mode,
    programPk: p.programPk,
    seller: p.seller,
    ...(f.payout ? { payout: f.payout } : {}),
  });
}

/** The "host it yourself" URL: https, no whitespace, at most 200 characters (ListMsg.blob_url). */
export function checkBlobUrl(url: string): string {
  const u = url.trim();
  if (!/^https:\/\/[^\s\u0000-\u001f\u007f]+$/.test(u)) throw new SellInputError("The URL must start with https:// and contain no spaces.");
  if (u.length > 200) throw new SellInputError(`The URL is ${u.length} characters; the limit is 200.`);
  return u;
}

/**
 * The payout account as the contract wants it: a 0x address (lowercased; a mixed-case one must carry a valid EIP-55 checksum),
 * a 64-hex implicit id, or a dotted NEAR account id, never lowercased by us. A bare name like a pasted Solana address is
 * refused: lowercased it would be a valid NEAR id that somebody else owns or nobody can create.
 */
export function normalizePayout(raw: string, market = "arrow-market.near"): string {
  const p = raw.trim();
  const bad = (m: string) => new SellInputError(m, "payout");
  if (/^0x[0-9a-fA-F]{40}$/.test(p)) {
    const mixed = /[a-f]/.test(p.slice(2)) && /[A-F]/.test(p.slice(2));
    if (mixed && !isAddress(p, { strict: true })) throw bad("That 0x address has a wrong checksum (mixed upper and lower case). Check it, or paste it in lower case.");
    return p.toLowerCase();
  }
  if (/^[0-9a-f]{64}$/.test(p)) return p;
  if (p.includes(".") && /^[a-z0-9._-]{2,64}$/.test(p) && !p.startsWith(".") && !p.endsWith(".")) {
    if (p === market || p === "intents.near") throw bad("The payout cannot be the market or the Intents contract.");
    return p;
  }
  throw bad("Use a 0x address, a 64-character hex account or a NEAR account with a dot (alice.near). A Solana address is not a payout account here; withdraw to Solana from the Payouts page.");
}
