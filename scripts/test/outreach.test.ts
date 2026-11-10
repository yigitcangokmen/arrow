// Acceptance tests for the outreach drafts (WS7-T01, WS7-T02). Nothing here sends anything.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { weightedLength } from "../src/lib/xlen.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const targets = read("docs/outreach/targets.md");
const invite = read("docs/outreach/invite.md");
const followup = read("docs/outreach/followup.md");

// First table of targets.md: | id | name | who/handle | why | source | channel | variant | ready | fallback |
const rows = targets
  .split("\n")
  .filter((l) => /^\| T\d\d \|/.test(l))
  .map((l) => l.split(" | ").map((c) => c.replace(/^\| /, "").replace(/ \|$/, "")))
  .filter((c) => c.length === 9)
  .map(([id, name, who, why, source, channel, variant, ready, fallback]) => ({ id, name, who, why, source, channel, variant, ready, fallback }));

const variants = Object.fromEntries(
  [...invite.matchAll(/^## (A|B|R|RB):[^\n]*\n> ([^\n]+)/gm)].map((m) => [m[1] as string, m[2] as string]),
);
const fillX = (s: string) => s.replace(/\{\{[A-Z_]+\}\}/g, "X");
const words = (s: string) => fillX(s).trim().split(/\s+/).length;

// Contract config (DEC H-02/H-03): fee_bps_eval 1000, fee_bps_sale 200 -> seller keeps 90% / 98%.
const FEE_BPS_EVAL = 1000;
const FEE_BPS_SALE = 200;

describe("targets", () => {
  it("targets_le_15_and_tuneup_first", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows[0]?.name).toBe("Tune Up Research Desk");
    expect(rows[0]?.id).toBe("T01");
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("every_target_has_source_url", () => {
    for (const r of rows) {
      const urls = r.source.split(" · ");
      expect(urls.length, r.id).toBeGreaterThanOrEqual(1);
      for (const u of urls) expect(/^https:\/\/(x\.com|github\.com|market\.near\.ai)\//.test(u), `${r.id} ${u}`).toBe(true);
    }
  });

  it("every_target_has_channel", () => {
    for (const r of rows) expect(["X DM", "X reply", "email (public)"], r.id).toContain(r.channel);
  });

  it("ready_messages_within_limits", () => {
    for (const r of rows) {
      if (r.channel === "X DM" || r.channel === "email (public)") expect(words(r.ready), r.id).toBeLessThanOrEqual(120);
      if (r.channel === "X reply") expect(weightedLength(r.ready), r.id).toBeLessThanOrEqual(280);
      expect(weightedLength(r.fallback), `${r.id} fallback`).toBeLessThanOrEqual(280);
    }
  });

  it("no_unfilled_placeholders_in_ready_messages", () => {
    for (const r of rows) {
      expect(r.ready, r.id).not.toContain("{{");
      expect(r.fallback, r.id).not.toContain("{{");
    }
  });

  it("every_ready_message_names_the_target", () => {
    for (const r of rows) {
      expect(r.ready.startsWith(`Hi ${r.name},`), r.id).toBe(true);
      expect(r.fallback.startsWith(r.who), r.id).toBe(true);
    }
  });
});

describe("invite", () => {
  it("has all four variants", () => {
    expect(Object.keys(variants).sort()).toEqual(["A", "B", "R", "RB"]);
  });

  it("invite_variants_le_120_words", () => {
    expect(words(variants.A as string)).toBeLessThanOrEqual(120);
    expect(words(variants.B as string)).toBeLessThanOrEqual(120);
    console.log(`invite words: A ${words(variants.A as string)}, B ${words(variants.B as string)}`);
  });

  it("invite_worst_case_fill_le_120_words", () => {
    // NAME + THEIR_DATA may use 12 words together; the longest allowed fill must still fit.
    for (const v of ["A", "B"]) {
      const worst = (variants[v] as string).replace("{{NAME}}", "one two three four").replace("{{THEIR_DATA}}", "a b c d e f g h");
      expect(worst).not.toContain("{{");
      expect(worst.trim().split(/\s+/).length, v).toBeLessThanOrEqual(120);
    }
  });

  it("reply_variant_le_280_weighted", () => {
    for (const v of ["R", "RB"]) {
      const worst = (variants[v] as string).replace("{{HANDLE}}", "x".repeat(15)).replace("{{THEIR_DATA_SHORT}}", "y".repeat(30));
      expect(worst).not.toContain("{{");
      expect(weightedLength(worst), v).toBeLessThanOrEqual(280);
      console.log(`reply ${v} weighted (worst case): ${weightedLength(worst)}`);
    }
  });

  it("invite_mentions_required_facts", () => {
    for (const v of ["A", "B"]) {
      const t = variants[v] as string;
      for (const s of ["90%", "98%", "independent project, no code shared", "Nov 13, 03:00 UTC", "MetaMask", "npm run arrow -- list", "/sell"]) expect(t, `${v}: ${s}`).toContain(s);
      expect(t).not.toContain("npx arrow");
    }
    expect(variants.B).toContain("Reply and I'll send the link on Nov 13.");
    expect(variants.A).toContain("https://github.com/yigitcangokmen/arrow");
    expect(variants.B).not.toContain("github.com");
    expect(variants.RB).not.toContain("github.com");
  });

  it("invite_rates_match_contract_config", () => {
    const eval_ = 100 - FEE_BPS_EVAL / 100;
    const sale = 100 - FEE_BPS_SALE / 100;
    for (const v of ["A", "B"]) {
      expect(variants[v]).toContain(`${eval_}% of every inspection fee`);
      expect(variants[v]).toContain(`${sale}% of every sale`);
    }
    for (const v of ["R", "RB"]) {
      expect(variants[v]).toContain(`${sale}% of sales`);
      expect(variants[v]).toContain(`${eval_}% of inspection fees`);
    }
  });

  it("no_forbidden_claims_in_drafts", () => {
    // Stand-in for scripts/check-claims.sh (WS7-T04a), which does not exist yet.
    const banned = [/nothing leaks/i, /trustless/i, /\bfirst\b/i, /npx arrow/i, /we never see/i, /refunded to your wallet/i, /only a (capped )?verdict leaves/i, /x402[- ]compatible/i, /Qwen|NEAR AI|GLM/];
    for (const text of [targets, invite, followup]) for (const re of banned) {
      // the rules list in invite.md quotes the banned phrases on purpose; check only quoted message lines
      for (const line of text.split("\n").filter((l) => l.startsWith("> ") || /^\| T\d\d /.test(l))) expect(re.test(line), `${re} in ${line.slice(0, 60)}`).toBe(false);
    }
  });

  it("followup_le_60_words", () => {
    const body = followup.split("\n").find((l) => l.startsWith("> ")) as string;
    expect(words(body.slice(2))).toBeLessThanOrEqual(60);
  });
});
