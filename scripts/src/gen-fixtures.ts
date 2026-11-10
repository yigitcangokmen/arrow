// Generates the shared interface vectors (DEC C-09): msg, input, output, state-index and criteria vectors.
// Filler bytes come from a sha256 chain seeded with "arrow/fixture/<name>", never from randomness,
// and no vector holds a private key (W1-09). Encoding rules: fixtures/README.md.
// Usage: npx tsx scripts/src/gen-fixtures.ts [--check]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

// n deterministic bytes: h0 = sha256("arrow/fixture/" + name), h(i+1) = sha256(h(i)).
export function fill(name: string, n: number): Buffer {
  const parts: Buffer[] = [];
  let h = createHash("sha256").update(`arrow/fixture/${name}`, "utf8").digest();
  let len = 0;
  while (len < n) {
    parts.push(h);
    len += h.length;
    h = createHash("sha256").update(h).digest();
  }
  return Buffer.concat(parts).subarray(0, n);
}
const hex = (name: string, bytes: number) => fill(name, bytes).toString("hex");
const b64 = (name: string, bytes: number) => fill(name, bytes).toString("base64");
const pk = (name: string) => "04" + hex(name, 64);

// ECIES profile eciesjs-0.4-default: 65 (ephemeral pk) + 16 (nonce) + 16 (tag) = 97 bytes overhead.
export const SIZES = {
  sealed_k_bytes: 193, // ECIES(K 32 || blob_sha256 32 || sha256(seller) 32) = 97 + 96
  sealed_k_b64: 260,
  sealed_criteria_max_bytes: 3104, // ECIES(bind 32 || criteria JSON <= 2975) = 97 + 32 + 2975
  sealed_criteria_b64_max: 4140,
  r_bytes: 98, // ECIES(1-byte state index)
  r_b64: 132,
  k_bytes: 129, // ECIES(K 32)
  k_b64: 172,
} as const;

const SHA = hex("listing/blob_sha256", 32);
const BLOB_URL = `https://blobs.arrow.example/${SHA}.bin`;
const SEALED_K = b64("listing/sealed_k", SIZES.sealed_k_bytes);
const BUYER_PK = pk("buyer_pk");
const COLUMNS = ["date", "region", "sku", "units", "price_usd"];
const SELLER = "0x66a0dfed229e920feb17aa3186f87bd00e30844f"; // the contract tests' seller()

const listBase = (): Obj => ({
  op: "list",
  title: "Retail sales by SKU, 2025 (synthetic)",
  public_desc: "Daily units and prices per SKU and region. Synthetic demo data.",
  columns: [...COLUMNS],
  rows_claimed: 12000,
  blob_url: BLOB_URL,
  blob_sha256: SHA,
  sealed_k: SEALED_K,
  price: "250000",
  eval_fee: "100000",
  max_evals: 20,
  mode: "scored",
});
const evalBase = (): Obj => ({
  op: "eval",
  listing_id: 7,
  sealed_criteria: b64("eval/sealed_criteria_min", 97 + 40),
  buyer_pk: BUYER_PK,
});
const buyBase = (): Obj => ({ op: "buy", listing_id: 7, buyer_pk: BUYER_PK });
const withField = (o: Obj, k: string, v: Json): Obj => ({ ...o, [k]: v });
const without = (o: Obj, k: string): Obj => {
  const c = { ...o };
  delete c[k];
  return c;
};
const chars = (n: number, c = "a") => c.repeat(n);
const colName = (i: number, len: number) => (`c${i}_` + "x".repeat(len)).slice(0, len);

