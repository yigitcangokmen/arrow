// WS5-T07: /verify shows the same rows as `npm run verify`. Both sides run the one engine over the same fake network,
// the CLI through its --json output and the page through its server loader; ids, labels and REQUIRED flags must match.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Report } from "@arrow/sdk/verify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/src/verify.ts";
import { mainCheckout, repoRoot } from "../../scripts/src/lib/env.ts";
import { buildWorld, fakeFetch } from "../../sdk/test/verify/world.ts";
import { loadReport } from "../lib/server/verifyReport.ts";
import { groupRows, linkText, reportJson, safeHref, summaryLine, summaryView } from "../lib/verifyView.ts";

afterEach(() => vi.unstubAllGlobals());

const project = (r: Report) => r.rows.map((x) => [x.id, x.label, x.required]);
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);

/** The inputs the CLI reads from disk, read the same way, so both sides see the same release hash and team list. */
function cliInputs() {
  const release = read(resolve(repoRoot(), "release/sha256.txt")) ?? read(resolve(mainCheckout(), "release/sha256.txt"));
  const team = read(resolve(mainCheckout(), "evidence/team-accounts.json"));
  const parsed = team ? JSON.parse(team) : null;
  return {
    releaseSha256: release?.trim().split(/\s+/)[0],
    teamAccounts: parsed ? [...(parsed.near ?? []), ...(parsed.evm ?? []).map((e: { address: string }) => e.address)] : undefined,
  };
}

async function bothSides(w = buildWorld("testnet")) {
  vi.stubGlobal("fetch", fakeFetch(w));
  const dir = mkdtempSync(join(tmpdir(), "verify-web-"));
  const file = join(dir, "testnet.json");
  writeFileSync(file, JSON.stringify(w.evidence));
  const out: string[] = [];
  await main(["--network", "testnet", "--evidence", file, "--json"], { out: (l) => out.push(l), err: () => {} });
  const cli = JSON.parse(out.join("\n")) as Report;
  const web = (await loadReport({ network: "testnet", evidence: w.evidence, fetchImpl: fakeFetch(w), ...cliInputs() })).report!;
  return { cli, web };
}

describe("verify parity", () => {
  it("web rows == CLI rows (id, label, required) and the summary line is the CLI's line", async () => {
    const { cli, web } = await bothSides();
    expect(project(web)).toEqual(project(cli));
    expect(summaryLine(web)).toBe(summaryLine(cli));
    expect(summaryLine(web)).toMatch(/^verify: \d+\/\d+ REQUIRED PROVEN · exit [01]$/);
  });

  it("not_proven_never_counts_as_pass: a REQUIRED row that is NOT PROVEN gives N-1/N and FAIL", async () => {
    const w = buildWorld("testnet");
    w.attestations = {};
    const { cli, web } = await bothSides(w);
    const r2 = web.rows.find((r) => r.id === "R2")!;
    expect(r2).toMatchObject({ label: "NOT PROVEN", required: true });
    expect(project(web)).toEqual(project(cli));
    const v = summaryView(web);
    const notProven = web.rows.filter((r) => r.required && r.label !== "PROVEN").length;
    expect(notProven).toBeGreaterThan(0);
    expect(v.passed).toBe(false);
    expect(v.line).toBe(`verify: ${web.required.total - notProven}/${web.required.total} REQUIRED PROVEN · exit 1`);
    expect(v.failure).toBe(`FAIL: ${notProven} of ${web.required.total} REQUIRED rows are not PROVEN`);
    expect(v.line).toBe(summaryLine(cli));
  });

  it("a fully proven world passes and shows no failure text", async () => {
    const w = buildWorld("testnet");
    const { report } = await loadReport({ network: "testnet", evidence: w.evidence, fetchImpl: fakeFetch(w), releaseSha256: w.releaseSha256 });
    expect(summaryView(report!)).toEqual({ line: "verify: 5/5 REQUIRED PROVEN · exit 0", passed: true, busy: false, failure: null });
  });

  it("without release/sha256.txt (before the freeze) R1 is NOT PROVEN and the line says so", async () => {
    const w = buildWorld("testnet");
    const { report } = await loadReport({ network: "testnet", evidence: w.evidence, fetchImpl: fakeFetch(w), releaseSha256: null });
    expect(report!.rows.find((r) => r.id === "R1")).toMatchObject({ label: "NOT PROVEN", required: true });
    expect(summaryView(report!).passed).toBe(false);
  });

  it("with no REQUIRED row at all the page does not call it a pass", () => {
    const empty = { rows: [], required: { proven: 0, total: 0 }, exitCode: 1, network: "testnet", contract: "c", generatedAt: "2026-11-11T00:00:00.000Z", preLock: false } as Report;
    expect(summaryView(empty)).toMatchObject({ passed: false, failure: "FAIL: no REQUIRED row ran" });
  });
});

describe("verify view helpers", () => {
  it("groups REQUIRED, also-checked, NOT PROVEN by design and RISKY, and drops empty groups", async () => {
    const { web } = await bothSides();
    const groups = groupRows(web.rows);
    const ids = (k: string) => groups.find((g) => g.key === k)?.rows.map((r) => r.id);
    expect(ids("required")).toEqual(["R1", "R2", "R3", "R5", "R8"]);
    expect(ids("notproven")).toEqual(["N1", "N2"]);
    expect(ids("risky")).toEqual(["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"]);
    expect(groups.flatMap((g) => g.rows).length).toBe(web.rows.length);
    expect(groupRows([]).length).toBe(0);
  });

  it("the embedded report cannot end its script element and parses back to the same report", async () => {
    const { web } = await bothSides();
    const hostile = { ...web, rows: [{ ...web.rows[0]!, title: "</script><img src=x onerror=1>" }] } as Report;
    const text = reportJson(hostile);
    expect(text).not.toContain("</script");
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual(hostile);
  });
});

describe("row links", () => {
  it("only https links are rendered, shortened to host and path start", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://x.example/a")).toBeNull();
    expect(safeHref("https://testnet.nearblocks.io/txns/abc")).toBe("https://testnet.nearblocks.io/txns/abc");
    expect(linkText("https://testnet.nearblocks.io/txns/DahVhGj18fhb8rTmDnT5ZrDhHiCJ79GBgoYhfnWs3CT4")).toBe("testnet.nearblocks.io/txns/DahVhGj18fhb8rTmDn…");
    expect(linkText("https://solscan.io/tx/abc")).toBe("solscan.io/tx/abc");
  });
});
