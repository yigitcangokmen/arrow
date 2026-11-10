// Reads the seller's file (CSV or JSONL) and the buyer's list: column names, row count, and the values of one column.
import { readFileSync } from "node:fs";

/** RFC 4180: quoted fields, "" inside quotes, CRLF or LF. A trailing blank line is not a row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export interface Table {
  columns: string[];
  rows: number;
  column(name: string): string[];
}

export function readTable(path: string): Table {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  if (/\.jsonl?$/i.test(path)) {
    const objs = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
    const columns = objs.length ? Object.keys(objs[0]) : [];
    return { columns, rows: objs.length, column: (name) => objs.map((o) => String(o[name] ?? "")) };
  }
  const [header = [], ...body] = parseCsv(text);
  return {
    columns: header,
    rows: body.length,
    column(name) {
      const i = header.indexOf(name);
      if (i < 0) throw new Error(`column "${name}" not found (columns: ${header.join(", ")})`);
      return body.map((r) => r[i] ?? "");
    },
  };
}
