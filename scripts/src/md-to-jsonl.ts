// WS7-T02: turn a Markdown report into JSONL rows the enclave can read (CSV/JSONL only, DEC I-13).
//   npm run md2jsonl -- report.md > report.jsonl
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type MdRow = { section: string; chunk: number; text: string };
export const MAX_TEXT = 200;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_LINES = 200000;

function hardSplit(s: string): string[] {
  const out: string[] = [];
  let rest = Array.from(s);
  while (rest.length > MAX_TEXT) {
    let cut = rest.slice(0, MAX_TEXT).lastIndexOf(" ");
    if (cut <= 0) cut = MAX_TEXT;
    out.push(rest.slice(0, cut).join("").trim());
    rest = Array.from(rest.slice(cut).join("").trimStart());
  }
  if (rest.length) out.push(rest.join(""));
  return out;
}

// Paragraph -> sentences (split after ". ", "? ", "! "), each at most 200 characters.
function pieces(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean.split(/(?<=[.?!])\s+/).flatMap((s) => (Array.from(s).length > MAX_TEXT ? hardSplit(s) : [s]));
}

export function mdToRows(md: string): MdRow[] {
  if (Buffer.byteLength(md, "utf8") > MAX_BYTES) throw new RangeError("input larger than 5 MB");
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > MAX_LINES) throw new RangeError("input has more than 200000 lines");
  const rows: MdRow[] = [];
  let section = "body";
  let chunk = 0;
  let para: string[] = [];
  let code: string[] | null = null;
  const emit = (text: string) => {
    for (const t of pieces(text)) rows.push({ section, chunk: chunk++, text: t });
  };
  const flush = () => {
    emit(para.join(" "));
    para = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (code === null) { flush(); code = []; } else { emit(code.join(" ")); code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const h = /^#{1,3}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      section = (h[1] as string).trim() || "body";
      chunk = 0;
    } else if (line.trim() === "") flush();
    else para.push(line.trim());
  }
  if (code !== null) emit(code.join(" "));
  flush();
  return rows;
}

export const toJsonl = (rows: MdRow[]) => rows.map((r) => JSON.stringify({ section: r.section, chunk: r.chunk, text: r.text })).join("\n") + (rows.length ? "\n" : "");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("usage: md2jsonl <in.md>"); process.exit(2); }
  try {
    process.stdout.write(toJsonl(mdToRows(readFileSync(file, "utf8"))));
  } catch (e) {
    console.error(`md2jsonl: ${(e as Error).message} (limit: 5 MB, 200000 lines)`);
    process.exit(2);
  }
}
