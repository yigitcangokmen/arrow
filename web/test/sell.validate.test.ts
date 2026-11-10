import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, decryptFile, encryptFile, publicKeyHex, scalarFromLabel, sha256Hex, unseal } from "@arrow/sdk/crypto";
import { ListMsg } from "@arrow/sdk/schemas";
import {
  budgetPreview, buildListMsg, checkBlobUrl, columnsFromHeader, csvRecords, fileKind, fullTitle, inspectFile, MAX_PLAINTEXT_BYTES,
  SellInputError, validateFields, type SellFields,
} from "../lib/sell.ts";

const msgVectors = JSON.parse(readFileSync(new URL("../../fixtures/msg-vectors.json", import.meta.url), "utf8"));
const programScalar = scalarFromLabel("arrow:test:program:v1");
const programPk = publicKeyHex(programScalar);

const fields = (o: Partial<SellFields> = {}): SellFields => ({
  prefix: "[synthetic]", title: "Wallet labels", publicDesc: "Synthetic wallet labels.", columns: ["account_id", "label"], rowsClaimed: 2,
  price: "0.25", evalFee: "0.10", maxEvals: 50, mode: "scored", ...o,
});
const fails = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(re);

describe("columnsFromHeader", () => {
  it("reads a plain header", () => {
    expect(columnsFromHeader("a,b,c\n1,2,3\n")).toEqual(["a", "b", "c"]);
  });
  it("drops a BOM and handles quoted names with commas, quotes and CRLF", () => {
    expect(columnsFromHeader('﻿"last, first","say ""hi""",plain\r\n1,2,3\r\n')).toEqual(["last, first", 'say "hi"', "plain"]);
  });
  it("rejects 65 columns, a 41-character name and an empty file", () => {
    fails(() => columnsFromHeader(Array.from({ length: 65 }, (_, i) => `c${i}`).join(",")), /65 columns/);
    fails(() => columnsFromHeader(`${"x".repeat(41)},b`), /longer than 40/);
    columnsFromHeader(`${"x".repeat(40)},b`);
    fails(() => columnsFromHeader(""), /empty/);
    fails(() => columnsFromHeader("a,,c"), /empty/);
  });
  it("counts characters, not UTF-16 units", () => {
    columnsFromHeader(`${"😀".repeat(40)},b`);
    fails(() => columnsFromHeader(`${"😀".repeat(41)},b`), /longer than 40/);
  });
});

describe("inspectFile", () => {
  it("counts csv rows without the header and ignores empty lines and quoted newlines", () => {
    expect(inspectFile("csv", 'a,b\n1,"x\ny"\n\n2,3\n')).toEqual({ columns: ["a", "b"], rows: 2 });
    expect(csvRecords("a\n").length).toBe(1);
  });
  it("reads jsonl keys from the first line", () => {
    expect(inspectFile("jsonl", '{"id":1,"v":"a"}\n{"id":2}\n\n')).toEqual({ columns: ["id", "v"], rows: 2 });
    fails(() => inspectFile("jsonl", "[1,2]"), /JSON object/);
    fails(() => inspectFile("jsonl", "nope"), /not valid JSON/);
  });
  it("accepts only .csv and .jsonl", () => {
    expect(fileKind("Data.CSV")).toBe("csv");
    expect(fileKind("rows.jsonl")).toBe("jsonl");
    fails(() => fileKind("x.xlsx"), /\.csv or \.jsonl/);
  });
  it("leaves room for nonce and tag under the 5 MB blob cap", () => {
    expect(MAX_PLAINTEXT_BYTES).toBe(5 * 1024 * 1024 - 40);
  });
});

describe("validateFields", () => {
  it("accepts the defaults and the on-chain minimums", () => {
    validateFields(fields());
    validateFields(fields({ price: "0.1", evalFee: "0.05", maxEvals: 1 }));
  });
  it("rejects each bad field with a message", () => {
    fails(() => validateFields(fields({ title: "  " })), /Add a title/);
    fails(() => validateFields(fields({ title: "x".repeat(70) })), /limit is 80/);
    fails(() => validateFields(fields({ publicDesc: "x".repeat(281) })), /limit is 280/);
    fails(() => validateFields(fields({ maxEvals: 0 })), /between 1 and 500/);
    fails(() => validateFields(fields({ maxEvals: 501 })), /between 1 and 500/);
    fails(() => validateFields(fields({ price: "0.09" })), /at least 0.1 USDC/);
    fails(() => validateFields(fields({ evalFee: "0.049999" })), /at least 0.05 USDC/);
    fails(() => validateFields(fields({ price: "1e3" })), /up to 6 decimals/);
    fails(() => validateFields(fields({ price: "0.1234567" })), /up to 6 decimals/);
  });
  it("uses the limits read from the chain when given", () => {
    fails(() => validateFields(fields({ price: "0.25" }), { minPrice: 500_000n, minEvalFee: 50_000n }), /at least 0.5 USDC/);
  });
  it("builds the title with its prefix", () => {
    expect(fullTitle(fields())).toBe("[synthetic] Wallet labels");
    expect(fullTitle(fields({ prefix: "" }))).toBe("Wallet labels");
  });
});

