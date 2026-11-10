// WS4-T01 acceptance: the zod schemas against the shared vectors in fixtures/.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ApiError, ArrowMsg, ArrowOut, Criteria, criteriaBytes, EvidenceFile, LeakBudget, Listing, parseArrowOut,
  RelayRequest, SponsorRequest,
} from "../src/index.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const load = (f: string) => JSON.parse(readFileSync(resolve(FIX, f), "utf8"));
const msgVectors = load("msg-vectors.json");
const asText = (c: any): string => (c.msg_raw !== undefined ? c.msg_raw : JSON.stringify(c.msg));

// First path element the zod issue must point at (null = object-level issue) per fixture `reason`.
const REASON_PATH: Record<string, string | null> = {
  missing_op: "op", unknown_op: "op", unknown_field: null,
  title_too_long: "title", title_empty: "title", desc_too_long: "public_desc",
  columns_too_many: "columns", column_name_too_long: "columns", columns_empty: "columns",
  blob_url_not_https: "blob_url", blob_url_too_long: "blob_url", blob_url_whitespace: "blob_url",
  blob_sha256_format: "blob_sha256", sealed_k_not_b64: "sealed_k", sealed_k_wrong_len: "sealed_k",
  amount_not_string: "price", amount_not_u128: "price", max_evals_range: "max_evals", mode_unknown: "mode",
  buyer_pk_format: "buyer_pk", sealed_criteria_too_long: "sealed_criteria", listing_id_not_u64: "listing_id",
  payout_format: "payout", rows_claimed_not_u64: "rows_claimed",
};

