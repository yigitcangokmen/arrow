// F3: the home-page trust table must carry the README's RISKY, NOT PROVEN and TODO labels and must not state plans as facts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRUST_ROWS } from "../lib/trust.ts";

const README = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../README.md"), "utf8");

/** README trust table rows: part (backticks removed) and the weakest label in the last column. */
function readmeRows(): { part: string; label: string; flag: "RISKY" | "NOT PROVEN" | "TODO" | undefined }[] {
  const section = README.slice(README.indexOf("## Trust table"), README.indexOf("## Try it"));
  return section
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| Part ") && !l.startsWith("|---"))
    .map((l) => {
      const cells = l.split(" | ").map((c) => c.replace(/^\| /, "").replace(/ \|$/, ""));
      const label = cells[cells.length - 1]!;
      const flag = /RISKY/.test(label) ? "RISKY" : /NOT PROVEN/.test(label) ? "NOT PROVEN" : /TODO/.test(label) ? "TODO" : undefined;
      return { part: cells[0]!.replace(/`/g, ""), label, flag };
    });
}

describe("trust table", () => {
  const rows = readmeRows();

  it("reads_the_readme_table", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.some((r) => r.flag === "TODO")).toBe(true);
  });

  it("every_readme_row_is_in_the_ui_with_the_same_flag", () => {
    for (const r of rows) {
      const ui = TRUST_ROWS.find((u) => u.part === r.part);
      expect(ui, `README row "${r.part}" is missing from TRUST_ROWS`).toBeDefined();
      expect(ui!.flag, `${r.part}: README label "${r.label}"`).toBe(r.flag);
    }
  });

  it("the_legend_tally_matches_the_rows", () => {
    const n = (f: string | undefined) => rows.filter((r) => r.flag === f).length;
    expect(README).toContain(`Each row counted under its weakest label: ${n(undefined)} PROVEN, ${n("RISKY")} RISKY, ${n("NOT PROVEN")} NOT PROVEN, ${n("TODO")} TODO.`);
  });

  it("part_names_are_unique", () => {
    expect(new Set(TRUST_ROWS.map((r) => r.part)).size).toBe(TRUST_ROWS.length);
  });

  it("no_row_cites_a_bench_that_has_not_run", () => {
    for (const r of TRUST_ROWS) {
      const text = `${r.trust} ${r.sees} ${r.cannot} ${r.check}`;
      if (/leak-bench|quality-bench|quality bench|leak bench/i.test(text)) expect(r.check, r.part).toMatch(/TODO|not run|has not run/);
    }
  });

  it("the_operator_row_does_not_state_the_lock_as_a_fact", () => {
    const op = TRUST_ROWS.find((r) => r.part === "Arrow operator")!;
    expect(op.flag).toBe("TODO");
    expect(op.check).toMatch(/live on mainnet; not locked yet, so the team can still change it/i);
    expect(op.check).not.toMatch(/not deployed/i);
    expect(`${op.cannot} ${op.check}`).not.toMatch(/no access keys after the lock/i);
  });

  it("the_refund_row_cites_the_arrow_contracts_mainnet_refund", () => {
    const r = TRUST_ROWS.find((x) => x.part === "Refund destination")!;
    expect(r.flag).toBeUndefined();
    expect(r.check).toMatch(/The Arrow contract refunded a failed eval on mainnet \(arrow_refund not_ok, mainnet tx \S+\)/);
    expect(r.check).not.toMatch(/still to do/i);
  });

  it("the_inference_key_row_says_it_cannot_be_topped_up", () => {
    const k = TRUST_ROWS.find((r) => r.part.startsWith("NEAR AI API key"))!;
    expect(k.flag).toBe("RISKY");
    expect(k.check).toContain("NEAR Builders");
    expect(k.check).toContain("cannot be topped up");
    expect(k.check).toContain("expiry is not published");
    expect(JSON.stringify(TRUST_ROWS)).not.toMatch(/can be topped up/);
  });

  it("the_bound_is_qualified_to_the_output_channel", () => {
    const out = TRUST_ROWS.find((r) => r.part === "Output channel")!;
    expect(out.sees).toContain("on this channel only");
    const err = TRUST_ROWS.find((r) => r.part === "Error channel")!;
    expect(err.sees).toMatch(/ok:false/);
    expect(err.sees).toMatch(/null/);
    expect(err.flag).toBe("RISKY");
    const side = TRUST_ROWS.find((r) => r.part === "Side channels")!;
    expect(side.sees).toMatch(/key_column/);
    expect(side.sees).toMatch(/not counted/);
  });
});

describe("audit wording of the UI table", () => {
  const row = (part: string) => TRUST_ROWS.find((r) => r.part === part)!;
  it("CLM-5: the program-key row cites transactions, not a /verify row that does not exist", () => {
    const k = row("Program key / PROTECTED_MASTER");
    expect(k.check).not.toMatch(/recorded on \/verify/);
    expect(k.check).toContain("smm9T86m");
    expect(k.check).toContain("Bzzg22r9");
  });
  it("CLM-10: the 1Click row says the buyer holds native NEAR USDC after a swap", () => {
    const r = TRUST_ROWS.find((x) => x.part.startsWith("1Click"))!;
    expect(r.trust).toMatch(/swaps? into native NEAR USDC/);
    expect(r.trust).not.toMatch(/arrive as omft\.near bridged tokens/);
  });
  it("PRIV-3: the operator sees IP, 0x and listing, and the served JavaScript is its own RISKY row", () => {
    expect(row("Arrow operator").sees).toMatch(/IP address, 0x address and listing/);
    const w = row("Arrow web app (served JavaScript)");
    expect(w.flag).toBe("RISKY");
    expect(`${w.sees} ${w.check}`).toMatch(/viewing-key signature/);
    expect(`${w.sees} ${w.check}`).toMatch(/use the CLI/i);
  });
  it("WEB-8: the web app row names the per-request nonce CSP, and the seller data row the daily blob GC", () => {
    const w = row("Arrow web app (served JavaScript)");
    expect(w.check).toMatch(/per-request nonce/);
    expect(w.check).toMatch(/'strict-dynamic'/);
    expect(w.check).not.toMatch(/No script policy is set/i);
    expect(row("Seller data at rest").check).toMatch(/daily job deletes a stored ciphertext that no Arrow listing points to, 24 hours after upload/);
  });
  it("PRIV-8: the blob host sees the downloader and the exact size is public", () => {
    const d = row("Seller data at rest");
    expect(d.sees).toMatch(/IP address/);
    expect(d.sees).toMatch(/exact plaintext size is public/);
  });
  it("ARW-C2: the gas tank is a RISKY row", () => {
    const g = row("Gas tank");
    expect(g.flag).toBe("RISKY");
    expect(g.check).toMatch(/run the tank down/);
  });
});
