// CI-11(c)-(f): pinned actions, no network in the lib test step, a critical-advisory gate, a test timeout that
// survives a loaded machine.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("ci supply chain", () => {
  const ci = read(".github/workflows/ci.yml");

  it("ci_actions_pinned_by_sha (CI-11c)", () => {
    const uses = [...ci.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("ci_lib_tests_do_not_download_the_sandbox (CI-11d)", () => {
    const step = ci.split(/^\s*- run: /m).find((s) => s.startsWith("cargo test -p arrow --lib"));
    expect(step).toBeDefined();
    expect(step).toMatch(/NEAR_SANDBOX_BIN_PATH:/);
  });

  it("ci_fails_on_a_critical_advisory (CI-11f)", () => {
    expect(ci).toMatch(/run: npm audit --omit=dev --audit-level=critical/);
  });

  it("vitest_timeout_covers_ecies_cases (CI-11e)", () => {
    expect(read("vitest.config.ts")).toMatch(/testTimeout:\s*20_?000/);
  });
});