describe("msg vectors", () => {
  it("msg_vectors_valid_parse", () => {
    expect(msgVectors.valid.length).toBeGreaterThan(5);
    for (const c of msgVectors.valid) {
      const input = JSON.parse(asText(c));
      const out = ArrowMsg.parse(input);
      expect(Object.keys(out).sort(), c.name).toEqual(Object.keys(input).sort());
      expect(JSON.parse(JSON.stringify(out)), c.name).toEqual(input);
    }
  });

  it("msg_vectors_invalid_reject", () => {
    let checked = 0;
    for (const c of msgVectors.invalid.filter((x: any) => x.stage === "parse")) {
      let input: unknown;
      try {
        input = JSON.parse(asText(c));
      } catch {
        expect(c.reason, c.name).toBe("not_json");
        checked++;
        continue;
      }
      const r = ArrowMsg.safeParse(input);
      expect(r.success, `${c.name} must be rejected`).toBe(false);
      if (r.success) continue;
      const want = REASON_PATH[c.reason];
      expect(want !== undefined, `no path mapping for ${c.reason}`).toBe(true);
      const first = r.error.issues.map((i) => i.path[0] ?? null);
      expect(first, `${c.name}: issue path`).toContain(want);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it("config-stage cases are valid for the schema (the contract rejects them against its config)", () => {
    const config = msgVectors.invalid.filter((x: any) => x.stage === "config");
    expect(config.length).toBe(2);
    for (const c of config) expect(ArrowMsg.safeParse(JSON.parse(asText(c))).success, c.name).toBe(true);
  });
});

describe("output vectors", () => {
  const cases = load("output-vectors.json").cases as { name: string; raw: string; contract_decision: string }[];

  it("output_vectors_parse_and_le_900", () => {
    const accepted = cases.filter((c) => c.contract_decision.startsWith("accept_"));
    expect(accepted.map((c) => c.name).sort()).toEqual(["derive_ok", "eval_ok", "release_ok"]);
    for (const c of accepted) {
      expect(Buffer.byteLength(c.raw), c.name).toBeLessThanOrEqual(900);
      expect(() => parseArrowOut(c.raw), c.name).not.toThrow();
    }
  });

  it("ok:false outputs parse as ErrOut", () => {
    for (const c of cases.filter((x) => x.name.endsWith("not_ok"))) expect(ArrowOut.parse(JSON.parse(c.raw)), c.name).toEqual({ v: 1, ok: false });
  });

  it("malformed outputs are rejected", () => {
    const bad = ["null", "text_string", "eval_missing_h", "eval_r_wrong_len", "eval_extra_field", "eval_v2", "release_k_wrong_len", "derive_pk_compressed", "over_900_bytes"];
    for (const name of bad) {
      const c = cases.find((x) => x.name === name)!;
      expect(() => parseArrowOut(c.raw), name).toThrow();
    }
  });

  it("a hash mismatch is well-formed; only the contract compares h with the listing", () => {
    const c = cases.find((x) => x.name === "eval_hash_mismatch")!;
    expect(() => parseArrowOut(c.raw)).not.toThrow();
  });
});

describe("criteria", () => {
  const vectors = load("criteria-vectors.json");

  it("criteria_fixture_examples", () => {
    expect(vectors.max_bytes).toBe(2975);
    for (const c of vectors.valid) {
      expect(Criteria.safeParse(c.criteria).success, c.name).toBe(true);
      expect(criteriaBytes(c.criteria), c.name).toBeLessThanOrEqual(2975);
    }
    for (const c of vectors.invalid) expect(Criteria.safeParse(c.criteria).success, c.name).toBe(false);
  });

  it("too-large criteria say how to fix it", () => {
    const big = vectors.invalid.find((c: any) => c.name === "too_large");
    const r = Criteria.safeParse(big.criteria);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain("criteria too large: shorten text");
  });
});

describe("views and API shapes", () => {
  it("accepts a contract Listing and keeps unknown fields", () => {
    const l = msgVectors.valid[0].msg;
    const view = {
      id: 1, seller: "a.testnet", payout: "a.testnet", title: l.title, public_desc: l.public_desc, columns: l.columns,
      rows_claimed: l.rows_claimed, blob_url: l.blob_url, blob_sha256: l.blob_sha256, sealed_k: l.sealed_k,
      price: l.price, eval_fee: l.eval_fee, max_evals: l.max_evals, evals_used: 0, bits_per_eval_milli: 5673,
      mode: l.mode, program_hash_at_list: "x", created_at_ns: 1762762000000000000, future_field: true,
    };
    expect(Listing.parse(view).future_field).toBe(true);
  });

  it("LeakBudget matches the WS-2 example (50 evals scored: budget 283650)", () => {
    const lb = { listing_id: 1, bits_per_eval_milli: 5673, max_evals: 50, evals_used: 3, budget_milli: 283650, spent_milli: 17019, left_milli: 266631 };
    expect(LeakBudget.parse(lb).left_milli).toBe(lb.budget_milli - lb.spent_milli);
  });

  it("relay, sponsor and error shapes", () => {
    const mp = { standard: "erc191", payload: "{}", signature: "secp256k1:abc" };
    expect(RelayRequest.safeParse({ multipayload: mp }).success).toBe(true);
    expect(RelayRequest.safeParse({ multipayload: { ...mp, standard: "nep413" } }).success).toBe(false);
    expect(SponsorRequest.safeParse({ publicKey: "ed25519:" + "1".repeat(44) }).success).toBe(true);
    expect(SponsorRequest.safeParse({ publicKey: "nope" }).success).toBe(false);
    expect(ApiError.safeParse({ error: "slow down", code: "RATE_LIMITED" }).success).toBe(true);
    expect(ApiError.safeParse({ error: "x", code: "rate-limited" }).success).toBe(false);
  });

  it("EvidenceFile accepts the checked-in skeletons", () => {
    for (const f of ["testnet.json", "mainnet.json"]) {
      expect(EvidenceFile.safeParse(JSON.parse(readFileSync(resolve(FIX, "../evidence", f), "utf8"))).success, f).toBe(true);
    }
  });
});

describe("X12-U3 / X12-U7 / X12-2 / SCAM-6: ListMsg refuses what the contract's validate_list refuses", () => {
  const base = JSON.parse(asText(msgVectors.valid.find((x: any) => JSON.parse(asText(x)).op === "list")));
  const smile = "\u{1F600}";
  const bad: [string, Record<string, unknown>][] = [
    ["LF in public_desc", { public_desc: "line one\nline two" }],
    ["tab in a column", { columns: ["a\tb"] }],
    ["RLO in title", { title: "invoice‮txt.exe" }],
    ["tag character in a column", { columns: ["sku\u{E0041}"] }],
    ["zero-width space in title", { title: "re​tail" }],
    ["EVENT_JSON in title", { title: "EVENT_JSON:{}" }],
    ["80 emoji title (320 bytes)", { title: smile.repeat(80) }],
    ["64 columns of 40 emoji", { columns: Array.from({ length: 64 }, () => smile.repeat(40)) }],
    ["bare lowercased Solana payout", { payout: "9wzdxwbbmkg8ztbnmquxvqrayrzzdsgydlvl9zytawwm" }],
    ["payout to intents.near", { payout: "intents.near" }],
    ["eval fee above the price", { price: "100000", eval_fee: "200000" }],
    ["rows_claimed over 200000", { rows_claimed: 200001 }],
  ];
  it("refuses each case", () => {
    for (const [name, over] of bad) expect(ArrowMsg.safeParse({ ...base, ...over }).success, name).toBe(false);
  });
  it("keeps ZWJ emoji, named and 0x payouts, and an eval fee equal to the price", () => {
    for (const over of [{ title: "family \u{1F468}‍\u{1F469}‍\u{1F467} data" }, { payout: "seller.near" }, { payout: "0x" + "a".repeat(40) }, { eval_fee: base.price }]) {
      expect(ArrowMsg.safeParse({ ...base, ...over }).success, JSON.stringify(over)).toBe(true);
    }
  });
});
