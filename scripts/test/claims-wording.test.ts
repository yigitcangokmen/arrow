// Regression tests for the second audit's claims group (fix2/claims): each test pins a README, JUDGES or doc claim to
// the source it describes, so a stale number or an overclaim fails here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJudges } from "../src/check-judges.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const readme = read("README.md");
const judges = parseJudges(read("JUDGES.md"));
const evidence = (n: string) => JSON.parse(read(`evidence/${n}.json`)) as { contract?: string; program_wasm_sha256?: string; runs: { id: string; observed: string }[] };

/** The README line that starts with `| <first cell>` (a table row) or the first line that contains `needle`. */
const row = (first: string) => readme.split("\n").find((l) => l.startsWith(`| ${first}`)) ?? "";
const line = (needle: string) => readme.split("\n").find((l) => l.includes(needle)) ?? "";
/** The JUDGES.md line that starts with `| <first cell>` (the gate rows moved there from the README). */
const jline = (first: string) => read("JUDGES.md").split("\n").find((l) => l.startsWith(`| ${first}`)) ?? "";
const judgesRow = (n: number) => judges.find((r) => r.n === n);
const cases = (f: string) => (JSON.parse(read(`fixtures/${f}`)) as { cases: unknown[] }).cases.length;

describe("claims wording", () => {
  it("readme_and_judges_pass_check_claims", () => {
    // PRIV-5, CLM-9, N2: the scanner rules cover the README too (the whole-tree test in check-claims.test.ts skips it)
    const run = () => execFileSync("bash", [resolve(ROOT, "scripts/check-claims.sh"), "--files", "README.md", "JUDGES.md"], { cwd: ROOT, encoding: "utf8" });
    expect(run()).toBe("");
  });

  it("priv5_reader_is_the_near_ai_tee_not_a_place_nobody_can_look", () => {
    for (const text of [readme.split("\n")[2]!, line("You cannot sell information"), read("web/app/layout.tsx"), read("web/app/page.tsx"), read("web/app/buy/[id]/BuyFlow.tsx"), read("docs/outreach/invite.md")]) {
      expect(text).not.toMatch(/nobody can look|reading the data inside the enclave|reads the (sealed )?data inside (a|the) (tee|enclave)/i);
    }
    expect(line("You cannot sell information")).toMatch(/NEAR AI's TEE/);
    expect(line("You cannot sell information")).toMatch(/over TLS/);
  });

  it("clm2_invites_promise_no_markdown_and_no_solana", () => {
    const outreach = `${read("docs/outreach/invite.md")}\n${read("docs/outreach/targets.md")}`;
    expect(outreach).not.toMatch(/markdown route|or Markdown|withdrawable to solana/i);
    expect(read("docs/outreach/invite.md")).toContain("each listing costs 0.10 USDC");
  });

  it("clm4_testnet_evidence_is_labelled_by_contract_and_program", () => {
    const ev = evidence("testnet");
    expect(ev.contract).toBe("arrow-v2.arrowhq.testnet");
    expect(line("- Testnet: contract")).toContain(ev.contract!);
    expect(line("- Testnet: contract")).toContain(ev.program_wasm_sha256!.slice(0, 8));
    // the perf table was measured on the first contract and says so (docs/perf.md is the home of the timings)
    expect(read("docs/perf.md").split("\n").find((l) => l.includes("Real evals on `arrow.arrowhq.testnet`")) ?? "").toMatch(/pre-binding/);
    // no row counts that go stale every time the evidence file grows
    expect(jline("**K2**")).not.toMatch(/\d+ listings, \d+ evals/);
    expect(jline("**K2**")).toContain("arrow-v2.arrowhq.testnet");
    expect(judgesRow(30)!.expected).toContain(ev.contract);
    expect(judgesRow(31)!.claim).toMatch(/current market contract/);
  });

  it("clm6_wasm_hash_condition_is_not_claimed_as_tested", () => {
    const r = row("Program key");
    expect(r).toMatch(/`Predecessor` condition only/);
    expect(r).toMatch(/NOT PROVEN \(`WasmHash`/);
    expect(judgesRow(11)!.label).toMatch(/Predecessor/);
    const wasm = judges.find((j) => /WasmHash/.test(j.claim));
    expect(wasm?.label).toBe("NOT PROVEN");
  });

  it("clm7_mainnet_refund_sample_is_the_spikes_forced_refund", () => {
    const refundRow = jline("**S3c** refund");
    expect(refundRow).toContain("outlayer_refund");
    expect(refundRow).not.toMatch(/decided by the program/);
    expect(judgesRow(18)!.expected).toContain("outlayer_refund");
    expect(readme).not.toMatch(/before the program gives up and the refund starts/);
  });

  it("clm8_s3c_timings_match_the_mainnet_evidence", () => {
    const secs = (id: string) => {
      const r = evidence("mainnet").runs.find((x) => x.id === id);
      const ms = Number(/(\d+) ms to last receipt/.exec(r?.observed ?? "")?.[1]);
      expect(ms, id).toBeGreaterThan(0);
      return (ms / 1000).toFixed(1);
    };
    const keep = secs("spike-s3c-outlayer");
    const refund = secs("spike-s3c-outlayer_refund");
    expect(jline("**S3c** keep")).toContain(`${keep} s`);
    expect(jline("**S3c** refund")).toContain(`${refund} s`);
    expect(judgesRow(18)!.expected).toContain(`${refund} s`);
    expect(`${readme}\n${read("JUDGES.md")}`).not.toMatch(/\b(10\.0|38\.0) s/);
  });

  it("clm9_inbound_is_base_usdc_only", () => {
    expect(readme).not.toMatch(/any chain/i);
    expect(readme.split("\n")[2]).toContain("USDC from Base");
  });

  it("clm11_relayer_fullaccess_key_is_disclosed", () => {
    const r = row("Relayer account");
    expect(r).toMatch(/FullAccess/);
    expect(r).toMatch(/\| RISKY \|$/);
    expect(line("Security-track pieces")).toMatch(/FullAccess key/);
    expect(judges.find((j) => /relayer account/i.test(j.claim))?.expected).toMatch(/FullAccess/);
  });

  it("f11_readme_numbers_come_from_the_vectors_not_from_memory", () => {
    // README step 5 prints the ts->rs vector counts of s4-interop, which are the cases in the fixtures
    const step5 = readme.split("\n").find((l) => l.startsWith("5. `cargo run -p s4-interop"))!;
    expect(step5).toContain(`ecies ts->rs: ${cases("ecies-vectors.json")}/${cases("ecies-vectors.json")}`);
    expect(step5).toContain(`xchacha ts->rs: ${cases("xchacha-vectors.json")}/${cases("xchacha-vectors.json")}`);
    expect(step5).toContain(`minhash ts->rs: ${cases("minhash-vectors.json")}/${cases("minhash-vectors.json")}`);
    const s4b = judgesRow(32)!.expected;
    expect(s4b).toContain(`ECIES ${cases("ecies-vectors.json")}/${cases("ecies-vectors.json")} and ${cases("ecies-vectors-rs.json")}/${cases("ecies-vectors-rs.json")}`);
    // no exact unit-test count: it goes stale with every new test
    expect(readme).not.toMatch(/\d+ unit tests/);
    expect(read("JUDGES.md")).not.toMatch(/no_stderr_on_any_error: \d+\/\d+ PASS/);
  });

  it("n2_failed_eval_charge_is_disclosed_everywhere_a_refund_is_promised", () => {
    const init = JSON.parse(read("scripts/deploy/init-mainnet.json")) as { fee_bps_eval: number };
    const pct = `${init.fee_bps_eval / 100}%`;
    expect(pct).toBe("10%");
    for (const [name, text] of [
      ["README opening", readme.split("\n")[2]!],
      ["README KU-11 row", row("NEAR AI API key")],
      ["README leak budget row", row("Leak budget")],
      ["video F07", read("docs/video/script.md").split("\n").find((l) => l.startsWith("| F07"))!],
      ["video X06", read("docs/video/script.md").split("\n").find((l) => l.startsWith("| X06"))!],
      ["idea.txt", read("docs/submission/idea.txt")],
      ["JUDGES row 16", JSON.stringify(judgesRow(16))],
      ["JUDGES row 44", JSON.stringify(judgesRow(44))],
      ["web BuyFlow", read("web/app/buy/[id]/BuyFlow.tsx")],
    ] as const) {
      expect(text, name).toMatch(/10%|ten percent/);
    }
    // the S2 gate no longer describes the sandbox refund itself; it points at row 16, which states the 10% charge
    expect(jline("**S2**")).toContain("row 16");
    expect(row("Gas tank")).toMatch(/\| RISKY \|$/);
    expect(read("web/lib/trust.ts")).toContain('part: "Gas tank"');
  });
});
