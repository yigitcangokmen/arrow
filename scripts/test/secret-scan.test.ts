// CI-5: the STRICT patterns of scripts/secret-scan.sh must catch the quoted and JSON forms (CI also runs gitleaks, in its own job).
// The secret-looking lines are built from parts so that the scanner does not flag this file.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../secret-scan.sh");
const HEX64 = "ab".repeat(32);
let repo: string;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "arrow-secret-scan-"));
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function scan(args: string[], line: string | null, env: NodeJS.ProcessEnv = process.env) {
  writeFileSync(join(repo, "notes.md"), line ?? "nothing to see\n");
  git("add", "notes.md");
  git("commit", "-q", "-m", "notes");
  const r = spawnSync("bash", [SCRIPT, ...args], { cwd: repo, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("secret-scan.sh strict patterns", () => {
  const lines: [string, string][] = [
    ["an env line with a generated protected secret", `PROTECTED_${"MASTER"}=${HEX64}\n`],
    ["the same line as a JSON member", `{"PROTECTED_${"MASTER"}":"${HEX64}"}\n`],
    ["an outlayer secrets set line with a quoted key", `outlayer secrets set '{"NEARAI_API_${"KEY"}":"nk_live_${"0123456789abcdef"}"}'\n`],
  ];
  for (const [what, line] of lines) {
    it(`fails on ${what}`, () => {
      const r = scan(["--ci", "--no-gitleaks"], line);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("SECRET_SCAN: FAIL");
    });
  }

  it("passes on a clean repo", () => {
    const r = scan(["--no-gitleaks"], null);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("SECRET_SCAN: PASS");
  });

  it("the run that is meant to use gitleaks (the CI job secrets) fails when gitleaks is missing", () => {
    const r = scan([], null, { ...process.env, PATH: "/usr/bin:/bin" });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("SECRET_SCAN: FAIL");
  });
});
