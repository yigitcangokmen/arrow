// RFC 4180 writer and parser: UTF-8, no BOM, LF, one trailing newline (WS6 card 2.3).
export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const recs: string[][] = [];
  let rec: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { rec.push(cell); cell = ""; }
    else if (ch === "\n") { rec.push(cell); recs.push(rec); rec = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || rec.length > 0) { rec.push(cell); recs.push(rec); }
  const [header, ...rows] = recs;
  return { header: header ?? [], rows };
}
