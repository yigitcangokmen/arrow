// WS4-T06 acceptance: the viewing key derivation (DEC J-05, J-06).
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hashMessage, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  b64, bytesToHex, deriveViewingKeyEoa, DEMO_LABEL, demoViewingKey, hexToBytes, reduceToScalar, scalarFromLabel, seal,
  SECP256K1_N, siteDomain, unseal, viewingKeyFromSignature, viewingKeyMessage,
} from "../src/index.ts";

const account = privateKeyToAccount(`0x${scalarFromLabel("arrow:test:viewing:v1")}`);
const be32 = (x: bigint) => hexToBytes(x.toString(16).padStart(64, "0"));

// If this changes, demo purchase #1 can no longer be read (DEC J-06). Do not update it casually.
const DEMO_BUYER_PK =
  "049f9f490dd51e40025dfb63c92a9932f6e66efa92b3750a05601233fc00e238d5408721b772080e8811037a6954afb25b589b34a0fc18414e0efbaf1fc16a95cb";

describe("viewing key", () => {
  it("message_exact", () => {
    expect(viewingKeyMessage("arrow-market.vercel.app")).toBe(
      "Arrow viewing key v1\nDomain: arrow-market.vercel.app\nOnly sign this on arrow-market.vercel.app. Anyone with this signature can decrypt your Arrow purchases.",
    );
  });

  it("rejects a domain that could smuggle extra lines into the signed text", () => {
    for (const bad of ["", "a.com\nOnly sign", "a b.com", "https://a.com", "a.com/", " a.com"]) expect(() => viewingKeyMessage(bad), JSON.stringify(bad)).toThrow();
    expect(viewingKeyMessage("localhost:3000")).toContain("Domain: localhost:3000");
  });

  it("same_signature_same_key", async () => {
    const a = await deriveViewingKeyEoa(account, "arrow-market.vercel.app");
    const b = await deriveViewingKeyEoa(account, "arrow-market.vercel.app");
    expect(a).toEqual(b);
    expect(a.scalarHex).toMatch(/^[0-9a-f]{64}$/);
    expect(a.buyerPk).toMatch(/^04[0-9a-f]{128}$/);
  });

  it("different_domain_different_key", async () => {
    const a = await deriveViewingKeyEoa(account, "arrow-market.vercel.app");
    const b = await deriveViewingKeyEoa(account, "arrow-market-near.vercel.app");
    expect(a.scalarHex).not.toBe(b.scalarHex);
    expect(a.buyerPk).not.toBe(b.buyerPk);
  });

  it("local_account_matches_personal_sign", async () => {
    const message = viewingKeyMessage("arrow-market.vercel.app");
    const sig = await account.signMessage({ message });
    expect(await account.signMessage({ message })).toBe(sig); // RFC 6979: deterministic
    // personal_sign semantics: the EIP-191 prefixed hash recovers to the account
    expect(await recoverAddress({ hash: hashMessage(message), signature: sig })).toBe(account.address);
    // and the key comes from keccak256 over the signature bytes, not over the hex text
    const key = viewingKeyFromSignature(sig);
    const expected = BigInt("0x" + bytesToHex(keccak_256(hexToBytes(sig.slice(2))))) % SECP256K1_N;
    expect(key.scalarHex).toBe(expected.toString(16).padStart(64, "0"));
    const wrong = BigInt("0x" + bytesToHex(keccak_256(new TextEncoder().encode(sig)))) % SECP256K1_N;
    expect(key.scalarHex).not.toBe(wrong.toString(16).padStart(64, "0"));
  });

  it("the derived key decrypts what is sealed to its buyerPk", async () => {
    const key = await deriveViewingKeyEoa(account, "arrow-market.vercel.app");
    const sealed = seal(key.buyerPk, Uint8Array.of(1, 2, 3));
    expect(unseal(key.scalarHex, sealed)).toEqual(Uint8Array.of(1, 2, 3));
    expect(b64.enc(sealed).length).toBe(Math.ceil((97 + 3) / 3) * 4);
  });

  it("rejects_non_65_byte_signature", () => {
    expect(() => viewingKeyFromSignature(`0x${"ab".repeat(64)}`)).toThrow("EOA signature required (EIP-1271 not supported)");
    expect(() => viewingKeyFromSignature(`0x${"ab".repeat(66)}`)).toThrow("EOA signature required");
    expect(() => viewingKeyFromSignature("0x")).toThrow();
  });
});

describe("scalar reduction", () => {
  it("reduce_mod_n", () => {
    expect(reduceToScalar(be32(SECP256K1_N + 5n))).toEqual(be32(5n));
    expect(reduceToScalar(be32(7n))).toEqual(be32(7n));
  });

  it("reduce_zero_rehash", () => {
    const digest = be32(SECP256K1_N);
    const out = reduceToScalar(digest);
    expect(BigInt("0x" + bytesToHex(out))).not.toBe(0n);
    expect(BigInt("0x" + bytesToHex(out))).toBe(BigInt("0x" + bytesToHex(keccak_256(digest))) % SECP256K1_N);
  });
});

describe("demo key", () => {
  it("demo_key_snapshot", () => {
    expect(DEMO_LABEL).toBe("arrow:demo-buyer:public:v1");
    const k = demoViewingKey();
    expect(k.buyerPk).toBe(DEMO_BUYER_PK);
    expect(k.scalarHex).toBe(scalarFromLabel(DEMO_LABEL));
    expect(k.scalarHex).toBe(bytesToHex(keccak_256(new TextEncoder().encode(DEMO_LABEL)))); // below n: no reduction happened
  });
});

describe("siteDomain", () => {
  it("reads NEXT_PUBLIC_SITE_DOMAIN and never invents one", () => {
    expect(siteDomain({ NEXT_PUBLIC_SITE_DOMAIN: "arrow-market.vercel.app" })).toBe("arrow-market.vercel.app");
    expect(() => siteDomain({})).toThrow("set NEXT_PUBLIC_SITE_DOMAIN (DEC D-12)");
    expect(() => siteDomain({ NEXT_PUBLIC_SITE_DOMAIN: "" })).toThrow();
  });
});
