// Acceptance tests for docs/submission/{idea.txt,x-post.md} (WS7-T07).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { weightedLength } from "../src/lib/xlen.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const post = read("docs/submission/x-post.md");
const block = (heading: string) => {
  const m = new RegExp(`## ${heading}\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``).exec(post);
  if (m === null) throw new Error(`no ${heading} block`);
  return m[1]!;
};

describe("submission texts", () => {
  it("idea_20_to_2000_chars", () => {
    const idea = read("docs/submission/idea.txt");
    const body = idea.split("\nTODO(")[0]!.trim(); // the TODO paragraph is removed before submitting
    expect([...body].length).toBeGreaterThanOrEqual(20);
    expect([...body].length).toBeLessThanOrEqual(2000);
    expect([...idea].length).toBeLessThanOrEqual(2000);
  });
  it("idea_has_problem_product_near_role", () => {
    const idea = read("docs/submission/idea.txt");
    for (const w of ["Problem:", "Product:", "NEAR's role:"]) expect(idea).toContain(w);
  });
  it("x_post_le_280_weighted", () => {
    expect(weightedLength(block("Post"))).toBeLessThanOrEqual(280);
  });
  it("x_reply_le_280_weighted", () => {
    expect(weightedLength(block("Reply"))).toBeLessThanOrEqual(280);
  });
  it("x_post_has_required_tags", () => {
    const p = block("Post");
    expect(p.toLowerCase()).toContain("built at near hackathon");
    expect(p).toContain("@NEARProtocol");
    expect(p).toContain("#NEARHackathon");
    expect(p).toContain("https://github.com/yigitcangokmen/arrow");
  });
  it("x_post_first_line_is_problem", () => {
    expect(block("Post").split("\n")[0]).not.toContain("Arrow");
  });
  it("x_post_has_question", () => {
    expect(/\?(\s|$)/m.test(block("Post") + "\n" + block("Reply"))).toBe(true);
  });
  it("no_personal_data_in_repo_texts", () => {
    for (const f of ["docs/submission/idea.txt", "docs/submission/x-post.md"]) expect(read(f)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
