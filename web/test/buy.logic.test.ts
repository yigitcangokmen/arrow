import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, publicKeyHex, scalarFromLabel, seal, sha256Hex } from "@arrow/sdk/crypto";
import { decodeEvalResult } from "@arrow/sdk/flows";
import { signature, signatureHex } from "@arrow/sdk/minhash";
import { Criteria, EvalMsg } from "@arrow/sdk/schemas";
import { decodeState } from "@arrow/sdk/state";
import { buildEvalMsg, BuyInputError, criteriaFromForm, downloadCiphertext, downloadName, EMPTY_CRITERIA, keysFromText, ownListSignature, type CriteriaFormState } from "../lib/buy.ts";
import { hashCheck } from "../lib/hashes.ts";

const COLUMNS = ["token_contract", "unlock_date", "unlock_amount", "pct_of_supply"];
const programScalar = scalarFromLabel("arrow:test:program:v1");
const programPk = publicKeyHex(programScalar);
const buyerScalar = scalarFromLabel("arrow:test:buyer:v1");
const buyerPk = publicKeyHex(buyerScalar);
const form = (o: Partial<CriteriaFormState> = {}): CriteriaFormState => ({ ...EMPTY_CRITERIA, text: "Q1 2027 unlock schedule", ...o });
const fails = (fn: () => unknown, re: RegExp) => {
  expect(fn).toThrow(BuyInputError);
  expect(fn).toThrow(re);
};

describe("criteriaFromForm", () => {
  it("builds a minimal Criteria with the defaults min_fit 4 and min_novelty 3", () => {
    const c = criteriaFromForm(form(), COLUMNS);
    expect(c).toEqual({ v: 1, text: "Q1 2027 unlock schedule", min_fit: 4, min_novelty: 3 });
    expect(() => Criteria.parse(c)).not.toThrow();
  });

  it("builds the full form and matches the fixture shape", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/criteria/demo.json", import.meta.url), "utf8"));
    const sig = fixture.minhash as string;
    const c = criteriaFromForm(
      form({ requiredColumns: ["token_contract", "unlock_date"], minRows: "300", dateColumn: "unlock_date", dateFrom: "2027-01-01", dateTo: "2027-03-31", maxNullRate: "0.1", keyColumn: "token_contract", minhash: sig }),
      COLUMNS,
    );
    expect(c).toMatchObject({ v: 1, required_columns: ["token_contract", "unlock_date"], min_rows: 300, date_column: "unlock_date", date_from: "2027-01-01", date_to: "2027-03-31", max_null_rate: 0.1, key_column: "token_contract", minhash: sig });
    expect(Object.keys(c).filter((k) => !(k in fixture))).toEqual(["max_null_rate"]);
  });

  it("rejects what the enclave would reject, with advice", () => {
    fails(() => criteriaFromForm(form({ requiredColumns: ["nope"] }), COLUMNS), /not a column/);
    fails(() => criteriaFromForm(form({ dateFrom: "2027-01-01" }), COLUMNS), /date column/);
    fails(() => criteriaFromForm(form({ minhash: "a".repeat(2048) }), COLUMNS), /key column/);
    fails(() => criteriaFromForm(form({ minRows: "-1" }), COLUMNS), /Minimum rows/);
    fails(() => criteriaFromForm(form({ minRows: "1.5" }), COLUMNS), /Minimum rows/);
    fails(() => criteriaFromForm(form({ maxNullRate: "2" }), COLUMNS), /between 0 and 1/);
    fails(() => criteriaFromForm(form({ text: "x".repeat(601) }), COLUMNS), /600 characters/);
    fails(() => criteriaFromForm(form({ dateColumn: "unlock_date", dateFrom: "01/01/2027" }), COLUMNS), /date_from/);
  });

  it("flags a request over the 2975-byte criteria limit as too large", () => {
    const sig = signatureHex(signature(["a", "b"]));
    fails(() => criteriaFromForm(form({ keyColumn: "token_contract", minhash: sig, text: "é".repeat(600) }), COLUMNS), /too large/);
  });
});

describe("sealed criteria length", () => {
  it("a minimal request with a MinHash stays under 4140 base64 characters", () => {
    const sig = signatureHex(signature(Array.from({ length: 50 }, (_, i) => `0xkey${i}`)));
    const criteria = criteriaFromForm(form({ keyColumn: "token_contract", minhash: sig, text: "t".repeat(300) }), COLUMNS);
    const msg = EvalMsg.parse(JSON.parse(buildEvalMsg({ listingId: 3, criteria, buyerPk, programPk })));
    expect(msg.sealed_criteria.length).toBeLessThanOrEqual(4140);
    expect(msg).toMatchObject({ op: "eval", listing_id: 3, buyer_pk: buyerPk });
  });
  it("turns an oversize request into advice", () => {
    const criteria = { v: 1 as const, text: "é".repeat(600), minhash: "a".repeat(2048) };
    expect(() => buildEvalMsg({ listingId: 1, criteria, buyerPk, programPk })).toThrow(/too large to seal|4140/);
  });
});

