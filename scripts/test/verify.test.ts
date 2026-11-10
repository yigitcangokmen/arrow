// WS4-T13: the verify CLI wrapper: flags, exit codes and what it prints. The engine itself is tested in sdk/test/verify.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/verify.ts";
import { buildWorld, fakeFetch } from "../../sdk/test/verify/world.ts";

const collect = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
};

afterEach(() => vi.unstubAllGlobals());

describe("verify CLI", () => {
  it("usage errors exit 2 and print nothing to stdout", async () => {
    for (const argv of [["--network", "devnet"], ["--only", "nonsense"], ["--bogus"], ["--unlocked-reason", " "]]) {
      const c = collect();
      expect(await main(argv, c.io), argv.join(" ")).toBe(2);
      expect(c.out).toEqual([]);
      expect(c.err.length).toBeGreaterThan(0);
    }
  });

  it("--help prints usage and exits 0", async () => {
    const c = collect();
    expect(await main(["--help"], c.io)).toBe(0);
    expect(c.out.join("\n")).toContain("--pre-lock");
  });

  it("prints rows and the summary line, and --json prints the report", async () => {
    const w = buildWorld("testnet");
    vi.stubGlobal("fetch", fakeFetch(w));
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const evidence = join(dir, "testnet.json");
    writeFileSync(evidence, JSON.stringify(w.evidence));

    const text = collect();
    const code = await main(["--network", "testnet", "--evidence", evidence, "--only", "g1,refund"], text.io);
    expect(code).toBe(0);
    expect(text.out.at(-1)).toBe("verify: 2/2 REQUIRED PROVEN · exit 0");

    const json = collect();
    await main(["--network", "testnet", "--evidence", evidence, "--only", "g1", "--json"], json.io);
    const report = JSON.parse(json.out.join("\n"));
    expect(report).toMatchObject({ network: "testnet", exitCode: 0, required: { proven: 1, total: 1 } });
    expect(report.rows[0]).toMatchObject({ id: "R8", label: "PROVEN", required: true });
  });

  it("a REQUIRED row that is not PROVEN gives exit 1", async () => {
    const w = buildWorld("testnet");
    w.leak[1].spent_milli = 5;
    vi.stubGlobal("fetch", fakeFetch(w));
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const evidence = join(dir, "testnet.json");
    writeFileSync(evidence, JSON.stringify(w.evidence));
    const c = collect();
    expect(await main(["--network", "testnet", "--evidence", evidence, "--only", "g1"], c.io)).toBe(1);
    expect(c.out.at(-1)).toBe("verify: 0/1 REQUIRED PROVEN · exit 1");
    expect(readFileSync(evidence, "utf8")).toContain("testnet"); // the evidence file is only read
  });
});
