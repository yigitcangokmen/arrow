// Local fake blob host + NEAR AI chat endpoint for the dev-endpoints arrow-tee wasm (WS3-T09/T10).
// Dev helper, not shipped. No dependencies (node:http).
//   npx tsx scripts/dev/fake-nearai.ts --port 8787 --blobs <dir> --log <dir>
// GET  /blob/<name>   -> <blobs>/<name>.bin       GET /blob-slow     -> 200 after 40 s
// GET  /blob-huge     -> 6 MiB streamed           GET /blob-404      -> 404
// GET  /blob-redirect -> 302
// POST /v1/chat/completions, mode from "Authorization: Bearer mode:<m>":
//   ok_buy ok_pass ok_inject bad_schema extra_field wrong_model length_finish http500 not_json
//   two_choices fenced slow huge_body
// Each chat request writes <log>/<n>.json with the body size and a few request fields, never the body.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string", default: "8787" }, blobs: { type: "string" }, log: { type: "string" } },
});
const port = Number(values.port);
const blobDir = values.blobs ?? ".";
const logDir = values.log;
if (logDir) mkdirSync(logDir, { recursive: true });
let n = 0;

function later(res: ServerResponse, ms: number, fn: () => void): void {
  const t = setTimeout(fn, ms);
  res.on("close", () => clearTimeout(t));
}

function verdict(fit: number, v: string, inj: boolean): Record<string, unknown> {
  return { fit_llm: fit, verdict: v, injection_seen: inj, criterion_exfil: false };
}

function completion(model: string, content: string, finish = "stop", choices = 1): string {
  const choice = (i: number) => ({ index: i, finish_reason: finish, message: { role: "assistant", content } });
  return JSON.stringify({
    id: "fake-1", object: "chat.completion", model,
    choices: Array.from({ length: choices }, (_, i) => choice(i)),
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function chat(req: IncomingMessage, res: ServerResponse, raw: Buffer): void {
  const mode = String(req.headers.authorization ?? "").replace(/^Bearer mode:/, "");
  let body: Record<string, any> = {};
  try { body = JSON.parse(raw.toString("utf8")); } catch { /* logged as non-JSON below */ }
  if (logDir) {
    n += 1;
    writeFileSync(join(logDir, `${n}.json`), JSON.stringify({
      mode, body_bytes: raw.length, model: body.model ?? null, max_tokens: body.max_tokens ?? null,
      temperature: body.temperature ?? null, response_format_type: body.response_format?.type ?? null,
      enable_thinking: body.chat_template_kwargs?.enable_thinking ?? null,
    }) + "\n");
  }
  const model = typeof body.model === "string" ? body.model : "unknown";
  const ok = (content: Record<string, unknown>) => send(res, 200, completion(model, JSON.stringify(content)));
  switch (mode) {
    case "ok_buy": return ok(verdict(5, "BUY", false));
    case "ok_pass": return ok(verdict(2, "PASS", false));
    case "ok_inject": return ok(verdict(5, "BUY", true));
    case "bad_schema": return ok(verdict(7, "BUY", false));
    case "extra_field": return ok({ ...verdict(5, "BUY", false), note: "x" });
    case "wrong_model": return send(res, 200, completion("other/model", JSON.stringify(verdict(5, "BUY", false))));
    case "length_finish": return send(res, 200, completion(model, JSON.stringify(verdict(5, "BUY", false)), "length"));
    case "http500": return send(res, 500, JSON.stringify({ error: "internal" }));
    case "not_json": return send(res, 200, "this is not json");
    case "two_choices": return send(res, 200, completion(model, JSON.stringify(verdict(5, "BUY", false)), "stop", 2));
    case "fenced": return send(res, 200, completion(model, "```json\n" + JSON.stringify(verdict(5, "BUY", false)) + "\n```"));
    case "slow": return later(res, 40_000, () => ok(verdict(5, "BUY", false)));
    case "huge_body": return send(res, 200, completion(model, "x".repeat(2 * 1024 * 1024)));
    default: return send(res, 400, JSON.stringify({ error: `unknown mode ${mode}` }));
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json"): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function hugeBlob(res: ServerResponse): void {
  const total = 6 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let sent = 0;
  res.writeHead(200, { "content-type": "application/octet-stream", "content-length": total });
  const pump = (): void => {
    while (sent < total) {
      sent += chunk.length;
      if (!res.write(chunk)) { res.once("drain", pump); return; }
    }
    res.end();
  };
  pump();
}

const server = createServer((req, res) => {
  res.on("error", () => { /* client went away (timeouts, size caps): expected */ });
  const url = req.url ?? "/";
  const parts: Buffer[] = [];
  req.on("data", (c: Buffer) => parts.push(c));
  req.on("end", () => {
    if (req.method === "POST" && url === "/v1/chat/completions") return chat(req, res, Buffer.concat(parts));
    if (req.method !== "GET") return send(res, 405, "");
    if (url === "/blob-404") return send(res, 404, "");
    if (url === "/blob-redirect") { res.writeHead(302, { location: "/blob-404" }); res.end(); return; }
    if (url === "/blob-huge") return hugeBlob(res);
    if (url === "/blob-slow") return later(res, 40_000, () => send(res, 200, Buffer.alloc(64), "application/octet-stream"));
    const m = /^\/blob\/([A-Za-z0-9._-]+)$/.exec(url);
    const file = m ? join(blobDir, `${m[1]}.bin`) : "";
    if (file && existsSync(file)) return send(res, 200, readFileSync(file), "application/octet-stream");
    send(res, 404, "");
  });
});
server.listen(port, "127.0.0.1", () => console.log(`fake-nearai listening on http://127.0.0.1:${port}`));
