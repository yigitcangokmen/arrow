// Acceptance tests for scripts/check-claims.sh (WS7-T04a).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = resolve(ROOT, "scripts/check-claims.sh");
const fx = (n: string) => resolve(ROOT, "scripts/test/fixtures/claims", n);

function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? -1, out: err.stdout ?? "" };
  }
}

const RULES = [
  "first-claim", "x402-extension", "x402-payment", "x402-standard", "no-bridge", "trustless", "nothing-leaks",
  "evm-impossible", "funds-never-leave", "refund-to-wallet", "llm-cannot-buy", "deterministic-llm", "npx-arrow",
  "pay-if", "tender-core", "seal-until", "tee-escrow-headline", "split-screen", "pass-refund", "x402-compatible",
  "verdict-leaves", "own-chain-payout", "zk", "receipt-tree-placement", "quoted-block-misplaced",
];

describe("check-claims.sh", () => {
  it("flags_every_banned_rule", () => {
    const r = run(["--files", fx("bad.md")]);
    expect(r.code).toBe(1);
    for (const rule of RULES) expect(r.out, `rule ${rule}`).toContain(`[${rule}]`);
    expect(r.out).toMatch(/bad\.md:\d+: \[/);
  });

  it("allows_legit_uses", () => {
    const r = run(["--files", fx("good.md")]);
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  });

  it("receipt_tree_only_in_how_it_works", () => {
    const r = run(["--files", fx("readme-sections.md")]);
    expect(r.code).toBe(1);
    const lines = r.out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[receipt-tree-placement]");
    expect(lines[0]).toContain("not for the problem section");
  });

  it("final_mode_flags_placeholders", () => {
    expect(run(["--files", fx("final-placeholders.md"), "--final"]).code).toBe(1);
    const out = run(["--final", "--files", fx("final-placeholders.md")]).out;
    expect(out).toContain("[final-placeholder]");
    expect(out.split("\n").filter((l) => l.includes("[final-placeholder]")).length).toBeGreaterThanOrEqual(4);
    expect(run(["--files", fx("final-placeholders.md")]).code).toBe(0);
  });

  it("quoted_block_outside_allowed_sections_flagged", () => {
    const r = run(["--files", fx("bad.md")]);
    expect(r.out).toMatch(/\[quoted-block-misplaced\] quoted block outside an allowed section/);
    const unclosed = run(["--files", fx("quoted-closed.md")]);
    expect(unclosed.code).toBe(1);
    expect(unclosed.out).toContain("quoted block never closed");
  });

  it("runs_on_bsd_and_gnu_grep", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toMatch(/grep\s+(-\w+\s+)*-\w*P/);
    expect(code).not.toContain("\\b");
    expect(code).not.toContain("mapfile");
  });

  it("scans_code_dirs_when_docs_dirs_are_missing", () => {
    // F2: find on a missing docs/submission or docs/video used to abort collect() under set -e, so nothing after it was scanned
    const root = mkdtempSync(resolve(tmpdir(), "claims-tree-"));
    try {
      mkdirSync(resolve(root, "scripts"));
      copyFileSync(SCRIPT, resolve(root, "scripts/check-claims.sh"));
      for (const [path, text] of [
        ["web/app/page.tsx", "const a = 'a trustless market';\n"],
        ["web/components/Hero.tsx", "const b = 'nothing leaks';\n"],
        ["web/lib/trust.ts", "const c = 'impossible on EVM';\n"],
        ["agent/src/cli.ts", "const d = 'no bridge';\n"],
        ["docs/outreach/invite.md", "we are trustless\n"],
      ] as const) {
        mkdirSync(dirname(resolve(root, path)), { recursive: true });
        writeFileSync(resolve(root, path), text);
      }
      let out = "";
      let code = 0;
      try {
        execFileSync("bash", [resolve(root, "scripts/check-claims.sh")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const err = e as { status?: number; stdout?: string };
        code = err.status ?? -1;
        out = err.stdout ?? "";
      }
      expect(code).toBe(1);
      for (const f of ["web/app/page.tsx", "web/components/Hero.tsx", "web/lib/trust.ts", "agent/src/cli.ts", "docs/outreach/invite.md"]) expect(out, f).toContain(`${f}:1:`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("current_surfaces_are_clean_outside_the_readme_skeleton", () => {
    // the judge-facing code and docs on this branch must not trip any rule
    const r = run([]);
    const bad = r.out.split("\n").filter((l) => l && !l.startsWith("README.md:"));
    expect(bad).toEqual([]);
  }, 60_000); // scans the whole judge-facing tree since F2; it took 10 s before the single-pass prefilter
});
