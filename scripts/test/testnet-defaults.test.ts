// N1: a script must not carry its own default for the testnet market. A clean clone without .env gets the SDK default
// (ARROW_CONTRACT_TESTNET overrides it), so moving the market to a new account is one edit in one place.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "node_modules" || n === "fixtures" ? [] : walk(p)) : /\.(ts|sh)$/.test(n) ? [p] : [];
  });

describe("testnet market default", () => {
  it("no script under scripts/src or scripts/dev hard-codes the testnet market as a default", () => {
    const hits = [...walk(join(ROOT, "scripts/src")), ...walk(join(ROOT, "scripts/dev"))]
      .filter((f) => !f.endsWith("perf-local.ts")) // the local wasm harness names an allowlisted predecessor on purpose
      .filter((f) => /["'`]arrow(-v2)?\.arrowhq\.testnet["'`]/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });
});
