// Acceptance tests for scripts/src/check-judges.ts (WS7-T05).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkReadme, checkRows, loadSources, main, parseJudges } from "../src/check-judges.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fx = (n: string) => readFileSync(resolve(ROOT, "scripts/test/fixtures/judges", n), "utf8");
const src = loadSources(ROOT);
const check = (n: string) => checkRows(parseJudges(fx(n)), ROOT, src);

describe("check-judges", () => {
  it("accepts_valid_table", () => {
    expect(parseJudges(fx("ok.md"))).toHaveLength(2);
    expect(check("ok.md")).toEqual([]);
  });
  it("flags_missing_path", () => {
    expect(check("missing-path.md")).toEqual(["JUDGES.md:1: missing enclave/nope/missing.rs"]);
  });
  it("flags_missing_test", () => {
    expect(check("missing-test.md")).toEqual(["JUDGES.md:1: missing test no_such_test_anywhere"]);
  });
  it("flags_bad_label", () => {
    expect(check("bad-label.md")[0]).toContain("bad label");
  });
  it("proven_rows_need_command", () => {
    const p = check("proven-no-command.md");
    expect(p[0]).toContain("PROVEN row without a command");
    expect(p[1]).toContain("must say why");
  });
  it("readme_mode_flags_unknown_test_names", () => {
    const fake = ["made", "up", "test", "name"].join("_"); // built at run time so the source scan cannot find it
    expect(checkReadme(`run \`cargo test\` for \`output_le_900_bytes\` and \`${fake}\``, src)).toEqual([`README.md:1: missing test ${fake}`]);
  });
  it("real_judges_md_has_no_missing_rows", () => {
    expect(main([])).toBe(0);
  });
});
