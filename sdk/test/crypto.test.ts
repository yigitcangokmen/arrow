// WS4-T02 acceptance: ECIES + XChaCha round-trips and the TS-generated shared vectors.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  b64, bytesToHex, decryptFile, ECIES_OVERHEAD, encryptFile, hexToBytes, publicKeyHex, scalarFromLabel, seal,
  sealedKPayload, sha256Hex, unseal,
} from "../src/index.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const load = (f: string) => JSON.parse(readFileSync(resolve(FIX, f), "utf8"));
const scalar = scalarFromLabel("arrow:test:crypto:v1");
const pub = publicKeyHex(scalar);
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);

describe("ecies", () => {
  it("ecies_roundtrip_ts", () => {
    for (const n of [0, 1, 32, 64, 300, 2975]) expect(unseal(scalar, seal(pub, bytes(n)))).toEqual(bytes(n));
  });

  it("ecies_len_97_plus_n", () => {
    expect(ECIES_OVERHEAD).toBe(97);
    for (const n of [1, 32, 64, 2975]) expect(seal(pub, bytes(n)).length).toBe(97 + n);
    expect(seal(pub, bytes(1)).length).toBe(98); // DEC I-09
  });

  it("ecies_vectors_unseal", () => {
    const v = load("ecies-vectors.json");
    expect(v.cases).toHaveLength(7);
    for (const c of v.cases) {
      expect(publicKeyHex(c.scalar_hex), c.id).toBe(c.pub_hex);
      expect(bytesToHex(unseal(c.scalar_hex, hexToBytes(c.ciphertext_hex))), c.id).toBe(c.plaintext_hex);
      expect(hexToBytes(c.ciphertext_hex).length, c.id).toBe(97 + hexToBytes(c.plaintext_hex).length);
    }
  });

  it("pubkey_uncompressed_130_hex", () => {
    expect(pub).toMatch(/^04[0-9a-f]{128}$/);
  });

  it("refuses a wrong key and a malformed public key", () => {
    const other = scalarFromLabel("arrow:test:other:v1");
    expect(() => unseal(other, seal(pub, bytes(8)))).toThrow();
    expect(() => seal("02" + "ab".repeat(32), bytes(1))).toThrow();
    expect(() => seal(pub.toUpperCase(), bytes(1))).toThrow();
  });

  it("scalarFromLabel is deterministic and in range", () => {
    expect(scalarFromLabel("a")).toBe(scalarFromLabel("a"));
    expect(scalarFromLabel("a")).not.toBe(scalarFromLabel("b"));
    expect(scalarFromLabel("a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sealed_k_payload_64", () => {
    const k = bytes(32);
    const sha = sha256Hex(bytes(100));
    const p = sealedKPayload(k, sha);
    expect(p.length).toBe(64);
    expect(p.subarray(0, 32)).toEqual(k);
    expect(bytesToHex(p.subarray(32))).toBe(sha);
    expect(seal(pub, p).length).toBe(161); // fixtures/README: sealed_k = 161 bytes
    expect(() => sealedKPayload(bytes(31), sha)).toThrow();
    expect(() => sealedKPayload(k, "ab")).toThrow();
  });

  it("max_criteria_fits", () => {
    expect(b64.enc(seal(pub, bytes(2975))).length).toBeLessThanOrEqual(4096);
    expect(b64.enc(seal(pub, bytes(2976))).length).toBeGreaterThan(4096);
  });
});

describe("xchacha", () => {
  it("xchacha_vectors_exact", () => {
    const v = load("xchacha-vectors.json");
    expect(v.cases).toHaveLength(4);
    for (const c of v.cases) {
      const plain = hexToBytes(c.plaintext_hex);
      const { blob, blobSha256 } = encryptFile(plain, hexToBytes(c.key_hex), hexToBytes(c.nonce_hex));
      expect(bytesToHex(blob), c.id).toBe(c.blob_hex);
      expect(blobSha256, c.id).toBe(c.blob_sha256);
      expect(decryptFile(hexToBytes(c.blob_hex), hexToBytes(c.key_hex)), c.id).toEqual(plain);
    }
  });

  it("xchacha_layout_nonce_ct_tag", () => {
    for (const n of [0, 1, 1000]) {
      const { blob } = encryptFile(bytes(n));
      expect(blob.length).toBe(24 + n + 16);
    }
  });

  it("generates a fresh key and nonce per call", () => {
    const a = encryptFile(bytes(10));
    const b = encryptFile(bytes(10));
    expect(a.key).not.toEqual(b.key);
    expect(a.blobSha256).not.toBe(b.blobSha256);
    expect(a.key.length).toBe(32);
    expect(decryptFile(a.blob, a.key)).toEqual(bytes(10));
  });

  it("xchacha_tamper_fails", () => {
    const { key, blob } = encryptFile(bytes(100));
    for (const at of [0, 24, blob.length - 1]) {
      const bad = Uint8Array.from(blob);
      bad[at] ^= 1;
      expect(() => decryptFile(bad, key), `bit flip at ${at}`).toThrow();
    }
    expect(() => decryptFile(blob.subarray(0, 30), key)).toThrow();
    expect(() => decryptFile(blob, bytes(32))).toThrow();
  });
});

describe("encodings", () => {
  it("b64 is standard base64 with padding", () => {
    expect(b64.enc(Uint8Array.of(0xfb, 0xff))).toBe("+/8=");
    expect(b64.dec("+/8=")).toEqual(Uint8Array.of(0xfb, 0xff));
    expect(b64.enc(new Uint8Array(0))).toBe("");
    const big = bytes(100_000);
    expect(b64.dec(b64.enc(big))).toEqual(big);
    for (const bad of ["-_8=", "+/8", "a", "====", "ab=c"]) expect(() => b64.dec(bad), bad).toThrow();
  });
});
