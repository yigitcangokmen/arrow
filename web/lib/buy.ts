// Pure logic of /buy: the criteria form to a Criteria object, keys for the MinHash, the eval msg.
import { CriteriaTooLarge, prepareEval } from "@arrow/sdk/flows";
import { Criteria } from "@arrow/sdk/schemas";
import { csvRecords } from "./sell.ts";

export class BuyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuyInputError";
  }
}

export interface CriteriaFormState {
  requiredColumns: string[];
  minRows: string;
  dateColumn: string;
  dateFrom: string;
  dateTo: string;
  maxNullRate: string;
  keyColumn: string;
  text: string;
  minFit: number;
  minNovelty: number;
  /** 2048 hex from signatureHex(), empty when the buyer gave no list of their own. */
  minhash: string;
}

export const EMPTY_CRITERIA: CriteriaFormState = {
  requiredColumns: [], minRows: "", dateColumn: "", dateFrom: "", dateTo: "", maxNullRate: "", keyColumn: "", text: "", minFit: 4, minNovelty: 3, minhash: "",
};

const num = (label: string, raw: string, ok: (n: number) => boolean, hint: string): number | undefined => {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || !ok(n)) throw new BuyInputError(`${label} ${hint}.`);
  return n;
};

/** The buyer's form to the criteria the enclave reads. Throws BuyInputError with a sentence the user can act on. */
export function criteriaFromForm(f: CriteriaFormState, listingColumns: readonly string[]): Criteria {
  const known = new Set(listingColumns);
  for (const c of [...f.requiredColumns, f.dateColumn, f.keyColumn]) {
    if (c && !known.has(c)) throw new BuyInputError(`"${c}" is not a column of this listing.`);
  }
  if ((f.dateFrom || f.dateTo) && !f.dateColumn) throw new BuyInputError("Pick the date column the dates apply to.");
  if (f.minhash && !f.keyColumn) throw new BuyInputError("Pick the key column your own list is compared on.");
  const minRows = num("Minimum rows", f.minRows, (n) => Number.isInteger(n) && n >= 0 && n <= 200_000, "must be a whole number from 0 to 200000");
  const maxNull = num("Maximum null rate", f.maxNullRate, (n) => n >= 0 && n <= 1, "must be between 0 and 1");
  const candidate = {
    v: 1 as const,
    ...(f.requiredColumns.length ? { required_columns: f.requiredColumns } : {}),
    ...(minRows !== undefined ? { min_rows: minRows } : {}),
    ...(f.dateColumn ? { date_column: f.dateColumn } : {}),
    ...(f.dateFrom ? { date_from: f.dateFrom } : {}),
    ...(f.dateTo ? { date_to: f.dateTo } : {}),
    ...(maxNull !== undefined ? { max_null_rate: maxNull } : {}),
    ...(f.keyColumn ? { key_column: f.keyColumn } : {}),
    text: f.text.trim(),
    min_fit: f.minFit,
    min_novelty: f.minNovelty,
    ...(f.minhash ? { minhash: f.minhash } : {}),
  };
  const parsed = Criteria.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "text") throw new BuyInputError("The description can be at most 600 characters.");
    if (/too large/.test(issue?.message ?? "")) throw new BuyInputError("The request is too large. Shorten the description or drop your own list.");
    throw new BuyInputError(`Check the form: ${issue?.path.join(".") || "criteria"} ${issue?.message ?? "is invalid"}.`);
  }
  return parsed.data;
}

/** Keys of the buyer's own list: the named column of a CSV with a header, else one key per non-empty line. */
export function keysFromText(text: string, keyColumn?: string): string[] {
  if (keyColumn) {
    const rows = csvRecords(text);
    const idx = rows[0]?.map((c) => c.trim()).indexOf(keyColumn) ?? -1;
    if (idx >= 0) return rows.slice(1).map((r) => (r[idx] ?? "").trim()).filter(Boolean);
  }
  return text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** The eval msg; a criteria blob that does not fit is reported as advice, not as a zod error. */
export function buildEvalMsg(p: { listingId: number; criteria: Criteria; buyerPk: string; programPk: string }): string {
  try {
    return prepareEval(p);
  } catch (e) {
    if (e instanceof CriteriaTooLarge) throw new BuyInputError("The request is too large to seal. Shorten the description or drop your own list.");
    if (e instanceof Error && /4096|sealed_criteria/.test(e.message)) throw new BuyInputError("The sealed request is over 4096 characters. Shorten the description or drop your own list.");
    throw e;
  }
}

/** A file name for the decrypted download: .jsonl when the first character is "{", else .csv. */
export const downloadName = (listingId: number | string, plain: Uint8Array): string => {
  const first = new TextDecoder().decode(plain.subarray(0, 64)).trimStart()[0];
  return `arrow-listing-${listingId}.${first === "{" ? "jsonl" : "csv"}`;
};