function msgVectors(): Obj {
  const maxUrl = "https://blobs.arrow.example/" + "a".repeat(200 - "https://blobs.arrow.example/".length);
  const valid: Obj[] = [
    { name: "list_scored_full", msg: withField(listBase(), "payout", "0x" + hex("payout/evm", 20)) },
    { name: "list_verdict_min", msg: { ...listBase(), title: "T", public_desc: "d", columns: ["k"], rows_claimed: 1, mode: "verdict" } },
    { name: "list_named_payout", msg: withField(listBase(), "payout", "seller-payout.arrowhq.near") },
    {
      name: "list_max_lengths",
      msg: {
        ...listBase(),
        title: chars(80, "T"),
        public_desc: chars(280, "d"),
        columns: Array.from({ length: 64 }, (_, i) => colName(i, 40)),
        blob_url: maxUrl,
      },
    },
    { name: "list_max_evals_1", msg: withField(listBase(), "max_evals", 1) },
    { name: "list_max_evals_500", msg: withField(listBase(), "max_evals", 500) },
    { name: "list_min_price_and_fee", msg: { ...listBase(), price: "100000", eval_fee: "50000" } },
    { name: "eval_min", msg: evalBase() },
    { name: "eval_criteria_4140", msg: withField(evalBase(), "sealed_criteria", b64("eval/sealed_criteria_max", SIZES.sealed_criteria_max_bytes)) },
    { name: "buy_min", msg: buyBase() },
  ];
  const inv = (name: string, msg: Obj, reason: string, stage = "parse"): Obj => ({ name, msg, reason, stage });
  const invalid: Obj[] = [
    { name: "not_json", msg_raw: '{"op":', reason: "not_json", stage: "parse" },
    inv("missing_op", without(listBase(), "op"), "missing_op"),
    inv("unknown_op", withField(listBase(), "op", "delist"), "unknown_op"),
    inv("extra_field", withField(listBase(), "foo", 1), "unknown_field"),
    inv("title_too_long", withField(listBase(), "title", chars(81, "T")), "title_too_long"),
    inv("title_empty", withField(listBase(), "title", ""), "title_empty"),
    inv("desc_too_long", withField(listBase(), "public_desc", chars(281, "d")), "desc_too_long"),
    inv("columns_too_many", withField(listBase(), "columns", Array.from({ length: 65 }, (_, i) => `c${i}`)), "columns_too_many"),
    inv("column_name_too_long", withField(listBase(), "columns", ["date", colName(1, 41)]), "column_name_too_long"),
    inv("columns_empty", withField(listBase(), "columns", []), "columns_empty"),
    inv("blob_url_http", withField(listBase(), "blob_url", BLOB_URL.replace("https://", "http://")), "blob_url_not_https"),
    inv("blob_url_too_long", withField(listBase(), "blob_url", maxUrl + "a"), "blob_url_too_long"),
    inv("blob_url_whitespace", withField(listBase(), "blob_url", "https://blobs.arrow.example/a b.bin"), "blob_url_whitespace"),
    inv("blob_sha_upper", withField(listBase(), "blob_sha256", SHA.toUpperCase()), "blob_sha256_format"),
    inv("blob_sha_63", withField(listBase(), "blob_sha256", SHA.slice(0, 63)), "blob_sha256_format"),
    inv("blob_sha_0x", withField(listBase(), "blob_sha256", "0x" + SHA), "blob_sha256_format"),
    inv("sealed_k_not_b64", withField(listBase(), "sealed_k", "!" + SEALED_K.slice(1)), "sealed_k_not_b64"),
    inv("sealed_k_wrong_len", withField(listBase(), "sealed_k", b64("listing/sealed_k_short", 159)), "sealed_k_wrong_len"),
    inv("price_number_not_string", withField(listBase(), "price", 250000), "amount_not_string"),
    inv("price_non_numeric", withField(listBase(), "price", "12a"), "amount_not_u128"),
    inv("price_negative", withField(listBase(), "price", "-1"), "amount_not_u128"),
    inv("max_evals_0", withField(listBase(), "max_evals", 0), "max_evals_range"),
    inv("max_evals_501", withField(listBase(), "max_evals", 501), "max_evals_range"),
    inv("mode_unknown", withField(listBase(), "mode", "full"), "mode_unknown"),
    inv("buyer_pk_compressed", withField(evalBase(), "buyer_pk", "02" + hex("buyer_pk_compressed", 32)), "buyer_pk_format"),
    inv("buyer_pk_0x", withField(evalBase(), "buyer_pk", "0x" + BUYER_PK), "buyer_pk_format"),
    inv("buyer_pk_upper", withField(evalBase(), "buyer_pk", "04" + BUYER_PK.slice(2).toUpperCase()), "buyer_pk_format"),
    inv("buyer_pk_not_04", withField(evalBase(), "buyer_pk", "05" + BUYER_PK.slice(2)), "buyer_pk_format"),
    inv("sealed_criteria_4141", withField(evalBase(), "sealed_criteria", b64("eval/sealed_criteria_max", SIZES.sealed_criteria_max_bytes) + "A"), "sealed_criteria_too_long"),
    inv("listing_id_negative", withField(buyBase(), "listing_id", -1), "listing_id_not_u64"),
    inv("listing_id_string", withField(buyBase(), "listing_id", "7"), "listing_id_not_u64"),
    inv("payout_bad", withField(listBase(), "payout", "Not A Valid!"), "payout_format"),
    inv("rows_claimed_negative", withField(listBase(), "rows_claimed", -5), "rows_claimed_not_u64"),
    inv("eval_fee_below_min", withField(listBase(), "eval_fee", "49999"), "eval_fee_below_min", "config"),
    inv("price_below_min", withField(listBase(), "price", "99999"), "price_below_min", "config"),
  ];
  return {
    version: 1,
    source: "DECISIONS.md H-06 (+ W1 encoding rules in fixtures/README.md)",
    limits: {
      title_max_chars: 80,
      public_desc_max_chars: 280,
      columns_max: 64,
      column_name_max_chars: 40,
      blob_url_max_chars: 200,
      sealed_k_b64_len: SIZES.sealed_k_b64,
      sealed_criteria_b64_max: SIZES.sealed_criteria_b64_max,
      buyer_pk_hex_len: 130,
      max_evals_min: 1,
      max_evals_max: 500,
      config_min_eval_fee: "50000",
      config_min_price: "100000",
    },
    payout_format: {
      intents_evm: "^0x[0-9a-f]{40}$",
      near_account: "^(([a-z\\d]+[-_])*[a-z\\d]+\\.)*([a-z\\d]+[-_])*[a-z\\d]+$",
      near_account_len: [2, 64],
      absent: "seller = sender_id",
    },
    valid,
    invalid,
  };
}