describe("budgetPreview", () => {
  it("multiplies the per-eval bits of the mode", () => {
    expect(budgetPreview(50, "scored")).toBe("50 inspections × 5.67 bits = 283.65 bits");
    expect(budgetPreview(10, "verdict")).toBe("10 inspections × 1.59 bits = 15.85 bits");
  });
});

describe("buildListMsg", () => {
  const SELLER = "0x" + "5".repeat(40); // the wallet's Intents id (lowercase), the list payment's sender_id
  const plaintext = new TextEncoder().encode("account_id,label\na.near,x\nb.near,y\n");
  const make = (f = fields()) => {
    const enc = encryptFile(plaintext);
    const nonce = enc.blob.slice(0, 24);
    const keyCopy = enc.key.slice();
    const out = buildListMsg({ fields: f, plaintext, key: enc.key, nonce, blobUrl: "https://s.public.blob.vercel-storage.com/blobs/x.bin", programPk, seller: SELLER });
    return { enc, out, keyCopy };
  };

  it("builds a msg that ListMsg accepts, with the same keys as the shared vectors", () => {
    const { out } = make();
    const msg = ListMsg.parse(JSON.parse(out.msg));
    const vector = msgVectors.valid.find((v: { name: string }) => v.name === "list_scored_full").msg;
    expect(Object.keys(msg).filter((k) => k !== "payout").sort()).toEqual(Object.keys(vector).filter((k) => k !== "payout").sort());
    expect(msg).toMatchObject({ op: "list", title: "[synthetic] Wallet labels", price: "250000", eval_fee: "100000", max_evals: 50, mode: "scored", rows_claimed: 2 });
  });

  it("reproduces the uploaded ciphertext and seals K and its hash to the program key", () => {
    const { enc, out, keyCopy } = make();
    expect(out.blobSha256).toBe(enc.blobSha256);
    expect(sha256Hex(out.blob)).toBe(enc.blobSha256);
    const msg = ListMsg.parse(JSON.parse(out.msg));
    expect(msg.blob_sha256).toBe(enc.blobSha256);
    const payload = unseal(programScalar, b64.dec(msg.sealed_k));
    expect(Array.from(payload.subarray(0, 32))).toEqual(Array.from(keyCopy));
    expect(Buffer.from(payload.subarray(32, 64)).toString("hex")).toBe(enc.blobSha256);
    expect(Buffer.from(payload.subarray(64)).toString("hex")).toBe(sha256Hex(new TextEncoder().encode(SELLER)));
    expect(new TextDecoder().decode(decryptFile(out.blob, payload.subarray(0, 32)))).toBe(new TextDecoder().decode(plaintext));
    expect(JSON.stringify(msg)).not.toContain(Buffer.from(keyCopy).toString("hex"));
  });

  it("wipes the key it was given", () => {
    const { enc } = make();
    expect(Array.from(enc.key).every((b) => b === 0)).toBe(true);
  });

  it("carries payout only when set, and refuses a URL over 200 characters", () => {
    expect(JSON.parse(make().out.msg)).not.toHaveProperty("payout");
    expect(JSON.parse(make(fields({ payout: "0x" + "ab".repeat(20) })).out.msg).payout).toBe("0x" + "ab".repeat(20));
    const enc = encryptFile(plaintext);
    expect(() => buildListMsg({ fields: fields(), plaintext, key: enc.key, nonce: enc.blob.slice(0, 24), blobUrl: "https://x/" + "a".repeat(200), programPk, seller: SELLER })).toThrow();
  });
});

describe("checkBlobUrl", () => {
  it("accepts https and rejects http, spaces and long URLs", () => {
    expect(checkBlobUrl(" https://example.com/a.bin ")).toBe("https://example.com/a.bin");
    fails(() => checkBlobUrl("http://example.com/a.bin"), /https/);
    fails(() => checkBlobUrl("https://example.com/a b.bin"), /https/);
    fails(() => checkBlobUrl("https://e.com/" + "a".repeat(190)), /limit is 200/);
    expect(SellInputError.name).toBe("SellInputError");
  });
});
