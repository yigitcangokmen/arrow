// WS4-T17 acceptance: the payload is built from the inputs file plus flags, checked against the contract, written outside the repo and never sent.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoRoot } from "../src/lib/env.ts";
import { CONSENT_NOTICE, FIELDS, KNOWN_CONTRACT, preview, type PreviewDeps, validatePayload } from "../src/submission-preview.ts";

const DOC = "x".repeat(KNOWN_CONTRACT.bytes);
const IDEA = "Arrow lets a buyer test a private data set inside a TEE before paying for it.";
const INPUTS = {
  leadName: "Test Lead",
  email: "lead@example.com",
  size: "2 - 4",
  nearAddress: "team-wallet.near",
  demoUrl: "https://x.com/example/status/1",
};
let dir: string;
let repo: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arrow-sub-"));
  repo = mkdtempSync(join(tmpdir(), "arrow-sub-repo-"));
  mkdirSync(join(repo, "docs/submission"), { recursive: true });
  writeFileSync(join(repo, "docs/submission/idea.txt"), IDEA + "\n");
  // the recorded byte count (checklist.md) is what the live size is compared with; the fake document has no real sha256
  writeFileSync(join(repo, "docs/submission/checklist.md"), `- HACKATHON.md last read: ${KNOWN_CONTRACT.bytes} bytes\n`);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function fetchMock(body: string = DOC) {
  return vi.fn(async (_url: unknown, _init?: unknown) => new Response(body));
}
function deps(f: ReturnType<typeof fetchMock> = fetchMock()) {
  const lines: string[] = [];
  const d: PreviewDeps = { fetchImpl: f as unknown as typeof fetch, dir, repo, say: (l) => lines.push(l) };
  return { d, lines, f };
}
const writeInputs = (o: Record<string, unknown> = INPUTS) => writeFileSync(join(dir, "submission-inputs.json"), JSON.stringify(o));
const written = () => JSON.parse(readFileSync(join(dir, "submission.json"), "utf8"));

