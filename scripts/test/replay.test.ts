// WS4-T16 acceptance: records signed with a test account (derived from a label, DEC D4-18), one of them tampered.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "@arrow/sdk";
import { main, replay } from "../src/replay.ts";

const account = privateKeyToAccount(keccak256(toBytes("arrow:test:replay:v1")));
const other = privateKeyToAccount(keccak256(toBytes("arrow:test:replay-other:v1")));
const MODEL = "Qwen/Qwen3.8-27B";
const enc = (s: string) => new TextEncoder().encode(s);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arrow-replay-"));
  mkdirSync(join(root, "bench/results/baselines/raw"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function item(n: number, o: { kind?: "provider_tee" | "gateway"; signer?: typeof account; status?: string; tamper?: "hash" | "text" | "file" } = {}) {
  const req = JSON.stringify({ n, model: MODEL });
  const resp = JSON.stringify({ n, answer: "PASS" });
  const reqSha = sha256Hex(enc(req));
  const respSha = sha256Hex(enc(resp));
  const kind = o.kind ?? "provider_tee";
  const text = kind === "provider_tee" ? `${MODEL}:${reqSha}:${respSha}` : `${reqSha}:${respSha}`;
  const signer = o.signer ?? account;
  const base = `bench/results/baselines/raw/Q${n}.llm_only`;
  writeFileSync(join(root, `${base}.req.json`), o.tamper === "file" ? req + " " : req);
  writeFileSync(join(root, `${base}.resp.json`), resp);
  const captured = (o.status ?? "captured") === "captured";
  return {
    case_id: `Q${n}`, kind: "llm_only", model: MODEL, chat_id: `chatcmpl-${n}`,
    // a tampered record claims a different response hash than the one that was signed
    request_sha256: reqSha, response_sha256: o.tamper === "hash" ? sha256Hex(enc("something else")) : respSha,
    request_file: `${base}.req.json`, response_file: `${base}.resp.json`,
    status: o.status ?? "captured",
    signature_kind: captured ? kind : null,
    text: captured ? (o.tamper === "text" ? text + "0" : text) : null,
    signature: captured ? await signer.signMessage({ message: text }) : null,
    signing_address: captured ? (kind === "provider_tee" ? signer.address : null) : null,
    fetched_at_utc: "2026-11-12T11:30:00Z",
  };
}

const write = (file: object) => writeFileSync(join(root, "bench/results/signatures.json"), JSON.stringify(file));
const wrap = (items: unknown[], extra: object = {}) => ({ v: 1, signing_algo: "ecdsa", attestation_file: null, attested_signing_addresses: [], total: items.length, captured: items.length, items, ...extra });

describe("replay", () => {
  it("recovers_valid_records", async () => {
    write(wrap([await item(1), await item(2), await item(3, { kind: "gateway" })], { attested_signing_addresses: [account.address] }));
    const r = await replay(root);
    expect(r.failures).toEqual([]);
    // the gateway record has no signing_address: it is accepted because it recovers to an attested address
    expect(r.line).toBe("NEAR AI signatures: 3/3 verified · 3 attested at bench time · direct bench calls only (never on-chain)");
    expect(r.exit).toBe(0);
  });

  it("rejects_tampered_hash", async () => {
    write(wrap([await item(1), await item(2, { tamper: "hash" }), await item(3, { tamper: "text" }), await item(4, { tamper: "file" })], { attested_signing_addresses: [account.address] }));
    const r = await replay(root);
    expect(r.verified).toBe(1);
    expect(r.failures).toEqual([
      "FAIL Q2: text does not match <model>:<request_sha256>:<response_sha256>",
      "FAIL Q3: text does not match <model>:<request_sha256>:<response_sha256>",
      expect.stringContaining("FAIL Q4: request file bench/results/baselines/raw/Q4.llm_only.req.json does not hash"),
    ]);
    expect(r.line).toContain("1/4 verified");
    expect(r.exit).toBe(1);
  });

  it("rejects a signature made by a key other than the recorded signing address", async () => {
    const forged = { ...(await item(1, { signer: other })), signing_address: account.address };
    write(wrap([forged]));
    const r = await replay(root);
    expect(r.failures[0]).toContain("FAIL Q1: signature recovers to");
    expect(r.exit).toBe(1);
  });

  it("counts_captured_over_total", async () => {
    // 3 calls were made, one signature was 404 when fetched: that is 2/3, not a failure
    write(wrap([await item(1), await item(2), await item(3, { status: "not_found" })], { total: 3, captured: 2 }));
    const r = await replay(root);
    expect(r.failures).toEqual([]);
    expect(r.line).toMatch(/^NEAR AI signatures: 2\/3 verified · /);
    expect(r.exit).toBe(0);
  });

  it("separates verified from attested at bench time", async () => {
    write(wrap([await item(1), await item(2, { signer: other })], { attested_signing_addresses: [account.address] }));
    const r = await replay(root);
    expect(r.line).toBe("NEAR AI signatures: 2/2 verified · 1 attested at bench time · direct bench calls only (never on-chain)");
  });

  it("reads the addresses of an attestation snapshot file when the list is empty", async () => {
    writeFileSync(join(root, "bench/results/baselines/attestation-20261112T1130Z.json"), JSON.stringify({ model_attestations: [{ signing_address: account.address.toLowerCase() }] }));
    write(wrap([await item(1)], { attestation_file: "bench/results/baselines/attestation-20261112T1130Z.json" }));
    expect((await replay(root)).line).toContain("1/1 verified · 1 attested at bench time");
  });

  it("says so when there is no attestation snapshot", async () => {
    write(wrap([await item(1)]));
    const r = await replay(root);
    expect(r.line).toContain("0 attested at bench time · attestation snapshot missing");
    expect(r.exit).toBe(0);
  });

  it("accepts a plain array of signature records", async () => {
    const i = await item(1);
    const rec = { chat_id: i.chat_id, model: MODEL, signing_algo: "ecdsa", request_sha256: i.request_sha256, response_sha256: i.response_sha256, text: i.text, signature: i.signature, signing_address: account.address, fetched_utc: "2026-11-12T11:30:00Z" };
    write([rec] as unknown as object);
    const r = await replay(root);
    expect(r.line).toContain("1/1 verified");
  });

  it("missing_file_is_zero_over_zero", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(root)).toBe(0);
      expect(log).toHaveBeenCalledWith("NEAR AI signatures: 0/0 (no bench signatures recorded yet)");
    } finally {
      log.mockRestore();
    }
  });

  it("never_reads_evidence_eval_outputs", () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/replay.ts"), "utf8");
    expect(src).not.toMatch(/lib\/evidence|readEvidence|evidence\//i);
    expect(src).not.toMatch(/sealed_result|arrow_eval/);
  });
});
