// npm run bench:gen -- --suite room|leak|quality|all [--check] [--review]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS, roomFiles } from "./room.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const suite = args[args.indexOf("--suite") + 1] ?? "all";

if (!["room", "leak", "quality", "all"].includes(suite)) {
  console.error(`unknown suite: ${suite}`);
  process.exit(2);
}
if (suite === "leak" || suite === "quality") {
  console.error(`suite ${suite}: not implemented yet (WS6-T04)`);
  process.exit(2);
}

const files = roomFiles(); // suite "all" is room-only until WS6-T04 adds leak and quality

if (flag("--review")) {
  for (const a of ATTACKS) console.log(`${a.id}\t${a.category}\t${a.technique}\tregex_expected=${a.regex_expected}`);
}

if (flag("--check")) {
  let same = 0;
  for (const [p, content] of files) {
    let disk = "";
    try { disk = readFileSync(resolve(root, p), "utf8"); } catch { /* missing */ }
    if (disk === content) same++;
    else console.error(`DIFF ${p}`);
  }
  console.log(`room: ${same}/${files.size} files byte-identical`);
  process.exit(same === files.size ? 0 : 1);
}

for (const [p, content] of files) {
  mkdirSync(dirname(resolve(root, p)), { recursive: true });
  writeFileSync(resolve(root, p), content, "utf8");
}
console.log(`room: ${ATTACKS.length} attacks + 2 controls · 26 csv × 200 rows · payload rows 70/200 per attack file`);