function inputVectors(): Obj {
  const listing = (mode: string): Obj => ({
    id: 7,
    seller: SELLER,
    blob_url: BLOB_URL,
    blob_sha256: SHA,
    sealed_k: SEALED_K,
    mode,
    columns: [...COLUMNS],
  });
  const evalIn = (): Obj => ({
    id: 42,
    sealed_criteria: b64("input/sealed_criteria", 97 + 400),
    buyer_pk: BUYER_PK,
    seed: hex("input/seed", 32),
  });
  const evalScored = (): Obj => ({ v: 1, action: "eval", listing: listing("scored"), eval: evalIn() });
  const release = (): Obj => ({ v: 1, action: "release", listing: listing("scored"), release: { id: 3, buyer_pk: BUYER_PK } });
  const bad = (name: string, input: Json): Obj => ({ name, input, expect: "ok_false" });
  return {
    version: 1,
    max_input_bytes: 32768,
    note: "Shape vectors. Ciphertexts are filler bytes of the right length, so an enclave run on a valid vector still ends in ok:false at decryption; round-trip crypto vectors live in ecies-vectors.json (WS-4).",
    valid: [
      { name: "eval_scored", input: evalScored() },
      { name: "eval_verdict", input: { ...evalScored(), listing: listing("verdict") } },
      { name: "release", input: release() },
      { name: "derive", input: { v: 1, action: "derive" } },
    ],
    invalid: [
      bad("v2", { ...evalScored(), v: 2 }),
      bad("unknown_action", { ...evalScored(), action: "delete" }),
      bad("eval_missing_seed", { ...evalScored(), eval: without(evalIn(), "seed") }),
      bad("eval_seed_63hex", { ...evalScored(), eval: { ...evalIn(), seed: hex("input/seed", 32).slice(0, 63) } }),
      bad("buyer_pk_compressed", { ...evalScored(), eval: { ...evalIn(), buyer_pk: "02" + hex("buyer_pk_compressed", 32) } }),
      bad("blob_sha_upper", { ...evalScored(), listing: { ...listing("scored"), blob_sha256: SHA.toUpperCase() } }),
      { name: "not_json", input_raw: '{"v":1,"action":', expect: "ok_false" },
      { name: "empty_input", input_raw: "", expect: "ok_false" },
      bad("release_missing_buyer_pk", { ...release(), release: { id: 3 } }),
      bad("release_listing_missing_seller", { ...release(), listing: without(listing("scored"), "seller") }),
    ],
  };
}

