// npm run check:judges [-- --file <path>] [--readme [<path>]]          (WS7-T05)
// Checks the claim table in JUDGES.md against the repository: every backticked path in the Code column exists (and
// the symbol after `::` appears in it), every backticked name in the Test column is a real test, labels are valid,
// PROVEN rows carry a command, NOT PROVEN / RISKY rows say why. With --readme the backticked snake_case test-like
// names in README.md must exist in the sources. One line per problem: `JUDGES.md:<row>: missing <path|test>`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEARCH_DIRS = ["contracts", "enclave", "sdk", "agent", "scripts", "web", "bench"];
const SKIP = new Set(["node_modules", "target", ".next", ".git", "out"]);
const LABELS = ["NOT PROVEN", "PROVEN", "RISKY"] as const;

export type Row = { n: number; line: number; claim: string; code: string; test: string; command: string; expected: string; label: string };

const empty = (s: string) => s.trim() === "" || /^(—|-|n\/a)$/i.test(s.trim());

export function parseJudges(md: string): Row[] {
  const rows: Row[] = [];
  const lines = md.split("\n");
  let inTable = false;
  lines.forEach((text, i) => {
    if (/^\|\s*#\s*\|\s*Claim\s*\|/i.test(text)) {
      inTable = true;
      return;
    }
    if (!inTable) return;
    if (!text.startsWith("|")) {
      inTable = false;
      return;
    }
    if (/^\|[\s:|-]+\|?\s*$/.test(text)) return;
    const c = text.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((x) => x.trim());
    if (c.length !== 7) return;
    rows.push({ n: Number(c[0]), line: i + 1, claim: c[1]!, code: c[2]!, test: c[3]!, command: c[4]!, expected: c[5]!, label: c[6]! });
  });
  return rows;
}

const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(rs|ts|tsx)$/.test(name)) out.push(p);
  }
}

export type Sources = { files: Map<string, string>; all: string };

export function loadSources(root = ROOT): Sources {
  const paths: string[] = [];
  for (const d of SEARCH_DIRS) walk(join(root, d), paths);
  const files = new Map(paths.map((p) => [p, readFileSync(p, "utf8")]));
  return { files, all: [...files.values()].join("\n") };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function testExists(name: string, src: Sources): boolean {
  const rust = new RegExp(`fn\\s+${esc(name)}\\s*\\(`);
  const ts = new RegExp(`\\b(?:it|test)\\(\\s*["'\`]${esc(name)}["'\`]`);
  for (const [p, text] of src.files) {
    if (p.endsWith(".rs") ? rust.test(text) : ts.test(text)) return true;
  }
  return false;
}

export function checkRows(rows: Row[], root = ROOT, src: Sources = loadSources(root)): string[] {
  const problems: string[] = [];
  const bad = (r: Row, what: string) => problems.push(`JUDGES.md:${r.n}: ${what}`);
  for (const r of rows) {
    for (const tok of ticks(r.code)) {
      const [path, symbol] = tok.split("::") as [string, string | undefined];
      if (!existsSync(join(root, path))) {
        bad(r, `missing ${path}`);
        continue;
      }
      if (symbol !== undefined) {
        const text = readFileSync(join(root, path), "utf8");
        if (!new RegExp(`(?:fn|function)\\s+${esc(symbol)}\\b|\\b${esc(symbol)}\\(`).test(text)) bad(r, `missing ${path}::${symbol}`);
      }
    }
    for (const name of ticks(r.test)) if (!testExists(name, src)) bad(r, `missing test ${name}`);
    const label = LABELS.find((l) => r.label === l || r.label.startsWith(`${l} (`));
    if (label === undefined) bad(r, `bad label ${JSON.stringify(r.label)} (PROVEN, NOT PROVEN or RISKY)`);
    else if (label === "PROVEN" && empty(r.command)) bad(r, "PROVEN row without a command");
    else if (label !== "PROVEN" && !/why/i.test(r.expected)) bad(r, `${label} row must say why in Expected`);
  }
  return problems;
}

/** Backticked snake_case names with three or more parts on README lines that mention a test, when no source file has the word. */
export function checkReadme(readme: string, src: Sources): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  readme.split("\n").forEach((text, i) => {
    if (!/test/i.test(text)) return;
    for (const tok of ticks(text)) {
      if (!/^[a-z0-9]+(?:_[a-z0-9]+){2,}$/.test(tok) || seen.has(tok)) continue;
      if (new RegExp(`\\b${esc(tok)}\\b`).test(src.all)) continue;
      seen.add(tok);
      out.push(`README.md:${i + 1}: missing test ${tok}`);
    }
  });
  return out;
}

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { file: { type: "string" }, readme: { type: "boolean" } } });
  const file = resolve(ROOT, values.file ?? "JUDGES.md");
  const rows = parseJudges(readFileSync(file, "utf8"));
  const src = loadSources();
  const problems = checkRows(rows, ROOT, src);
  if (values.readme === true) problems.push(...checkReadme(readFileSync(join(ROOT, "README.md"), "utf8"), src));
  for (const p of problems) console.log(p);
  console.log(`JUDGES.md: ${rows.length} rows, ${problems.length} missing`);
  return problems.length === 0 && rows.length > 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