describe("submission-preview", () => {
  it("exactly_eleven_fields_no_website", async () => {
    writeInputs();
    const { d } = deps();
    const r = await preview({}, d);
    expect(r.exit).toBe(0);
    expect(Object.keys(written()).sort()).toEqual([...FIELDS].sort());
    expect(Object.keys(written())).toHaveLength(11);
    expect(written()).not.toHaveProperty("website");
    expect(validatePayload({ ...written(), website: "" })[0]).toMatch(/exactly the 11 fields/);
  });

  it("rejects_locked_contract_address", async () => {
    for (const nearAddress of ["arrow-market.near", "arrow-market-v2.near"]) {
      writeInputs({ ...INPUTS, nearAddress });
      const { d } = deps();
      const r = await preview({}, d);
      expect(r.exit).toBe(2);
      expect(r.errors.join("\n")).toMatch(/locked market contract/);
      expect(existsSync(join(dir, "submission.json"))).toBe(false);
    }
  });

  it("reads_inputs_file", async () => {
    writeInputs();
    const { d } = deps();
    expect((await preview({}, d)).exit).toBe(0);
    expect(written()).toMatchObject({ leadName: "Test Lead", email: "lead@example.com", size: "2 - 4", nearAddress: "team-wallet.near", projectName: "Arrow", idea: IDEA });
    expect(written().tracks).toEqual(["privacy", "agents", "security", "open"]);
    expect((await preview({ email: "other@example.com" }, d)).exit).toBe(0);
    expect(written().email).toBe("other@example.com");
    expect(written().leadName).toBe("Test Lead");
  });

  it("dry_flag_is_noop_alias", async () => {
    // --dry only exists on the command line: the preview itself has no mode, so two runs must write the same bytes and never POST
    writeInputs();
    const a = deps();
    await preview({}, a.d);
    const first = readFileSync(join(dir, "submission.json"), "utf8");
    const b = deps();
    await preview({}, b.d);
    expect(readFileSync(join(dir, "submission.json"), "utf8")).toBe(first);
    expect(b.lines.join("\n")).toBe(a.lines.join("\n"));
    expect(a.f.mock.calls.concat(b.f.mock.calls).every(([, init]) => (init as { method?: string } | undefined)?.method === undefined)).toBe(true);
    const src = readFileSync(join(repoRoot(), "scripts/src/submission-preview.ts"), "utf8");
    expect(src).toMatch(/dry: \{ type: "boolean" \}/);
    expect(src).not.toMatch(/\b(?:v|values)\.dry\b/);
  });

  it("rejects_missing_human_fields", async () => {
    writeInputs({ leadName: "Test Lead", email: "<contact email>", size: "" });
    const { d } = deps();
    const r = await preview({}, d);
    expect(r.exit).toBe(2);
    expect(r.errors.join("\n")).toMatch(/missing human fields: email, size, nearAddress, demoUrl/);
    expect(existsSync(join(dir, "submission.json"))).toBe(false);
    expect((await preview({ email: "a@b.co", size: "1", nearAddress: "me.near", demoUrl: "https://x.com/a/status/1" }, deps().d)).exit).toBe(0);
  });

  it("request_id_generated_once", async () => {
    writeInputs();
    await preview({}, deps().d);
    const id = written().requestId;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(readFileSync(join(dir, "submission-request-id"), "utf8").trim()).toBe(id);
    expect(statSync(join(dir, "submission-request-id")).mode & 0o777).toBe(0o600);
    await preview({ email: "second@example.com" }, deps().d);
    expect(written().requestId).toBe(id);
  });

  it("consent_false_without_flag", async () => {
    writeInputs({ ...INPUTS, consent: true });
    const a = deps();
    await preview({}, a.d);
    expect(written().consent).toBe(false);
    expect(a.lines.join("\n")).toContain(CONSENT_NOTICE);
    await preview({ consent: true }, deps().d);
    expect(written().consent).toBe(true);
  });

  it("never_calls_fetch_post", async () => {
    writeInputs();
    const { d, f } = deps();
    await preview({ consent: true }, d);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://nearhackathon.com/HACKATHON.md");
    expect(f.mock.calls[0][1]).toBeUndefined();
    expect(readFileSync(join(repoRoot(), "scripts/src/submission-preview.ts"), "utf8")).not.toMatch(/method:\s*["']POST/i);
  });

  it("file_outside_repo_mode_0600", async () => {
    writeInputs();
    await preview({}, deps().d);
    const out = join(dir, "submission.json");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(out.startsWith(repoRoot())).toBe(false);
    // writing into the repo is refused
    const inside = deps();
    inside.d.dir = join(repoRoot(), "scratch-submission");
    mkdirSync(inside.d.dir, { recursive: true });
    try {
      writeFileSync(join(inside.d.dir, "submission-inputs.json"), JSON.stringify(INPUTS));
      const r = await preview({}, inside.d);
      expect(r.exit).toBe(2);
      expect(r.errors.join("\n")).toMatch(/inside the repo/);
      expect(existsSync(join(inside.d.dir, "submission.json"))).toBe(false);
    } finally {
      rmSync(inside.d.dir, { recursive: true, force: true });
    }
  });

  it("git_ignores_submission", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", "submission.json"], { cwd: repoRoot() })).not.toThrow();
  });

  it("flags_a_changed_contract_with_exit_3 and still writes the payload", async () => {
    writeInputs();
    const { d, lines } = deps(fetchMock(DOC + "!"));
    const r = await preview({}, d);
    expect(r.exit).toBe(3);
    expect(lines.join("\n")).toMatch(/HACKATHON\.md CHANGED since 2026-11-10/);
    expect(existsSync(join(dir, "submission.json"))).toBe(true);
  });

  it("reports_missing_idea_and_unreadable_contract", async () => {
    writeInputs();
    rmSync(join(repo, "docs/submission/idea.txt"));
    expect((await preview({}, deps().d)).errors.join("")).toMatch(/idea\.txt missing/);
    writeFileSync(join(repo, "docs/submission/idea.txt"), IDEA);
    const bad = deps(vi.fn(async () => new Response("no", { status: 500 })));
    expect((await preview({}, bad.d)).exit).toBe(1);
  });
});