function outputVectors(): Obj {
  const r = b64("output/r", SIZES.r_bytes);
  const k = b64("output/k", SIZES.k_bytes);
  const ok = (body: string) => `{"v":1,"ok":true,${body}}`;
  const evalCtx: Obj = { action: "eval", listing_blob_sha256: SHA };
  const relCtx: Obj = { action: "release", listing_blob_sha256: SHA };
  const derCtx: Obj = { action: "derive", listing_blob_sha256: null };
  const c = (name: string, raw: string, context: Obj, contract_decision: string): Obj => ({ name, raw, context, contract_decision });
  const overR = "A".repeat(901 - ok(`"r":"","h":"${SHA}"`).length);
  return {
    version: 1,
    max_bytes: 900,
    target_bytes: 400,
    note: "raw = the exact bytes the callback reads (utf8). Field order is fixed and there is no trailing newline. Only accept_* cases are valid ArrowOut.",
    cases: [
      c("eval_ok", ok(`"r":"${r}","h":"${SHA}"`), evalCtx, "accept_eval"),
      c("release_ok", ok(`"k":"${k}","h":"${SHA}"`), relCtx, "accept_release"),
      c("derive_ok", ok(`"pk":"${pk("output/program_pk")}"`), derCtx, "accept_derive"),
      c("not_ok", '{"v":1,"ok":false}', evalCtx, "refund:not_ok"),
      c("release_not_ok", '{"v":1,"ok":false}', relCtx, "refund:not_ok"),
      c("derive_not_ok", '{"v":1,"ok":false}', derCtx, "reject_derive"),
      c("null", "null", evalCtx, "refund:null"),
      c("text_string", '"hello"', evalCtx, "refund:bad_output"),
      c("eval_missing_h", ok(`"r":"${r}"`), evalCtx, "refund:bad_output"),
      c("eval_hash_mismatch", ok(`"r":"${r}","h":"${hex("output/other_blob", 32)}"`), evalCtx, "refund:hash_mismatch"),
      c("eval_r_wrong_len", ok(`"r":"${b64("output/r_short", 96)}","h":"${SHA}"`), evalCtx, "refund:bad_output"),
      c("eval_extra_field", ok(`"r":"${r}","h":"${SHA}","x":1`), evalCtx, "refund:bad_output"),
      c("eval_v2", `{"v":2,"ok":true,"r":"${r}","h":"${SHA}"}`, evalCtx, "refund:bad_output"),
      c("release_k_wrong_len", ok(`"k":"${b64("output/k_short", 126)}","h":"${SHA}"`), relCtx, "refund:bad_output"),
      c("derive_pk_compressed", ok(`"pk":"02${hex("output/program_pk_c", 32)}"`), derCtx, "reject_derive"),
      c("over_900_bytes", ok(`"r":"${overR}","h":"${SHA}"`), evalCtx, "refund:bad_output"),
    ],
  };
}

