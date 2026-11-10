// Acceptance tests for the synthetic demo data (WS6-T01). No network.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { b64, bytesToHex, Criteria, publicKeyHex, scalarFromLabel, sha256Hex, signature, unseal } from "@arrow/sdk";
import { parseCsv } from "../../bench/src/gen/csv.ts";
import { build } from "../src/gen-demo-data.ts";
import { buildCriteria, sealedLength } from "../src/make-demo-criteria.ts";
import { checkBlobs, listMsg, prepareDemoListing } from "../src/make-demo-blobs.ts";
import { counts, estimateByHits, estimateJaccardTimesSize, exactContainment, noveltyBand } from "../src/lib/containment.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const csv = (rel: string) => parseCsv(read(rel));
const col = (rel: string, name: string) => {
  const { header, rows } = csv(rel);
  const i = header.indexOf(name);
  expect(i).toBeGreaterThanOrEqual(0);
  return rows.map((r) => r[i]!);
};

const UNLOCK = "fixtures/demo/unlock-schedule-412.csv";
const LABELS = "fixtures/demo/wallet-labels-1000.csv";
const BUYER_U = "fixtures/demo/buyer-list-unlock.csv";
const BUYER_L = "fixtures/demo/buyer-list-labels.csv";
const LISTING_FILES = [UNLOCK, LABELS];
const ALL_FILES = [UNLOCK, LABELS, BUYER_U, BUYER_L];

