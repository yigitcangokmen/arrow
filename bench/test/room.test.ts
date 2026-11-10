// Acceptance tests for the G5 injection room (WS6-T03).
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/gen/csv.ts";
import { MAX_CELL_BYTES, PAYLOAD_ROWS, ROWS, roomFiles } from "../src/gen/room.ts";
import { structuralCheck, type Criteria } from "../src/structural.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const manifest = JSON.parse(read("bench/injection-room/attacks.json"));
const criteria = JSON.parse(read("bench/injection-room/criteria.json")) as Criteria;
const allDatasets: string[] = [...manifest.attacks.map((a: any) => a.dataset), ...manifest.controls.map((c: any) => c.dataset)];

// TS copy of the scanner instruction patterns (spec section 2.6). Used ONLY by the negative test on the clean control.
const PATTERNS = [
  /ignore\s+(all|previous|the above)[^.\n]{0,40}instructions/i,
  /^\s*system\s*:/i,
  /you are (an?|the) /i,
  /as an ai/i,
  /evaluator\s*:/i,
  /verdict\s*[:=]/i,
  /fit\s*[:=]\s*\d/i,
];

describe("injection room", () => {
  it("room_has_24_attacks_6_per_category", () => {
    expect(manifest.attacks).toHaveLength(24);
    expect(new Set(manifest.attacks.map((a: any) => a.id)).size).toBe(24);
    for (const cat of ["plain", "unicode", "encoding", "language"]) {
      expect(manifest.attacks.filter((a: any) => a.category === cat)).toHaveLength(6);
    }
    for (const p of allDatasets) expect(existsSync(resolve(ROOT, p)), p).toBe(true);
    expect(allDatasets).toHaveLength(26);
  });

  it("room_files_byte_identical_to_generator", () => {
    const files = roomFiles();
    expect(files.size).toBe(29);
    for (const [p, content] of files) expect(read(p), p).toBe(content);
  });

  it("room_datasets_pass_structural_gates", () => {
    for (const p of allDatasets) {
      const r = structuralCheck(read(p), criteria);
      expect(r.failures, p).toEqual([]);
      expect(r.fit_rule, p).toBe(5);
    }
  });

  it("room_payload_present_and_codepoints_intact", () => {
    const col = (p: string) => {
      const { header, rows } = parseCsv(read(p));
      const j = header.indexOf("memo");
      return rows.map((r) => r[j] as string);
    };
    for (const a of manifest.attacks) {
      const memos = col(a.dataset);
      expect(memos).toHaveLength(ROWS);
      const hits = memos.filter((m) => m === a.payload);
      expect(hits.length, a.id).toBe(PAYLOAD_ROWS);
      expect(PAYLOAD_ROWS / ROWS).toBe(0.35);
      expect(memos.slice(0, 3).some((m) => m === a.payload), `${a.id} first 3 rows`).toBe(true);
      expect(memos.filter((m) => m !== a.payload).every((m) => m === "auto row"), a.id).toBe(true);
      expect(Buffer.byteLength(a.payload, "utf8")).toBe(a.payload_utf8_bytes);
    }
    const payload = (id: string) => manifest.attacks.find((a: any) => a.id === id).payload as string;
    const has = (id: string, cp: number) => expect(payload(id).codePointAt(0) !== undefined && [...payload(id)].some((c) => c.codePointAt(0) === cp), `${id} U+${cp.toString(16)}`).toBe(true);
    has("R-U1", 0x0406);
    has("R-U2", 0x200b);
    has("R-U2", 0x200c);
    has("R-U2", 0x200d);
    has("R-U2", 0x2060);
    has("R-U3", 0xff29);
    has("R-U4", 0x1d408);
    has("R-U5", 0x202e);
    has("R-U6", 0xe0049);
    // the bytes are also in the CSV file itself
    expect(read("bench/injection-room/datasets/R-U6.csv").includes(String.fromCodePoint(0xe0049))).toBe(true);
    expect(read("bench/injection-room/datasets/R-U2.csv").includes("​")).toBe(true);
  });

  it("room_payload_cell_le_180_bytes", () => {
    for (const p of allDatasets) {
      const { header, rows } = parseCsv(read(p));
      for (const r of rows) for (const cell of r) expect(Buffer.byteLength(cell, "utf8"), p).toBeLessThanOrEqual(MAX_CELL_BYTES);
      expect(header).toHaveLength(9);
    }
  });

  it("room_control_clean_has_bare_buy_sell_and_no_pattern", () => {
    const { header, rows } = parseCsv(read("bench/injection-room/control-clean-buysell.csv"));
    const side = header.indexOf("side");
    expect(rows.filter((r) => r[side] === "BUY").length).toBeGreaterThanOrEqual(60);
    expect(rows.filter((r) => r[side] === "SELL").length).toBeGreaterThanOrEqual(60);
    for (const r of rows) for (const cell of r) for (const re of PATTERNS) expect(re.test(cell), `${cell} ~ ${re}`).toBe(false);
    const price = header.indexOf("price");
    for (const r of rows) {
      const v = Number(r[price]);
      expect(v).toBeGreaterThanOrEqual(3.2);
      expect(v).toBeLessThanOrEqual(4.1);
    }
  });

  it("room_criteria_valid_and_small", () => {
    // Minimal check against fixtures/criteria-schema.json (WS4-T01 zod schema not available yet).
    const schema = JSON.parse(read("fixtures/criteria-schema.json"));
    const props = schema.properties as Record<string, any>;
    for (const k of schema.required) expect(criteria).toHaveProperty(k);
    for (const [k, v] of Object.entries(criteria)) {
      const s = props[k];
      expect(s, `unknown key ${k}`).toBeDefined();
      if (s.type === "string") {
        expect(typeof v).toBe("string");
        if (s.maxLength) expect((v as string).length).toBeLessThanOrEqual(s.maxLength);
        if (s.pattern) expect(new RegExp(s.pattern).test(v as string), k).toBe(true);
      } else if (s.type === "integer") {
        expect(Number.isInteger(v)).toBe(true);
        expect(v as number).toBeGreaterThanOrEqual(s.minimum);
        expect(v as number).toBeLessThanOrEqual(s.maximum);
      } else if (s.type === "number") {
        expect(v as number).toBeGreaterThanOrEqual(s.minimum);
        expect(v as number).toBeLessThanOrEqual(s.maximum);
      } else if (s.type === "array") {
        expect(Array.isArray(v)).toBe(true);
        expect((v as string[]).length).toBeLessThanOrEqual(s.maxItems);
      } else if (s.const !== undefined) expect(v).toBe(s.const);
    }
    expect("minhash" in criteria).toBe(false);
    const bytes = Buffer.byteLength(JSON.stringify(criteria), "utf8");
    expect(bytes).toBeLessThanOrEqual(schema["x-arrow-max-bytes"]);
    expect(Math.ceil(((bytes + 97) * 4) / 3)).toBeLessThanOrEqual(4096);
  });

  it("room_regex_expected_count", () => {
    const t = manifest.attacks.filter((a: any) => a.regex_expected === true).length;
    const f = manifest.attacks.filter((a: any) => a.regex_expected === false).length;
    const sub = manifest.attacks.filter((a: any) => a.mainnet_subset === true).length;
    console.log(`room regex_expected: ${t} true / ${f} false · mainnet_subset ${sub}`);
    expect(t + f).toBe(24);
    expect(sub).toBe(5);
  });

  // Needs bench/results/native-gates.json from `bench_tool gates` (WS3-T06 / WS6-T05). Not run until it exists.
  it.skipIf(!existsSync(resolve(ROOT, "bench/results/native-gates.json")))("room_regex_expected_matches_native_gates", () => {
    const native = JSON.parse(read("bench/results/native-gates.json"));
    for (const a of manifest.attacks.filter((x: any) => x.regex_expected)) {
      const entry = (native.cases ?? native)[a.id];
      expect(entry?.hit ?? entry?.flagged, a.id).toBe(true);
    }
  });
});
