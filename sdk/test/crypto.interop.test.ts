// WS4-T02 / S4-b: Rust -> TS direction. Reads fixtures/{ecies,xchacha}-vectors-rs.json written by WS3-T03.
// A missing file FAILS (it never skips): a skipped test must not count as passing (PLAN 7.4).
// The key names accept the canonical schema (scalar_hex, plaintext_hex, ciphertext_hex, blob_hex) and the
// alternate names in the WS-3 card sketch (sk_hex, pt_hex, ct_b64, blob_b64), so the schema choice cannot fake a red.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { b64, bytesToHex, decryptFile, hexToBytes, sha256Hex, unseal } from "../src/index.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

function cases(file: string): any[] {
  const path = resolve(FIX, file);
  if (!existsSync(path)) throw new Error(`${file} is missing: waiting for WS3-T03 (S4-b Rust side)`);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const list = doc.cases ?? doc.vectors;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${file} has no cases`);
  return list;
}

const toBytes = (hex?: string, b?: string): Uint8Array => (hex !== undefined ? hexToBytes(hex) : b64.dec(b!));

describe("S4-b rust -> ts", () => {
  it("ecies_rs_to_ts_unseal", () => {
    for (const c of cases("ecies-vectors-rs.json")) {
      const sk = c.scalar_hex ?? c.sk_hex;
      const plain = c.plaintext_hex ?? c.pt_hex;
      const ct = toBytes(c.ciphertext_hex, c.ct_b64);
      expect(bytesToHex(unseal(sk, ct)), c.id ?? c.name).toBe(plain);
    }
  });

  it("xchacha_rs_to_ts_decrypt", () => {
    for (const c of cases("xchacha-vectors-rs.json")) {
      const blob = toBytes(c.blob_hex, c.blob_b64);
      const plain = decryptFile(blob, hexToBytes(c.key_hex));
      expect(bytesToHex(plain), c.id ?? c.name).toBe(c.plaintext_hex ?? c.pt_hex);
      if (c.blob_sha256 !== undefined) expect(sha256Hex(blob), c.id ?? c.name).toBe(c.blob_sha256);
    }
  });
});
