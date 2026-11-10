// STATE-7 / CI-1: `mainnet-check.sh wasm` (and `pre`, which runs the same rows first) must fail when the contract source or the wire vectors
// changed after the commit that is embedded in the release wasm (NEP-330 source_code_snapshot).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../deploy/mainnet-check.sh");
let repo: string;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
const put = (rel: string, body: string) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), body);
};
const commit = (msg: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};
/** a release wasm whose NEP-330 metadata names `rev`, and the SHA256SUMS line for it */
function release(rev: string | null) {
  const meta = rev ? `{"build_info":{"source_code_snapshot":"git+https://example.test/arrow?rev=${rev}"}}` : `{"build_info":{}}`;
  put("release/contracts/arrow-mainnet.wasm", `\0asm\u0001${meta}`);
  const sha = execFileSync("shasum", ["-a", "256", join(repo, "release/contracts/arrow-mainnet.wasm")], { encoding: "utf8" }).split(" ")[0];
  put("release/contracts/SHA256SUMS", `${sha}  arrow-mainnet.wasm\n`);
}
const check = () => {
  const r = spawnSync("bash", [SCRIPT, "wasm"], { cwd: repo, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "arrow-mainnet-check-"));
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  put("contracts/arrow/src/lib.rs", "fn a() {}\n");
  put("contracts/arrow/tests/sandbox.rs", "// t\n");
  put("contracts/arrow/README.md", "# c\n");
  put("Cargo.lock", "# lock\n");
  put("rust-toolchain.toml", "[toolchain]\n");
  for (const f of ["input", "output", "msg"]) put(`fixtures/${f}-vectors.json`, "{}\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("mainnet-check.sh wasm", () => {
  it("passes when nothing that goes into the wasm changed since the embedded rev, whatever else moved", () => {
    const rev = commit("source");
    release(rev);
    commit("release");
    put("contracts/arrow/tests/sandbox.rs", "// more tests\n");
    put("contracts/arrow/README.md", "# docs\n");
    put("web/x.ts", "export {}\n");
    commit("tests, docs, web");
    const r = check();
    expect(r.out).toContain("PASS contract_wasm_fresh");
    expect(r.code).toBe(0);
  });

  it.each([
    ["the contract source", "contracts/arrow/src/lib.rs"],
    ["the lockfile", "Cargo.lock"],
    ["the toolchain", "rust-toolchain.toml"],
    ["the shared input vectors", "fixtures/input-vectors.json"],
  ])("fails contract_wasm_stale when %s changed after the embedded rev", (_what, file) => {
    const rev = commit("source");
    release(rev);
    commit("release");
    put(file, "changed\n");
    commit("change");
    const r = check();
    expect(r.out).toContain("FAIL contract_wasm_stale");
    expect(r.out).toContain(file);
    expect(r.code).toBe(1);
  });

  it("fails when the wasm carries no source rev or names a commit this clone lacks", () => {
    commit("source");
    release(null);
    commit("release without rev");
    expect(check().out).toContain("FAIL contract_wasm_stale: release/contracts/arrow-mainnet.wasm carries no NEP-330 source rev");
    release("0123456789abcdef0123456789abcdef01234567");
    const r = check();
    expect(r.out).toContain("which is not in this clone");
    expect(r.code).toBe(1);
  });
});
