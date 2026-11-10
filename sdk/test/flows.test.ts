// WS4-T07 acceptance: message flows, criteria sealing, result decoding, blob check and the typed views.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArrowMsg, ArrowViews, b64, BlobHashMismatch, bytesToHex, Criteria, CriteriaTooLarge, decodeEvalResult, decryptFile,
  fetchAndCheckBlob, MAX_BLOB_BYTES, openRelease, prepareBuy, prepareEval, prepareList, publicKeyHex, scalarFromLabel,
  seal, sealCriteria, sha256Hex, unseal,
} from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const programScalar = scalarFromLabel("arrow:test:program:v1");
const programPk = publicKeyHex(programScalar);
const buyerScalar = scalarFromLabel("arrow:test:buyer:v1");
const buyerPk = publicKeyHex(buyerScalar);
const plaintext = new TextEncoder().encode("id,label\n1,a\n2,b\n");

afterEach(() => vi.unstubAllGlobals());

describe("prepareList", () => {
  const list = () =>
    prepareList({
      plaintext, title: "Retail sales (synthetic)", publicDesc: "Daily units per SKU.", columns: ["id", "label"], rowsClaimed: 2,
      blobUrl: "https://blobs.example/x.bin", price: "250000", evalFee: "100000", mode: "scored", programPk,
    });

  it("prepare_list_zeroizes_key", () => {
    const out = list();
    expect(Object.keys(out).sort()).toEqual(["blob", "blobSha256", "msg"]);
    const msg = ArrowMsg.parse(JSON.parse(out.msg));
    if (msg.op !== "list") throw new Error("not a list msg");
    expect(msg.max_evals).toBe(50);
    expect(msg.blob_sha256).toBe(out.blobSha256);
    expect(sha256Hex(out.blob)).toBe(out.blobSha256);
    const payload = unseal(programScalar, b64.dec(msg.sealed_k));
    expect(payload.length).toBe(64);
    expect(bytesToHex(payload.subarray(32))).toBe(out.blobSha256);
    // the K inside sealed_k opens the blob, and K is not in the returned object
    expect(decryptFile(out.blob, payload.subarray(0, 32))).toEqual(plaintext);
    expect(JSON.stringify(out.msg)).not.toContain(bytesToHex(payload.subarray(0, 32)));
    expect(b64.dec(msg.sealed_k).length).toBe(161);
  });

  it("each listing gets a fresh key", () => {
    expect(list().blobSha256).not.toBe(list().blobSha256);
  });

  it("rejects an invalid field instead of building a bad msg", () => {
    expect(() => prepareList({ plaintext, title: "", publicDesc: "d", columns: ["a"], rowsClaimed: 1, blobUrl: "https://x", price: "1", evalFee: "1", mode: "scored", programPk })).toThrow();
    expect(() => prepareList({ plaintext, title: "t", publicDesc: "d", columns: ["a"], rowsClaimed: 1, blobUrl: "https://x", price: "1", evalFee: "1", mode: "scored", programPk: "04ab" })).toThrow();
  });
});

describe("criteria and messages", () => {
  const criteria: Criteria = { v: 1, text: "Daily retail units by SKU and region.", min_fit: 4 };

  it("sealCriteria seals the minified JSON to the program key", () => {
    const plain = unseal(programScalar, b64.dec(sealCriteria(programPk, criteria)));
    expect(new TextDecoder().decode(plain)).toBe(JSON.stringify(criteria));
  });

  it("criteria_too_large_error", () => {
    const big = { v: 1, text: "x".repeat(600), required_columns: Array.from({ length: 64 }, (_, i) => `column_${i}_${"y".repeat(30)}`) } as Criteria;
    const err = (() => { try { sealCriteria(programPk, big); } catch (e) { return e as CriteriaTooLarge; } })();
    expect(err).toBeInstanceOf(CriteriaTooLarge);
    expect(err!.bytes).toBeGreaterThan(2975);
    expect(err!.message).toContain("criteria too large: shorten text");
    expect(err!.limit).toBe(2975);
  });

  it("prepareEval and prepareBuy produce msgs the schema accepts", () => {
    const e = ArrowMsg.parse(JSON.parse(prepareEval({ listingId: 7, criteria, buyerPk, programPk })));
    expect(e).toMatchObject({ op: "eval", listing_id: 7, buyer_pk: buyerPk });
    expect(JSON.parse(prepareBuy({ listingId: 7, buyerPk }))).toEqual({ op: "buy", listing_id: 7, buyer_pk: buyerPk });
    expect(() => prepareBuy({ listingId: 7, buyerPk: "02ab" })).toThrow();
  });
});

