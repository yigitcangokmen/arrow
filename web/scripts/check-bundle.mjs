// Run after `next build`. Rule (DEC L-06): near-api-js may sit in a chunk only /try loads. Every other page's HTML
// must not reference a chunk that contains a near-api-js marker. Exit 0 when the rule holds, 1 with the violations.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(web, ".next/static");
const MARKERS = ["near-api-js", "GasKeyInvalidNumNonces"];
const PAGES = ["/", "/sell", "/buy/1", "/seller", "/verify", "/attack"];
const PORT = 3100;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const flagged = new Set();
for (const f of walk(staticDir).filter((p) => p.endsWith(".js"))) {
  const text = readFileSync(f, "utf8");
  if (MARKERS.some((m) => text.includes(m))) flagged.add("/_next/static/" + relative(staticDir, f).split("\\").join("/"));
}
console.log(`flagged chunks: ${flagged.size ? [...flagged].join(", ") : "none"}`);

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { cwd: web, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", (d) => (serverOutput += d));
server.stderr.on("data", (d) => (serverOutput += d));

async function waitUntilUp() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`next start did not come up on :${PORT}\n${serverOutput}`);
}

const violations = [];
try {
  await waitUntilUp();
  for (const page of PAGES) {
    const html = await (await fetch(`http://127.0.0.1:${PORT}${page}`)).text();
    const used = new Set(html.match(/\/_next\/static\/[^"'\\\s<>]+\.js/g) ?? []);
    for (const chunk of used) if (flagged.has(decodeURIComponent(chunk))) violations.push(`${page} loads ${chunk}`);
  }
} finally {
  server.kill();
}

if (violations.length) {
  console.error("bundle-check: FAIL\n" + violations.join("\n"));
  process.exit(1);
}
console.log("bundle-check: OK (near-api-js only in /try lazy chunk)");