function stateIndexVectors(): Obj {
  const scored: Obj[] = [];
  for (const verdict of ["PASS", "BUY"])
    for (let fit = 1; fit <= 5; fit++)
      for (let novelty = 1; novelty <= 5; novelty++)
        scored.push({ verdict, fit, novelty, idx: (verdict === "BUY" ? 25 : 0) + (fit - 1) * 5 + (novelty - 1) });
  return {
    version: 1,
    formula: "idx = (verdict==BUY)*25 + (fit-1)*5 + (novelty-1)",
    scored,
    verdict_mode: [
      { verdict: "PASS", idx: 0 },
      { verdict: "BUY", idx: 1 },
    ],
    guard_tripped: { scored_idx: 0, verdict_idx: 0 },
    novelty_without_signature: 3,
    error_state: "ok:false output; not an index; counted as the 51st (scored) / 3rd (verdict) state",
    states: { scored: 51, verdict: 3 },
    bits_per_eval_milli: { scored: Math.ceil(1000 * Math.log2(51)), verdict: Math.ceil(1000 * Math.log2(3)) },
    result_plaintext_len: 1,
    result_ecies_len: SIZES.r_bytes,
  };
}

function criteriaVectors(): Obj {
  const minhash = hex("criteria/minhash", 1024); // 128 x 16 hex
  const text600 = "Need daily retail units by SKU and region for 2025 with prices; ".repeat(10).slice(0, 600);
  const full = (): Obj => ({
    v: 1,
    required_columns: ["date", "region", "sku", "units"],
    min_rows: 10000,
    date_column: "date",
    date_from: "2025-01-01",
    date_to: "2025-12-31",
    max_null_rate: 0.05,
    key_column: "sku",
    text: "Daily retail units by SKU and region for 2025.",
    min_fit: 4,
    min_novelty: 3,
  });
  return {
    version: 1,
    schema: "criteria-schema.json",
    max_bytes: 2975,
    byte_count: "Buffer.byteLength(JSON.stringify(criteria)) (minified UTF-8)",
    valid: [
      { name: "demo_min", criteria: { v: 1, text: "Daily retail sales with region and SKU." } },
      { name: "demo_full_no_minhash", criteria: full() },
      { name: "with_minhash_600_ascii_text", criteria: { ...full(), text: text600, minhash } },
    ],
    invalid: [
      { name: "text_601", criteria: { v: 1, text: text600 + "x" }, reason: "text_too_long" },
      { name: "minhash_2032", criteria: { ...full(), minhash: minhash.slice(0, 2032) }, reason: "minhash_format" },
      { name: "minhash_upper", criteria: { ...full(), minhash: minhash.toUpperCase() }, reason: "minhash_format" },
      { name: "min_fit_6", criteria: { ...full(), min_fit: 6 }, reason: "min_fit_range" },
      { name: "extra_field", criteria: { ...full(), budget: 5 }, reason: "unknown_field" },
      { name: "too_large", criteria: { ...full(), text: "ç".repeat(600), minhash }, reason: "criteria_too_large" },
    ],
  };
}

export function fixtureFiles(): Record<string, string> {
  const out = (o: Obj) => JSON.stringify(o, null, 2) + "\n";
  return {
    "msg-vectors.json": out(msgVectors()),
    "input-vectors.json": out(inputVectors()),
    "output-vectors.json": out(outputVectors()),
    "state-index-vectors.json": out(stateIndexVectors()),
    "criteria-vectors.json": out(criteriaVectors()),
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const [file, content] of Object.entries(fixtureFiles())) {
    const path = resolve(FIXTURES, file);
    if (!check) {
      writeFileSync(path, content);
      console.log(`wrote fixtures/${file}`);
      continue;
    }
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current === content) console.log(`${file}: OK (byte-identical)`);
    else {
      console.error(`${file}: DIFFERS from the generator`);
      bad++;
    }
  }
  if (bad) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
