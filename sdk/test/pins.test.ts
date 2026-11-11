// x12-supply:X12-6: every dependency spec in a workspace manifest is an exact version (the K0 interop pair is
// eciesjs 0.4.18 <-> ecies 0.2.11); engines may stay a range.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("exact dependency versions", () => {
  it("no workspace manifest uses ^, ~, > or * in a dependency spec", () => {
    const loose: string[] = [];
    for (const ws of [".", "sdk", "agent", "web", "scripts", "bench"]) {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, ws, "package.json"), "utf8"));
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, spec] of Object.entries<string>(pkg[field] ?? {})) {
          if (/^[\^~><*]|^latest$|\|\|| - /.test(spec)) loose.push(`${ws}/package.json ${name}@${spec}`);
        }
      }
    }
    expect(loose).toEqual([]);
  });

  it("the web app pins the Node major of .nvmrc, so Vercel does not build it on another one", () => {
    const major = readFileSync(resolve(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0];
    expect(JSON.parse(readFileSync(resolve(ROOT, "web/package.json"), "utf8")).engines?.node).toBe(`${major}.x`);
  });

  it("eciesjs is the K0 interop version", () => {
    expect(JSON.parse(readFileSync(resolve(ROOT, "sdk/package.json"), "utf8")).dependencies.eciesjs).toBe("0.4.18");
  });
});
