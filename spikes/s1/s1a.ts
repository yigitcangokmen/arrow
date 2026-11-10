// S1-a NEAR AI gate (WS1-T06, DEC I-05, G-04): n identical evaluator calls with the enclave's request shape.
// Usage: npx tsx spikes/s1/s1a.ts [--model <id>] [--variant default|no_think] [--reasoning-effort low] [--rows 40|20] [--n 10]
// Writes spikes/s1/s1a-results.json. Never prints or stores the key, the response content or the data rows.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEnv, requireEnv } from "../../scripts/src/lib/env.ts";
import { log, mask } from "../../scripts/src/lib/log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = "https://cloud-api.near.ai/v1/chat/completions";
const P95_LIMIT_MS = 25_000;

const { values: a } = parseArgs({
  options: {
    model: { type: "string", default: "Qwen/Qwen3.8-27B" },
    variant: { type: "string", default: "default" },
    "reasoning-effort": { type: "string" },
    rows: { type: "string", default: "40" },
    n: { type: "string", default: "10" },
  },
});
const rows = Number(a.rows);
const n = Number(a.n);
if (!["default", "no_think"].includes(a.variant!) || ![20, 40].includes(rows) || !(n >= 1)) {
  console.error("usage: s1a.ts [--model id] [--variant default|no_think] [--reasoning-effort low] [--rows 40|20] [--n 10]");
  process.exit(2);
}

// Same system prompt as the enclave (fixtures/llm-request-example.json is byte-equal to arrow-core's request).
const fixture = JSON.parse(readFileSync(resolve(HERE, "../../fixtures/llm-request-example.json"), "utf8"));
const SYSTEM: string = fixture.messages[0].content;
const RESPONSE_FORMAT = fixture.response_format;

/** 40 (or 20) deterministic synthetic unlock rows, in the enclave's spotlighting layout. */
function userMessage(): string {
  const tok = "5a1e0c42";
  const tokens = ["ARB", "OP", "APT", "SUI", "TIA", "STRK", "JUP", "W"];
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const day = String(1 + ((i * 7) % 28)).padStart(2, "0");
    const month = String(1 + (i % 12)).padStart(2, "0");
    lines.push(JSON.stringify([tokens[i % tokens.length], `2027-${month}-${day}`, String(1_000_000 + i * 37_500), String((i * 3) % 13)]));
  }
  return [
    `<criteria-${tok}>`,
    `"Token unlock schedules for 2027 with amounts and cliff lengths, to model sell pressure."`,
    `</criteria-${tok}>`,
    `<data-${tok}>`,
    `columns: ["token","unlock_date","amount","cliff_months"]`,
    `rows_total: ${rows}`,
    `null_pct: {"token":0,"unlock_date":0,"amount":0,"cliff_months":0}`,
    `duplicate_rows_pct: 0`,
    `date_range: 2027-01-01..2027-12-28`,
    `label: synthetic`,
    `sample_rows (${rows} of ${rows}; JSON arrays; cells truncated to 137 chars):`,
    ...lines,
    `</data-${tok}>`,
  ].join("\n") + (a.variant === "no_think" ? "\n/no_think" : "");
}

// Field order matches arrow-core llm::request_body.
const body: Record<string, unknown> = {
  model: a.model,
  messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMessage() }],
  temperature: 0,
  max_tokens: 64,
  response_format: RESPONSE_FORMAT,
};
if (a["reasoning-effort"]) body.reasoning_effort = a["reasoning-effort"];
else if (a.variant === "default") body.chat_template_kwargs = { enable_thinking: false };

function schemaOk(content: unknown): { parses: boolean; ok: boolean } {
  if (typeof content !== "string") return { parses: false, ok: false };
  let j: any;
  try {
    j = JSON.parse(content);
  } catch {
    return { parses: false, ok: false };
  }
  const keys = j && typeof j === "object" ? Object.keys(j).sort().join(",") : "";
  const ok = keys === "criterion_exfil,fit_llm,injection_seen,verdict"
    && Number.isInteger(j.fit_llm) && j.fit_llm >= 1 && j.fit_llm <= 5
    && (j.verdict === "BUY" || j.verdict === "PASS")
    && typeof j.injection_seen === "boolean" && typeof j.criterion_exfil === "boolean";
  return { parses: true, ok };
}

loadEnv();
const key = requireEnv("NEARAI_API_KEY");
const runs: any[] = [];
for (let i = 1; i <= n; i++) {
  const t0 = performance.now();
  let rec: any = { i, http_status: 0 };
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const latency_ms = Math.round(performance.now() - t0);
    rec = { i, http_status: res.status, latency_ms };
    if (res.status === 200) {
      const r = JSON.parse(text);
      const c = r.choices?.[0];
      const s = schemaOk(c?.message?.content);
      rec = {
        ...rec,
        model: r.model ?? null,
        finish_reason: c?.finish_reason ?? null,
        prompt_tokens: r.usage?.prompt_tokens ?? null,
        completion_tokens: r.usage?.completion_tokens ?? null,
        reasoning_tokens: r.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        content_parses: s.parses,
        schema_ok: s.ok,
      };
    } else {
      rec.error = mask(text.slice(0, 200));
    }
  } catch (e) {
    rec = { i, http_status: 0, latency_ms: Math.round(performance.now() - t0), error: mask((e as Error).message) };
  }
  runs.push(rec);
  log(`#${i} http ${rec.http_status} ${rec.latency_ms} ms finish ${rec.finish_reason ?? "-"} reasoning ${rec.reasoning_tokens ?? "null"} completion ${rec.completion_tokens ?? "-"} schema ${rec.schema_ok ?? false}`);
  if (rec.http_status === 429) await new Promise((r) => setTimeout(r, 30_000));
}

const lat = runs.filter((r) => r.http_status === 200).map((r) => r.latency_ms).sort((x, y) => x - y);
const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.ceil((p / 100) * lat.length) - 1)] : null);
const schemaN = runs.filter((r) => r.schema_ok).length;
const summary = {
  pass_schema: `${schemaN}/${n}`,
  p50_ms: pct(50),
  p95_ms: pct(95),
  reasoning_zero: runs.every((r) => r.reasoning_tokens === 0 || r.reasoning_tokens === null || r.reasoning_tokens === undefined) && lat.length === n,
  finish_stop: runs.every((r) => r.finish_reason === "stop"),
  model_match: runs.every((r) => r.model === a.model),
};
const pass = schemaN === n && summary.reasoning_zero && summary.finish_stop && summary.model_match && (summary.p95_ms ?? Infinity) < P95_LIMIT_MS;
const out = {
  gate: "S1-a",
  at: new Date().toISOString(),
  endpoint: URL,
  params: { model: a.model, variant: a.variant, reasoning_effort: a["reasoning-effort"] ?? null, rows, n, temperature: 0, max_tokens: 64, response_format: "json_schema arrow_verdict strict" },
  request_bytes: JSON.stringify(body).length,
  runs,
  summary,
  result: pass ? "PASS" : "FAIL",
};
writeFileSync(resolve(HERE, "s1a-results.json"), JSON.stringify(out, null, 2) + "\n");
log(`schema ${summary.pass_schema} · reasoning ${summary.reasoning_zero ? 0 : "NONZERO"} · finish stop ${runs.filter((r) => r.finish_reason === "stop").length}/${n} · p50 ${summary.p50_ms} ms · p95 ${summary.p95_ms} ms · model ${summary.model_match ? a.model : "MISMATCH"} · S1-a ${out.result}`);
process.exit(pass ? 0 : 1);