describe("keysFromText", () => {
  it("reads a named CSV column or one key per line", () => {
    expect(keysFromText("addr,x\n0xA,1\n0xB,2\n", "addr")).toEqual(["0xA", "0xB"]);
    expect(keysFromText("0xA\r\n\r\n 0xB \n")).toEqual(["0xA", "0xB"]);
  });
  it("X12-U4: matches the column the way the enclave does (case, NFKC, spaces)", () => {
    expect(keysFromText("customer_id,name\nC-1,A\nC-2,B\n", "Customer_ID")).toEqual(["C-1", "C-2"]);
    expect(keysFromText("Mu\u0308s\u0327teri No,x\nA,1\n", "M\u00fc\u015fteri  no")).toEqual(["A"]); // NFD header, NFC selection, two spaces
  });
  it("QA-05 / X12-U4: a multi-field list without the chosen column is an error, not whole lines", () => {
    expect(() => keysFromText("addr,x\n0xA,1\n", "missing")).toThrow(BuyInputError);
    expect(() => keysFromText("addr,x\n0xA,1\n", "missing")).toThrow(/no column "missing"/);
  });
  it("a one-column list is still read line by line", () => {
    expect(keysFromText("0xA\n0xB\n", "addr")).toEqual(["0xA", "0xB"]);
  });
});

describe("ownListSignature", () => {
  it("is recomputed from the key column: whole-line hashing (no column) differs from the chosen column", () => {
    const csv = "wallet,label\na,b\nc,d\n";
    expect(ownListSignature(csv, "wallet")?.hex).not.toEqual(ownListSignature(csv, "label")?.hex);
    expect(() => ownListSignature(csv, "account_id")).toThrow(BuyInputError);
    expect(ownListSignature(csv, "wallet")?.keys).toBe(2);
    expect(ownListSignature("\n\n", "wallet")).toBeNull();
  });
});

describe("downloadCiphertext (WEB-5)", () => {
  it("stops reading an endless body after the cap and reports it, instead of buffering", async () => {
    let chunks = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        chunks++;
        c.enqueue(new Uint8Array(65_536));
      },
    });
    const res = await downloadCiphertext("https://host.example/x.bin", "ab".repeat(32), (async () => new Response(endless, { status: 200 })) as never);
    expect(res).toEqual({ kind: "too-large" });
    expect(chunks).toBeLessThanOrEqual(5 * 16 + 4); // 5 MiB in 64 KiB chunks, plus what the stream pre-pulled
  });
  it("a wrong body gives the hash we got; a network failure means choose the file yourself", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const mismatch = await downloadCiphertext("https://h/x", "ab".repeat(32), (async () => new Response(bytes)) as never);
    expect(mismatch).toMatchObject({ kind: "mismatch", actual: sha256Hex(bytes) });
    expect(await downloadCiphertext("https://h/x", "ab".repeat(32), (async () => { throw new TypeError("blocked by CORS"); }) as never)).toEqual({ kind: "manual" });
    expect(await downloadCiphertext("https://h/x", sha256Hex(bytes), (async () => new Response(bytes)) as never)).toMatchObject({ kind: "ok" });
  });
});

describe("decoding the verdict", () => {
  const sealOne = (idx: number) => b64.enc(seal(buyerPk, Uint8Array.of(idx)));
  it("decodes all 50 scored states and both verdict states from a sealed byte", () => {
    const vectors = JSON.parse(readFileSync(new URL("../../fixtures/state-index-vectors.json", import.meta.url), "utf8"));
    expect(vectors.scored).toHaveLength(50);
    for (const v of vectors.scored) {
      expect(decodeEvalResult(sealOne(v.idx), buyerScalar, "scored")).toEqual({ verdict: v.verdict, fit: v.fit, novelty: v.novelty });
    }
    expect(decodeState(0, "scored")).toEqual({ verdict: "PASS", fit: 1, novelty: 1 });
    expect(decodeEvalResult(sealOne(0), buyerScalar, "verdict")).toEqual({ verdict: "PASS" });
    expect(decodeEvalResult(sealOne(1), buyerScalar, "verdict")).toEqual({ verdict: "BUY" });
  });
  it("refuses a result that is not one byte", () => {
    expect(() => decodeEvalResult(b64.enc(seal(buyerPk, Uint8Array.of(1, 2))), buyerScalar, "scored")).toThrow(/1 byte/);
  });
});

describe("hashCheck", () => {
  const H = "ab".repeat(32);
  const X = "cd".repeat(32);
  it("matches when every present row equals the chain hash", () => {
    const r = hashCheck({ onChain: H, evalH: H, releaseH: H, downloaded: H });
    expect(r.match).toBe(true);
    expect(r.rows.map((x) => x.state)).toEqual(["ok", "ok", "ok", "ok"]);
  });
  it("names the row that differs", () => {
    expect(hashCheck({ onChain: H, evalH: H, releaseH: X, downloaded: H })).toMatchObject({ match: false, mismatched: ["release h (enclave, from the release output)"] });
    expect(hashCheck({ onChain: H, evalH: H, downloaded: X }).mismatched).toEqual(["sha256(downloaded blob)"]);
  });
  it("is pending, not matching, while a hash is missing", () => {
    const r = hashCheck({ onChain: H, evalH: H, releaseH: null, downloaded: null });
    expect(r.match).toBe(false);
    expect(r.mismatched).toEqual([]);
    expect(r.rows.map((x) => x.state)).toEqual(["ok", "ok", "pending", "pending"]);
    expect(hashCheck({ onChain: H, downloaded: H }).rows).toHaveLength(2);
  });
});

describe("downloadName", () => {
  it("picks the extension from the first character", () => {
    expect(downloadName(4, new TextEncoder().encode('{"a":1}'))).toBe("arrow-listing-4.jsonl");
    expect(downloadName(4, new TextEncoder().encode("a,b\n1,2"))).toBe("arrow-listing-4.csv");
  });
});