describe("results", () => {
  it("decode_all_51_states", () => {
    for (let idx = 0; idx < 50; idx++) {
      const r = b64.enc(seal(buyerPk, Uint8Array.of(idx)));
      expect(b64.dec(r).length).toBe(98);
      const s = decodeEvalResult(r, buyerScalar, "scored");
      expect(s.verdict).toBe(idx >= 25 ? "BUY" : "PASS");
      expect(((s.verdict === "BUY" ? 25 : 0) + (s.fit! - 1) * 5 + (s.novelty! - 1))).toBe(idx);
    }
    expect(decodeEvalResult(b64.enc(seal(buyerPk, Uint8Array.of(1))), buyerScalar, "verdict")).toEqual({ verdict: "BUY" });
    expect(() => decodeEvalResult(b64.enc(seal(buyerPk, Uint8Array.of(50))), buyerScalar, "scored")).toThrow();
    expect(() => decodeEvalResult(b64.enc(seal(buyerPk, Uint8Array.of(1, 2))), buyerScalar, "scored")).toThrow("1 byte");
  });

  it("openRelease returns the 32-byte K and rejects other lengths", () => {
    const k = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(openRelease(b64.enc(seal(buyerPk, k)), buyerScalar)).toEqual(k);
    expect(b64.dec(b64.enc(seal(buyerPk, k))).length).toBe(129);
    expect(() => openRelease(b64.enc(seal(buyerPk, k.subarray(0, 31))), buyerScalar)).toThrow("32 bytes");
  });
});

describe("fetchAndCheckBlob", () => {
  const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
  const resp = (b: Uint8Array, init: ResponseInit = {}) => vi.fn().mockResolvedValue(new Response(new Uint8Array(b).buffer, { status: 200, ...init }));

  it("returns the bytes when the hash matches", async () => {
    await expect(fetchAndCheckBlob("https://x/b.bin", sha256Hex(bytes), resp(bytes))).resolves.toEqual(bytes);
  });

  it("fetch_blob_hash_mismatch", async () => {
    const bad = Uint8Array.from(bytes);
    bad[0] ^= 1;
    const err = await fetchAndCheckBlob("https://x/b.bin", sha256Hex(bytes), resp(bad)).catch((e) => e);
    expect(err).toBeInstanceOf(BlobHashMismatch);
    expect(err.expected).toBe(sha256Hex(bytes));
  });

  it("refuses an oversized blob and a failed download", async () => {
    expect(MAX_BLOB_BYTES).toBe(5 * 1024 * 1024);
    await expect(fetchAndCheckBlob("u", "x", resp(bytes, { headers: { "content-length": String(MAX_BLOB_BYTES + 1) } }))).rejects.toThrow("too large");
    await expect(fetchAndCheckBlob("u", "x", vi.fn().mockResolvedValue(new Response("no", { status: 404 })))).rejects.toThrow("HTTP 404");
  });
});

describe("ArrowViews", () => {
  const dir = resolve(HERE, "fixtures/views");
  const sample = (n: string) => JSON.parse(readFileSync(resolve(dir, `${n}.json`), "utf8"));
  const bytesOf = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
  const answers = (v: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result: { result: bytesOf(v) } })));

  it("views_parse_samples", async () => {
    expect(readdirSync(dir).sort()).toEqual(["config.json", "eval.json", "leak_budget.json", "listing.json", "purchase.json", "version.json"]);
    const views = new ArrowViews("testnet");
    const call = async (v: unknown, fn: () => Promise<unknown>) => { vi.stubGlobal("fetch", answers(v)); return fn(); };
    expect((await call(sample("listing"), () => views.listing(1)) as any).id).toBe(1);
    expect((await call(sample("eval"), () => views.eval(3)) as any).status).toBe("done");
    expect((await call(sample("purchase"), () => views.purchase(2)) as any).refund_reason).toBe("hash_mismatch");
    expect((await call(sample("leak_budget"), () => views.leakBudget(1)) as any).left_milli).toBe(266631);
    expect((await call(sample("version"), () => views.version()) as any).payment_path).toBe("notify");
    expect((await call(sample("config"), () => views.config()) as any).build).toBe("testnet");
    expect(await call([sample("listing")], () => views.listings())).toHaveLength(1);
    expect(await call([sample("eval")], () => views.evalsByListing(1))).toHaveLength(1);
    expect(await call("04" + "ab".repeat(64), () => views.programPubkey())).toMatch(/^04/);
  });

  it("returns null for a missing record and caps the page size at 50", async () => {
    const views = new ArrowViews("testnet");
    vi.stubGlobal("fetch", answers(null));
    expect(await views.listing(99)).toBeNull();
    const f = answers([]);
    vi.stubGlobal("fetch", f);
    await views.listings({ from: 1, limit: 500 });
    const args = JSON.parse(atob(JSON.parse(f.mock.calls[0][1].body).params.args_base64));
    expect(args).toEqual({ from_index: 1, limit: 50 });
  });

  it("targets the network's contract and rejects a malformed view", async () => {
    const f = answers({ id: 1 });
    vi.stubGlobal("fetch", f);
    await expect(new ArrowViews("mainnet").listing(1)).rejects.toThrow();
    expect(JSON.parse(f.mock.calls[0][1].body).params.account_id).toBe("arrow-market.near");
  });
});

describe("prepareList with a given key and nonce", () => {
  it("prepare_list_reproducible_blob", () => {
    const args = () => ({
      plaintext, title: "t", publicDesc: "d", columns: ["id"], rowsClaimed: 2, blobUrl: "https://blobs.example/x.bin",
      price: "250000", evalFee: "100000", mode: "scored" as const, programPk,
      key: new Uint8Array(32).fill(7), nonce: new Uint8Array(24).fill(9),
    });
    const a = prepareList(args());
    const b = prepareList(args());
    expect(a.blobSha256).toBe(b.blobSha256);
    expect(a.blob).toEqual(b.blob);
  });
});
