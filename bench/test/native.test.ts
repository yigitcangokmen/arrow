// CI-7: `npm run bench:native` must not overwrite the committed injection-room evidence (native-gates.json).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NATIVE_STATS, writeNativeStats } from "../src/native.ts";

let root: string;
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "arrow-native-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("bench:native output", () => {
  it("writes native-stats.json and leaves native-gates.json byte for byte as it was", () => {
    const gates = join(root, "bench/results/native-gates.json");
    mkdirSync(join(root, "bench/results"), { recursive: true });
    const evidence = JSON.stringify({ v: 1, cases: { "R-P1": { regex_flag: true, gate_name: "inject", fit_rule: 5, hit: true } } }, null, 2) + "\n";
    writeFileSync(gates, evidence);
    const file = writeNativeStats(root, { v: 1, cases: { "R-P1": { regex_flag: null, gate_name: null, fit_rule: 5 } } });
    expect(file).toBe(join(root, NATIVE_STATS));
    expect(readFileSync(gates, "utf8")).toBe(evidence);
    expect(JSON.parse(readFileSync(file, "utf8")).cases["R-P1"].regex_flag).toBeNull();
  });
});
