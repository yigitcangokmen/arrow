// WS4-T08 acceptance: env_* tests.
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EnvKeyExistsError, setEnvSecret } from "../src/lib/env.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "arrow-env-"));

describe("setEnvSecret", () => {
  it("env_writes_only_target_file", () => {
    const dir = tmp();
    const target = join(dir, "target.env");
    const other = join(dir, "other.env");
    writeFileSync(other, "X=1\n");
    expect(setEnvSecret("A", "v", { path: target })).toEqual({ created: true });
    expect(readFileSync(target, "utf8")).toBe("A=v\n");
    expect(readFileSync(other, "utf8")).toBe("X=1\n");
    expect(readdirSync(dir).sort()).toEqual(["other.env", "target.env"]);
  });

  it("env_refuses_overwrite", () => {
    const f = join(tmp(), ".env");
    writeFileSync(f, "A=old\nB=\n");
    const before = readFileSync(f);
    expect(() => setEnvSecret("A", "new", { path: f })).toThrow(EnvKeyExistsError);
    expect(readFileSync(f).equals(before)).toBe(true);
  });

  it("env_fills_empty_placeholder", () => {
    const f = join(tmp(), ".env");
    const text = "# header\nA=1\nNAME=\nB=2\n# NAME=commented\n";
    writeFileSync(f, text);
    expect(setEnvSecret("NAME", "secret", { path: f })).toEqual({ created: false });
    expect(readFileSync(f, "utf8")).toBe(text.replace("\nNAME=\n", "\nNAME=secret\n"));
  });

  it("env_file_mode_0600", () => {
    const dir = tmp();
    const fresh = join(dir, "fresh.env");
    setEnvSecret("A", "v", { path: fresh });
    expect(statSync(fresh).mode & 0o777).toBe(0o600);
    const loose = join(dir, "loose.env");
    writeFileSync(loose, "A=\n", { mode: 0o644 });
    setEnvSecret("A", "v", { path: loose });
    expect(statSync(loose).mode & 0o777).toBe(0o600);
  });

  it("appends after a file without trailing newline", () => {
    const f = join(tmp(), ".env");
    writeFileSync(f, "A=1");
    setEnvSecret("B", "2", { path: f });
    expect(readFileSync(f, "utf8")).toBe("A=1\nB=2\n");
    expect(existsSync(f)).toBe(true);
  });
});
