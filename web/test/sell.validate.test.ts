import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, decryptFile, encryptFile, publicKeyHex, scalarFromLabel, sha256Hex, unseal } from "@arrow/sdk/crypto";
import { ListMsg } from "@arrow/sdk/schemas";
import {
  budgetPreview, buildListMsg, checkBlobUrl, columnsBytes, columnsFromHeader, csvRecords, fileKind, fullTitle, inspectFile, listShaOf, MAX_PLAINTEXT_BYTES, normalizePayout, prefixesFor,
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
    expect(budgetPreview(50, "scored")).toBe("50 inspections × 5.673 bits = 283.65 bits");
    expect(budgetPreview(10, "verdict")).toBe("10 inspections × 1.585 bits = 15.85 bits");
  });
  it("NUM-1: the printed factor times the count is the printed total, for every count and both modes", () => {
    for (const mode of ["scored", "verdict"] as const) {
      for (let n = 1; n <= 500; n++) {
        const m = /^(\d+) inspections × ([\d.]+) bits = ([\d.]+) bits$/.exec(budgetPreview(n, mode))!;
        const totalMilli = BigInt(m[1]!) * BigInt(Math.round(Number(m[2]) * 1000)); // exact: the factor has three decimals
        expect(Number((totalMilli + 5n) / 10n) / 100, `${n} ${mode}`).toBe(Number(m[3]));
      }
    }
  });
  it("QA / A11Y-5: a rejected field is named, so the form can mark and focus it", () => {
    const bad = (o: Partial<SellFields>) => {
      try {
        validateFields(fields(o));
      } catch (e) {
        return (e as SellInputError).field;
      }
    };
    expect(bad({ price: "0.05" })).toBe("price");
    expect(bad({ evalFee: "0.01" })).toBe("fee");
    expect(bad({ title: "  " })).toBe("title");
    expect(bad({ publicDesc: "x".repeat(281) })).toBe("desc");
    expect(bad({ maxEvals: 0 })).toBe("max");
  });
  it("SCAM-2: only a team account is offered the [team-made] label", () => {
    expect(prefixesFor(false)).toEqual(["", "[synthetic]"]);
    expect(prefixesFor(true)).toContain("[team-made]");
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

describe("web halves of the contract's list rules (SCAM-6, X12-U3, X12-U7, X12-2)", () => {
  const bad = (o: Partial<SellFields>) => {
    try {
      validateFields(fields(o));
    } catch (e) {
      return e as SellInputError;
    }
    return null;
  };
  it("SCAM-6: the inspection fee cannot be higher than the price", () => {
    expect(bad({ price: "0.25", evalFee: "0.26" })?.field).toBe("fee");
    expect(bad({ price: "0.25", evalFee: "0.25" })).toBeNull();
  });
  it("X12-U3: a line break or tab in the title, description or a column is named before the bond is paid", () => {
    expect(bad({ publicDesc: "a\nb" })).toMatchObject({ field: "desc", message: expect.stringMatching(/line break/) });
    expect(bad({ title: "a\tb" })?.field).toBe("title");
    expect(bad({ columns: ["ok", "a\tb"] })?.field).toBe("file");
  });
  it("X12-U7: invisible and text-direction characters are refused, a zero-width joiner is not", () => {
    for (const c of ["‮", "⁦", "​", "‏", "؜", "﻿", "\u{E0041}"]) expect(bad({ title: `a${c}b` })?.field, JSON.stringify(c)).toBe("title");
    expect(bad({ title: "family \u{1F468}‍\u{1F469}" })).toBeNull();
  });
  it("byte limits: title 240, description 840, columns 2560 counted as JSON-escaped strings", () => {
    expect(bad({ prefix: "", title: "\u{1F600}".repeat(61) })?.message).toMatch(/title/); // 61 chars is fine, 244 bytes is not
    expect(bad({ publicDesc: "\u{1F600}".repeat(211) })?.message).toMatch(/840/);
    expect(columnsBytes(['a"b', "c\\d"])).toBe(3 + 1 + 3 + 1);
    expect(columnsBytes(Array(64).fill("\u{1F600}".repeat(10)))).toBe(64 * 40);
    expect(bad({ columns: Array(64).fill("\u{1F600}".repeat(10)) })).toBeNull(); // exactly 2560 bytes is allowed
    expect(bad({ columns: [...Array(63).fill("\u{1F600}".repeat(10)), "\u{1F600}".repeat(10) + "\""] })?.field).toBe("file"); // one escaped quote more
  });
  it("X12-2: a Solana address is not a payout; NEAR ids are not lowercased; EIP-55 is enforced on mixed case", () => {
    expect(() => normalizePayout("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toThrow(SellInputError);
    expect(normalizePayout("Alice.near".toLowerCase())).toBe("alice.near");
    expect(() => normalizePayout("Alice.near")).toThrow(SellInputError); // uppercase is not a NEAR id; it is not silently changed
    expect(normalizePayout("0xb5ef360e42056049f584fd03bf0fb9b208e28387")).toBe("0xb5ef360e42056049f584fd03bf0fb9b208e28387");
    const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(normalizePayout(checksummed)).toBe(checksummed.toLowerCase());
    expect(() => normalizePayout("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toThrow(/checksum/);
    expect(normalizePayout("ab".repeat(32))).toBe("ab".repeat(32));
    expect(() => normalizePayout("arrow-market.near", "arrow-market.near")).toThrow(/market/);
    expect(bad({ payout: "9wzdxwbbmkg8ztbnmquxvqrayrzzdsgydlvl9zytawwm" })?.field).toBe("payout");
  });
});

describe("listShaOf (reload after an unclear bond payment)", () => {
  it("reads blob_sha256 out of the stored signed list payment", () => {
    const sha = "ab".repeat(32);
    const payload = JSON.stringify({ intents: [{ intent: "transfer", msg: JSON.stringify({ op: "list", blob_sha256: sha }) }] });
    expect(listShaOf({ payload })).toBe(sha);
    expect(listShaOf({ payload: JSON.stringify({ intents: [{ msg: JSON.stringify({ op: "eval" }) }] }) })).toBeNull();
    expect(listShaOf({ payload: "nope" })).toBeNull();
  });
});
