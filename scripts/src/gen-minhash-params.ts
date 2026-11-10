// Generates fixtures/minhash-params.json (DEC I-17): 128 deterministic (a, b) pairs mod 2^61 − 1.
// Usage: npx tsx scripts/src/gen-minhash-params.ts [--check]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRIME = (1n << 61n) - 1n;
export const K = 128;
export const PARAMS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/minhash-params.json");

const DERIVATION =
  'For i = 0..127: h = sha256(utf8("arrow/minhash/v1/" + i)) with i in decimal, no padding; ' +
  "a = BE_u64(h[0..8]) mod p (1 if that is 0); b = BE_u64(h[8..16]) mod p; p = 2^61 - 1.";

export function minhashParamsJson(): string {
  const a: string[] = [];
  const b: string[] = [];
  for (let i = 0; i < K; i++) {
    const h = createHash("sha256").update(`arrow/minhash/v1/${i}`, "utf8").digest();
    const ai = h.readBigUInt64BE(0) % PRIME;
    a.push((ai === 0n ? 1n : ai).toString());
    b.push((h.readBigUInt64BE(8) % PRIME).toString());
  }
  const obj = { version: 1, k: K, prime: PRIME.toString(), derivation: DERIVATION, a, b };
  return JSON.stringify(obj, null, 2) + "\n";
}

function main(): void {
  const out = minhashParamsJson();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(PARAMS_PATH, "utf8");
    } catch {
      console.error("minhash-params.json: MISSING");
      process.exit(1);
    }
    if (current !== out) {
      console.error("minhash-params.json: DIFFERS from the generator");
      process.exit(1);
    }
    console.log("minhash-params.json: OK (byte-identical)");
    return;
  }
  writeFileSync(PARAMS_PATH, out);
  console.log(`wrote ${PARAMS_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
