// Loads each page in headless Chromium over the DevTools protocol and fails on any CSP violation (WEB-8).
// A listener for `securitypolicyviolation` is installed before any page script runs, so a violation that the page
// swallows (a caught `new Function("")` probe, for example) is still counted. Run it through scripts/csp-browser.sh,
// which starts Chromium inside Docker; this file only needs Node 22+ (global fetch and WebSocket).
// Usage: node web/scripts/csp-browser-check.mjs <base-url> [<path>...]   (CDP_PORT, default 9222)
const [base, ...args] = process.argv.slice(2);
if (!base) {
  console.error("usage: csp-browser-check.mjs <base-url> [<path>...]");
  process.exit(2);
}
const PATHS = args.length ? args : ["/", "/sell", "/seller", "/try", "/try/recorded", "/verify", "/buy/1", "/verify/1", "/attack", "/does-not-exist"];
const cdp = `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
let nextId = 0;
const waiting = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id === undefined) return void events.push(msg);
  const w = waiting.get(msg.id);
  waiting.delete(msg.id);
  if (msg.error) w.reject(new Error(msg.error.message));
  else w.resolve(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__cspv = []; document.addEventListener("securitypolicyviolation", (e) => window.__cspv.push(e.effectiveDirective + " blocked " + (e.blockedURI || "inline") + " at " + (e.sourceFile || "?") + ":" + e.lineNumber), true);`,
});

let failed = 0;
for (const path of PATHS) {
  events.length = 0;
  await send("Page.navigate", { url: base + path });
  for (let t = 0; t < 300 && !events.some((e) => e.method === "Page.loadEventFired"); t++) await sleep(100);
  await sleep(4000); // hydration and lazily loaded chunks run after the load event
  const violations = JSON.parse((await evaluate("JSON.stringify(window.__cspv ?? null)")) ?? "null");
  // App Router hydrates the whole document, so React marks it once hydration ran.
  const hydrated = await evaluate(`Object.keys(document).some((k) => k.startsWith("__reactContainer"))`);
  const console_ = events
    .filter((e) => e.method === "Log.entryAdded" && /content security policy|refused to/i.test(e.params.entry.text))
    .map((e) => e.params.entry.text);
  const ok = Array.isArray(violations) && violations.length === 0 && console_.length === 0 && hydrated === true;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${path.padEnd(16)} violations=${violations?.length ?? "listener missing"} console=${console_.length} hydrated=${hydrated}`);
  for (const v of [...(violations ?? []), ...console_].slice(0, 5)) console.log(`     ${String(v).slice(0, 200)}`);
}
ws.close();
console.log(failed ? `CSP_BROWSER: FAIL (${failed} of ${PATHS.length} pages)` : `CSP_BROWSER: PASS (${PATHS.length} pages, 0 violations)`);
process.exit(failed ? 1 : 0);
