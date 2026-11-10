// X12-5: the scripts that hold keys refuse to run on a Node below package.json "engines" (a plain agent shell opens Node 18).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nodeProblem } from "../src/lib/node-version.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NODE18 = join(homedir(), ".nvm/versions/node/v18.20.8/bin");
const have18 = existsSync(join(NODE18, "node"));
const on18 = { ...process.env, PATH: `${NODE18}:${process.env.PATH}` };

describe("node floor", () => {
  it("names nvm use below 22.22.2 and nothing at or above", () => {
    expect(nodeProblem("18.20.8")).toContain("nvm use");
    expect(nodeProblem("22.9.0")).toContain("found 22.9.0");
    expect(nodeProblem("22.22.1")).not.toBeNull();
    for (const ok of ["22.22.2", "22.23.2", "24.15.0"]) expect(nodeProblem(ok), ok).toBeNull();
  });

  it.skipIf(!have18)("check-all.sh exits 2 with nvm use on Node 18, before it runs any gate", () => {
    const r = spawnSync("bash", [join(ROOT, "scripts/check-all.sh")], { cwd: ROOT, env: on18, encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("nvm use");
  }, 40_000);

  it.skipIf(!have18)("evidence-add.ts and e2e-mainnet.ts exit 2 with nvm use on Node 18", () => {
    for (const script of ["evidence-add.ts", "e2e-mainnet.ts"]) {
      const r = spawnSync("node", [join(ROOT, "node_modules/tsx/dist/cli.mjs"), join(ROOT, "scripts/src", script), "--help"], { cwd: ROOT, env: on18, encoding: "utf8", timeout: 30_000 });
      expect(r.status, script).toBe(2);
      expect(r.stderr, script).toContain("nvm use");
    }
  }, 60_000);
});
