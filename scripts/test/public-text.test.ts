// CI-9, CI-11(b), X12-OPS-4: committed text must not point at planning documents that are never published, and must
// not describe the mainnet NEAR AI key as one that can be topped up.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .stdout.split("\0")
  .filter((f) => f && existsSync(join(ROOT, f)));
// Ledgers (edited only by the integrator) and this file, which names the patterns.
const LEDGERS = new Set(["HANDOFFS.md", "STATUS.md", "scripts/test/public-text.test.ts"]);
const lines = (files: string[]) =>
  files.flatMap((f) =>
    /\.(wasm|png|jpe?g|gif|ico|lock|svg|woff2?)$/.test(f) || f === "package-lock.json"
      ? []
      : readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .map((text, i) => ({ f, n: i + 1, text })),
  );

describe("public text", () => {
  it("no_planning_doc_pointers", () => {
    // .vercelignore lists the files to leave out of a deploy; cli.test.ts excludes them from a git grep.
    const allowed = new Set([...LEDGERS, ".vercelignore", "agent/test/cli.test.ts"]);
    const hits = lines(tracked.filter((f) => !allowed.has(f))).filter((l) =>
      /KICKOFF|\bPLAN\.md|DECISIONS(\.md)?\b|tasks\/WS-/.test(l.text),
    );
    expect(hits.map((l) => `${l.f}:${l.n}`)).toEqual([]);
  });

  it("env_example_has_no_topup_claim (CI-9)", () => {
    expect(read(".env.example")).not.toMatch(/top-up/i);
  });

  // KU-11: one free NEAR Builders key serves mainnet, testnet and bench. It cannot be topped up.
  const STALE_KEY_TEXT = /doldurulabilir|top-up-able|refillable|(cloud\.near\.ai.*mainnet.*key|mainnet.*key.*cloud\.near\.ai)/i;
  const superseded = (t: string) => /SUPERSEDED|KU-11|cannot be topped up/.test(t);

  it("no_topup_mainnet_key_text_in_tracked_files (X12-OPS-4)", () => {
    // HANDOFFS.md is a ledger but carries the H-01b steps, each now marked superseded
    const hits = lines(tracked.filter((f) => !LEDGERS.has(f) || f === "HANDOFFS.md")).filter(
      (l) => STALE_KEY_TEXT.test(l.text) && !superseded(l.text),
    );
    expect(hits.map((l) => `${l.f}:${l.n}`)).toEqual([]);
  });

  // The planning documents are local to the main checkout (never committed). Check them when they are there.
  it("no_topup_mainnet_key_text_in_local_planning_docs (X12-OPS-4)", () => {
    const gitDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const main = dirname(gitDir);
    const docs = ["DECISIONS.md", "PLAN.md", "OPEN-QUESTIONS.md"]
      .filter((f) => existsSync(join(main, f)))
      .concat(existsSync(join(main, "tasks")) ? readdirSync(join(main, "tasks")).map((f) => `tasks/${f}`) : []);
    const hits = docs.flatMap((f) =>
      readFileSync(join(main, f), "utf8")
        .split("\n")
        .map((text, i) => ({ f, n: i + 1, text }))
        // H-01b (buy a paid cloud.near.ai key) was dropped by KU-11: a planning line that still mentions it needs the marker.
        .filter((l) => (STALE_KEY_TEXT.test(l.text) || /H-01b/.test(l.text)) && !superseded(l.text)),
    );
    expect(hits.map((l) => `${l.f}:${l.n}`)).toEqual([]);
  });
});
