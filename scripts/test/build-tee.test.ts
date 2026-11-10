// X12-2 / CI-6: the wasm embeds dependency source paths, so scripts/build-tee.sh must remap CARGO_HOME wherever it is.
// A stub cargo records what the script hands to it; the real proof (three real builds, one sha) is in the fix report.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let tmp: string;
const OUT = `target/rel-tee-test-${process.pid}`;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arrow-build-tee-"));
  mkdirSync(join(tmp, "bin"));
  const stub = join(tmp, "bin", "cargo");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
printf 'RUSTFLAGS=%s\\nENCODED=%s\\n' "$RUSTFLAGS" "\${CARGO_ENCODED_RUSTFLAGS:-}" > "${tmp}/seen"
mkdir -p "$CARGO_TARGET_DIR/wasm32-wasip2/release"
printf wasm > "$CARGO_TARGET_DIR/wasm32-wasip2/release/arrow-tee.wasm"
`,
  );
  chmodSync(stub, 0o755);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(join(ROOT, OUT), { recursive: true, force: true });
});

function build(env: Record<string, string>) {
  const base: Record<string, string> = { PATH: `${join(tmp, "bin")}:${process.env.PATH}`, HOME: "/home/builder" };
  const r = spawnSync("bash", [join(ROOT, "scripts/build-tee.sh"), OUT], { cwd: ROOT, env: { ...base, ...env }, encoding: "utf8" });
  let seen = "";
  try {
    seen = readFileSync(join(tmp, "seen"), "utf8");
  } catch {
    // cargo was never called
  }
  return { code: r.status, err: r.stderr, seen };
}

describe("build-tee.sh path remaps", () => {
  it("remaps a CARGO_HOME outside HOME to the same /h/.cargo the default location gets", () => {
    const foreign = build({ CARGO_HOME: "/usr/local/cargo" });
    expect(foreign.code).toBe(0);
    expect(foreign.seen).toContain("--remap-path-prefix=/usr/local/cargo=/h/.cargo");
    const dflt = build({});
    expect(dflt.code).toBe(0);
    expect(dflt.seen).toContain("--remap-path-prefix=/home/builder/.cargo=/h/.cargo");
    // the checkout stays the last remap (last match wins)
    expect(foreign.seen).toMatch(new RegExp(`--remap-path-prefix=${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=/w\\n`));
  });

  it("drops CARGO_ENCODED_RUSTFLAGS and refuses CARGO_PROFILE_RELEASE_* because they change the sha silently", () => {
    const enc = build({ CARGO_ENCODED_RUSTFLAGS: "-Cdebuginfo=2" });
    expect(enc.code).toBe(0);
    expect(enc.seen).toContain("ENCODED=\n");
    const prof = build({ CARGO_PROFILE_RELEASE_LTO: "off" });
    expect(prof.code).toBe(2);
    expect(prof.err).toContain("CARGO_PROFILE_RELEASE_");
  });
});
