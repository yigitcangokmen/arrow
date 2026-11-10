// Acceptance tests for the Markdown to JSONL converter (WS7-T02).
import { describe, expect, it } from "vitest";
import { mdToRows, toJsonl } from "../src/md-to-jsonl.ts";

const sample = [
  "# Report title",
  "",
  "First sentence. Second one? Third!",
  "",
  "## Findings",
  "A very long sentence " + "word ".repeat(80) + "end.",
  "",
  "```",
  "const a = 1;",
  "const b = 2;",
  "```",
  "",
  "- list item one",
  "- list item two",
].join("\n");

describe("md-to-jsonl", () => {
  it("md_to_jsonl_chunks_le_200", () => {
    for (const r of mdToRows(sample)) expect(Array.from(r.text).length).toBeLessThanOrEqual(200);
    expect(mdToRows("x".repeat(450))).toHaveLength(3); // no spaces: hard cut at 200
  });

  it("md_to_jsonl_sections_from_headings", () => {
    const rows = mdToRows(sample);
    expect(mdToRows("no heading here.")[0]?.section).toBe("body");
    expect(rows[0]).toEqual({ section: "Report title", chunk: 0, text: "First sentence." });
    expect(rows.slice(0, 3).map((r) => r.text)).toEqual(["First sentence.", "Second one?", "Third!"]);
    expect(new Set(rows.map((r) => r.section))).toEqual(new Set(["Report title", "Findings"]));
    expect(rows.find((r) => r.section === "Findings")?.chunk).toBe(0);
    expect(rows.some((r) => r.text === "const a = 1; const b = 2;")).toBe(true); // code block on one line
  });

  it("md_to_jsonl_rejects_over_5mb", () => {
    expect(() => mdToRows("a".repeat(5 * 1024 * 1024 + 1))).toThrow(RangeError);
    expect(() => mdToRows("a\n".repeat(200001))).toThrow(RangeError);
  });

  it("md_to_jsonl_stable_output", () => {
    expect(toJsonl(mdToRows(sample))).toBe(toJsonl(mdToRows(sample)));
    const first = toJsonl(mdToRows(sample)).split("\n")[0] as string;
    expect(JSON.parse(first)).toEqual({ section: "Report title", chunk: 0, text: "First sentence." });
    expect(Object.keys(JSON.parse(first))).toEqual(["section", "chunk", "text"]);
  });
});
