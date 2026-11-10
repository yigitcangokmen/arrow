// npm run bench:gen -- --suite room|leak|quality|all [--check] [--review]
// --review writes bench/REVIEW.md (the H-21 reading list). --check compares every generated file byte for byte.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leakFiles, wrappers as leakWrappers, evalCount } from "./leak.ts";
import { qualityFiles, SPECS } from "./quality.ts";
import { reviewMd } from "./review.ts";
import { roomFiles } from "./room.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const suiteArg = args.includes("--suite") ? args[args.indexOf("--suite") + 1]! : "all";
const SUITES = ["room", "leak", "quality"] as const;
const chosen = suiteArg === "all" ? [...SUITES] : suiteArg.split(",");
if (!chosen.every((s) => (SUITES as readonly string[]).includes(s))) {
  console.error(`unknown suite: ${suiteArg}`);
  process.exit(2);
}

const gen: Record<(typeof SUITES)[number], () => Map<string, string>> = { room: roomFiles, leak: leakFiles, quality: qualityFiles };
const summary: Record<(typeof SUITES)[number], () => string> = {
  room: () => "room: 24 attacks + 2 controls · 26 csv × 200 rows · payload rows 70/200 per attack file",
  leak: () => `leak: 3 datasets, ${leakWrappers().length} attacks (${evalCount(leakWrappers())} evals)`,
  quality: () => `quality: ${SPECS.length} datasets, ${SPECS.length} buyer lists, ${SPECS.length * 2} criteria`,
};

if (flag("--review")) {
  writeFileSync(resolve(root, "bench/REVIEW.md"), reviewMd(), "utf8");
  console.log(`wrote bench/REVIEW.md (${reviewMd().split("\n").length - 1} lines)`);
  if (!flag("--check") && args.every((a) => a !== "--suite")) process.exit(0);
}

let bad = 0;
for (const s of chosen as (typeof SUITES)[number][]) {
  const files = gen[s]();
  if (flag("--check")) {
    let same = 0;
    for (const [p, content] of files) {
      let disk = "";
      try { disk = readFileSync(resolve(root, p), "utf8"); } catch { /* missing */ }
      if (disk === content) same++;
      else console.error(`DIFF ${p}`);
    }
    console.log(`${s}: ${same}/${files.size} files byte-identical`);
    if (same !== files.size) bad++;
  } else {
    for (const [p, content] of files) {
      mkdirSync(dirname(resolve(root, p)), { recursive: true });
      writeFileSync(resolve(root, p), content, "utf8");
    }
    console.log(summary[s]());
  }
}
process.exit(bad === 0 ? 0 : 1);
