// Generates fixtures/ecies-vectors.json and fixtures/xchacha-vectors.json (WS4-T02, S4-b TS side).
// XChaCha is deterministic (key/nonce from labels), so --check compares bytes. ECIES is randomized: a re-run keeps
// existing ciphertexts that still unseal, and --check requires every case to unseal back to its plaintext.
// Test scalars are derived from public labels (DEC D4-18); the files hold no real key.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { bytesToHex, decryptFile, encryptFile, hexToBytes, publicKeyHex, scalarFromLabel, seal, sealedKPayload, sha256Hex, unseal } from "@arrow/sdk";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const ECIES_FILE = resolve(FIXTURES, "ecies-vectors.json");
const XCHACHA_FILE = resolve(FIXTURES, "xchacha-vectors.json");
const enc = new TextEncoder();
const label = (s: string) => new Uint8Array(createHash("sha256").update(s, "utf8").digest());
const eciesVersion = JSON.parse(readFileSync(resolve(FIXTURES, "../node_modules/eciesjs/package.json"), "utf8")).version;

/** n deterministic bytes: sha256(label:0) || sha256(label:1) ... truncated. */
function bytesOf(seed: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0, c = 0; i < n; c++) {
    const block = label(`${seed}:${c}`);
    const take = Math.min(block.length, n - i);
    out.set(block.subarray(0, take), i);
    i += take;
  }
  return out;
}

/** Criteria-shaped JSON of exactly n bytes. */
function criteriaOfSize(n: number): Uint8Array {
  const head = '{"v":1,"text":"';
  const tail = '"}';
  return enc.encode(head + "a".repeat(n - head.length - tail.length) + tail);
}

interface EciesCase { id: string; scalar_hex: string; pub_hex: string; plaintext_hex: string; ciphertext_hex: string }

function eciesPlaintexts(): { id: string; plaintext: Uint8Array }[] {
  const k = label("arrow:vector:ecies:idx3:pt");
  return [
    { id: "idx0", plaintext: Uint8Array.of(0x00) },
    { id: "idx1", plaintext: Uint8Array.of(0x31) },
    { id: "idx2", plaintext: Uint8Array.of(0x32) },
    { id: "idx3", plaintext: k },
    { id: "idx4", plaintext: sealedKPayload(label("arrow:vector:ecies:idx4:k"), sha256Hex(label("arrow:vector:ecies:idx4:blob"))) },
    { id: "idx5", plaintext: criteriaOfSize(300) },
    { id: "idx6", plaintext: criteriaOfSize(2975) },
  ];
}

function buildEcies(previous: EciesCase[]): EciesCase[] {
  return eciesPlaintexts().map(({ id, plaintext }) => {
    const scalar_hex = scalarFromLabel(`arrow:vector:ecies:${id}:v1`);
    const pub_hex = publicKeyHex(scalar_hex);
    const plaintext_hex = bytesToHex(plaintext);
    const old = previous.find((c) => c.id === id);
    if (old && old.scalar_hex === scalar_hex && old.plaintext_hex === plaintext_hex && unsealsTo(old)) return old;
    return { id, scalar_hex, pub_hex, plaintext_hex, ciphertext_hex: bytesToHex(seal(pub_hex, plaintext)) };
  });
}

function unsealsTo(c: EciesCase): boolean {
  try {
    return bytesToHex(unseal(c.scalar_hex, hexToBytes(c.ciphertext_hex))) === c.plaintext_hex;
  } catch {
    return false;
  }
}

const eciesDoc = (cases: EciesCase[]) => ({ version: 1, generator: `eciesjs@${eciesVersion}`, cases });

interface XCase { id: string; key_hex: string; nonce_hex: string; plaintext_hex: string; blob_hex: string; blob_sha256: string }

function buildXchacha(): XCase[] {
  const plaintexts: [string, Uint8Array][] = [
    ["x0", Uint8Array.of(0x2a)],
    ["x1", bytesOf("arrow:vector:xchacha:x1:pt", 1000)],
    ["x2", bytesOf("arrow:vector:xchacha:x2:pt", 65536)],
    ["x3", enc.encode("id,label\n1,a\n")],
  ];
  return plaintexts.map(([id, plaintext]) => {
    const key = label(`arrow:vector:xchacha:${id}:key`);
    const nonce = label(`arrow:vector:xchacha:${id}:nonce`).subarray(0, 24);
    const { blob, blobSha256 } = encryptFile(plaintext, key, nonce);
    return { id, key_hex: bytesToHex(key), nonce_hex: bytesToHex(nonce), plaintext_hex: bytesToHex(plaintext), blob_hex: bytesToHex(blob), blob_sha256: blobSha256 };
  });
}

const xchachaDoc = (cases: XCase[]) => ({ version: 1, layout: "nonce(24) || ciphertext || tag(16), no AAD", cases });
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const readCases = <T>(f: string): T[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).cases : []);

if (process.argv.includes("--check")) {
  const ecies = readCases<EciesCase>(ECIES_FILE);
  const bad = eciesPlaintexts().filter(({ id }) => !ecies.find((c) => c.id === id && unsealsTo(c)));
  const xWant = json(xchachaDoc(buildXchacha()));
  const xOk = existsSync(XCHACHA_FILE) && readFileSync(XCHACHA_FILE, "utf8") === xWant;
  const xRound = readCases<XCase>(XCHACHA_FILE).every((c) => bytesToHex(decryptFile(hexToBytes(c.blob_hex), hexToBytes(c.key_hex))) === c.plaintext_hex);
  if (bad.length || !xOk || !xRound) {
    console.error(`FAIL: ecies bad=[${bad.map((b) => b.id)}] xchacha byte-equal=${xOk} roundtrip=${xRound}`);
    process.exit(1);
  }
  console.log(`OK (xchacha byte-equal, ecies ${ecies.length}/${ecies.length} unseal)`);
} else {
  const ecies = buildEcies(readCases<EciesCase>(ECIES_FILE));
  const x = buildXchacha();
  writeFileSync(ECIES_FILE, json(eciesDoc(ecies)));
  writeFileSync(XCHACHA_FILE, json(xchachaDoc(x)));
  console.log(`wrote fixtures/ecies-vectors.json (${ecies.length} cases), fixtures/xchacha-vectors.json (${x.length} cases)`);
}