describe("demo data", () => {
  it("unlock_has_412_unique_keys", () => {
    const keys = col(UNLOCK, "token_contract");
    expect(keys).toHaveLength(412);
    expect(new Set(keys).size).toBe(412);
    const dates = col(UNLOCK, "unlock_date");
    expect(dates[0]).toBe("2027-01-01");
    expect(dates[dates.length - 1]).toBe("2027-03-31");
    expect([...dates].sort()).toEqual(dates);
  });
  it("labels_has_1000_unique_keys", () => {
    const keys = col(LABELS, "account_id");
    expect(keys).toHaveLength(1000);
    expect(new Set(keys).size).toBe(1000);
    const last = col(LABELS, "last_active");
    expect(last[0]).toBe("2026-08-01");
    expect(last[last.length - 1]).toBe("2026-10-31");
    expect(Math.min(...last.map((d) => (d < "2026-08-01" || d > "2026-10-31" ? 0 : 1)))).toBe(1);
  });
  it("buyer_overlap_exact", () => {
    const u = col(UNLOCK, "token_contract"), bu = col(BUYER_U, "token_contract");
    const l = col(LABELS, "account_id"), bl = col(BUYER_L, "account_id");
    expect(bu).toHaveLength(412);
    expect(bl).toHaveLength(1000);
    expect(new Set(bu).size).toBe(412);
    expect(new Set(bl).size).toBe(1000);
    const inter = (a: string[], b: string[]) => a.filter((x) => new Set(b).has(x)).length;
    expect(inter(u, bu)).toBe(371); // 0.900 both ways because |B| = |A|
    expect(inter(l, bl)).toBe(300);
    expect(exactContainment(u, bu)).toBeCloseTo(0.9, 3);
    expect(exactContainment(bu, u)).toBeCloseTo(0.9, 3);
    expect(exactContainment(l, bl)).toBeCloseTo(0.3, 3);
    expect(exactContainment(bl, l)).toBeCloseTo(0.3, 3);
  });
  it("minhash_estimates_inside_band_with_margin", () => {
    const nu = counts(col(UNLOCK, "token_contract"), signature(col(BUYER_U, "token_contract")));
    const nl = counts(col(LABELS, "account_id"), signature(col(BUYER_L, "account_id")));
    expect(estimateByHits(nu)).toBeGreaterThanOrEqual(0.85);
    expect(estimateJaccardTimesSize(nu)).toBeGreaterThanOrEqual(0.85);
    expect(noveltyBand(nu)).toBe(1);
    for (const e of [estimateByHits(nl), estimateJaccardTimesSize(nl)]) {
      expect(e).toBeGreaterThanOrEqual(0.25);
      expect(e).toBeLessThanOrEqual(0.35);
    }
    expect(noveltyBand(nl)).toBe(4);
  });
  it("generator_output_equals_committed_files", () => {
    const { files, expected } = build();
    for (const [p, c] of files) expect(read(p), p).toBe(c);
    expect(JSON.parse(read("fixtures/demo/expected.json"))).toEqual(JSON.parse(JSON.stringify(expected)));
  });
  it("every_demo_file_labelled_synthetic", () => {
    for (const f of LISTING_FILES) {
      const { header, rows } = csv(f);
      const i = header.indexOf("synthetic");
      expect(i, f).toBeGreaterThanOrEqual(0);
      expect(rows.every((r) => r[i] === "yes"), f).toBe(true);
    }
    // The buyer lists are one-column key lists (card: "single column"); every key in them is a synthetic-demo.near name.
    for (const f of [BUYER_U, BUYER_L]) {
      const { rows } = csv(f);
      expect(rows.every((r) => r[0]!.endsWith(".synthetic-demo.near")), f).toBe(true);
    }
    expect(read("fixtures/demo/README.md")).toMatch(/synthetic/i);
  });
  it("no_instruction_patterns_in_demo_cells", () => {
    const bad = [
      /ignore\s+(all\s+)?(previous|prior|above)/i, /disregard/i, /\bsystem\s*:/i, /\bverdict\s*[:=]/i, /\bfit\s*[:=]\s*\d/i,
      /you\s+are\s+(a|an|the)\b/i, /\bevaluator\s*:/i, /as\s+an\s+ai\b/i, /\binstructions?\s*:/i, /<\/?data/i, /\bnovelty\s*[:=]/i,
    ];
    for (const f of ALL_FILES) for (const line of read(f).split("\n")) for (const re of bad) expect(line, `${f} ${re}`).not.toMatch(re);
  });
  it("cells_and_rows_within_limits", () => {
    for (const f of LISTING_FILES) {
      const raw = read(f);
      expect(raw.charCodeAt(0)).not.toBe(0xfeff);
      expect(raw).not.toContain("\r");
      expect(raw.endsWith("\n") && !raw.endsWith("\n\n")).toBe(true);
      const { header, rows } = csv(f);
      expect(header.length).toBeLessThanOrEqual(64);
      for (const h of header) expect(h.length).toBeLessThanOrEqual(40);
      for (const r of rows) {
        expect(r).toHaveLength(header.length);
        for (const c of r) expect(Buffer.byteLength(c)).toBeLessThanOrEqual(180);
      }
      for (const line of raw.split("\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(1024);
    }
    expect(statSync(resolve(ROOT, LABELS)).size).toBeLessThan(5 * 1024 * 1024);
  });
  it("demo_accounts_are_only_under_synthetic_demo_near", () => {
    for (const f of ALL_FILES) {
      const names = read(f).match(/[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.near\b/g) ?? [];
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(n, f).toMatch(/\.synthetic-demo\.near$/);
    }
  });
});

describe("demo criteria", () => {
  const files = ["fixtures/criteria/demo.json", "fixtures/criteria/demo-buy.json", "fixtures/criteria/print-row-1.json"];
  it("criteria_valid_against_schema", () => {
    for (const f of files) expect(() => Criteria.parse(JSON.parse(read(f))), f).not.toThrow();
  });
  it("criteria_equal_the_generator_output", () => {
    for (const [p, c] of buildCriteria()) expect(JSON.parse(read(p)), p).toEqual(JSON.parse(JSON.stringify(c)));
  });
  it("criteria_sealed_size_le_4096", () => {
    for (const f of files) expect(sealedLength(JSON.parse(read(f))), f).toBeLessThanOrEqual(4096);
  });
  it("criteria_minhash_is_the_buyer_list_signature", () => {
    const sig = (rel: string, c: string) => signature(col(rel, c));
    const hex = (s: bigint[]) => s.map((v) => v.toString(16).padStart(16, "0")).join("");
    expect(JSON.parse(read("fixtures/criteria/demo.json")).minhash).toBe(hex(sig(BUYER_U, "token_contract")));
    expect(JSON.parse(read("fixtures/criteria/demo-buy.json")).minhash).toBe(hex(sig(BUYER_L, "account_id")));
  });
  it("print_row_1_has_no_minhash_and_asks_for_row_1", () => {
    const c = JSON.parse(read("fixtures/criteria/print-row-1.json"));
    expect(c.minhash).toBeUndefined();
    expect(c.text).toMatch(/row 1/i);
  });
});

describe("demo blobs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "arrow-demo-blobs-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const programScalar = scalarFromLabel("arrow:test:throwaway-program-key");
  const programPub = publicKeyHex(programScalar);

  it("no_plain_K_persisted", async () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
    const keyCopy = Uint8Array.from(key);
    const d = await prepareDemoListing({ dataset: "unlock", network: "testnet", seller: "team.arrowhq.testnet", programPubkey: programPub, root: tmp, key });
    expect(key.every((b) => b === 0)).toBe(true); // wiped in memory
    const needles = [bytesToHex(keyCopy), b64.enc(keyCopy), Buffer.from(keyCopy).toString("base64url")];
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of walk(tmp)) {
      const body = readFileSync(f);
      for (const n of needles) {
        expect(body.includes(Buffer.from(n)), `${f} holds K as text`).toBe(false);
      }
      expect(body.includes(Buffer.from(keyCopy)), `${f} holds K as raw bytes`).toBe(false);
    }
    // sealed_k opens with the program key and holds K || blob_sha256 || sha256(seller)
    const opened = unseal(programScalar, b64.dec(d.sealed_k));
    expect(Buffer.from(opened.subarray(0, 32)).equals(Buffer.from(keyCopy))).toBe(true);
    expect(bytesToHex(opened.subarray(32, 64))).toBe(d.blob_sha256);
    expect(bytesToHex(opened.subarray(64))).toBe(sha256Hex(new TextEncoder().encode("team.arrowhq.testnet")));
    expect(d.seller).toBe("team.arrowhq.testnet");
  });
  it("blob_files_match_sha_and_web_copy_and_list_msg_is_valid", async () => {
    const d = await prepareDemoListing({ dataset: "team-made", network: "testnet", seller: "team.arrowhq.testnet", programPubkey: programPub, root: tmp });
    expect(checkBlobs(tmp)).toEqual({ total: 2, problems: [] });
    const base = "https://raw.githubusercontent.com/yigitcangokmen/arrow/0123456789abcdef0123456789abcdef01234567/fixtures/blobs";
    const msg = listMsg(d, base);
    expect(msg.blob_url.length).toBeLessThanOrEqual(200);
    expect(msg.title.startsWith("[team-made]")).toBe(true);
  });
  it("synthetic_listing_titles_start_with_synthetic", async () => {
    for (const ds of ["unlock", "labels"] as const) {
      const d = await prepareDemoListing({ dataset: ds, network: "mainnet", seller: "0x66a0dfed229e920feb17aa3186f87bd00e30844f", programPubkey: programPub, root: tmp });
      expect(d.title.startsWith("[synthetic] ")).toBe(true);
      expect(d.title.length).toBeLessThanOrEqual(80);
      expect(d.public_desc.length).toBeLessThanOrEqual(280);
    }
  });
  it("committed_blobs_check_passes", () => {
    expect(checkBlobs().problems).toEqual([]);
  });
});
