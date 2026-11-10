"use client";
import { useState } from "react";
import { signature, signatureHex } from "@arrow/sdk/minhash";
import { keysFromText, type CriteriaFormState } from "../../../lib/buy.ts";
import form from "../../../components/form.module.css";

const yield_ = () => new Promise<void>((r) => setTimeout(r, 0));

/** The buyer's criteria. The optional own list is turned into 128 numbers here; the list itself is not kept or sent. */
export function CriteriaForm({ columns, value, onChange }: { columns: readonly string[]; value: CriteriaFormState; onChange(v: CriteriaFormState): void }) {
  const [listInfo, setListInfo] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const set = <K extends keyof CriteriaFormState>(k: K, v: CriteriaFormState[K]) => onChange({ ...value, [k]: v });

  async function hashList(text: string) {
    if (text.trim() === "") {
      setListInfo(null);
      set("minhash", "");
      return;
    }
    setListInfo("Computing…");
    await yield_();
    const keys = keysFromText(text, value.keyColumn || undefined);
    if (keys.length === 0) {
      setListInfo("No keys found in that list.");
      set("minhash", "");
      return;
    }
    onChange({ ...value, minhash: signatureHex(signature(keys)) });
    setListInfo(`${keys.length} keys turned into 128 numbers in this browser.`);
  }

  const selectColumn = (id: string, label: string, v: string, key: "dateColumn" | "keyColumn") => (
    <div className={form.field}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={v} onChange={(e) => set(key, e.target.value)}>
        <option value="">none</option>
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div>
      <fieldset className={form.field} style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className={form.legend}>Columns you need</legend>
        <div className={form.checks}>
          {columns.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={value.requiredColumns.includes(c)}
                onChange={(e) => set("requiredColumns", e.target.checked ? [...value.requiredColumns, c] : value.requiredColumns.filter((x) => x !== c))}
              />{" "}
              <span className="mono">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={form.grid2}>
        <div className={form.field}>
          <label htmlFor="min-rows">Minimum rows</label>
          <input id="min-rows" inputMode="numeric" value={value.minRows} onChange={(e) => set("minRows", e.target.value)} />
        </div>
        <div className={form.field}>
          <label htmlFor="null-rate">Maximum null rate (0 to 1)</label>
          <input id="null-rate" inputMode="decimal" value={value.maxNullRate} onChange={(e) => set("maxNullRate", e.target.value)} />
        </div>
        {selectColumn("date-col", "Date column", value.dateColumn, "dateColumn")}
        <div className={form.field}>
          <label htmlFor="date-from">Dates from</label>
          <input id="date-from" type="date" value={value.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
        </div>
        <div className={form.field}>
          <label htmlFor="date-to">Dates to</label>
          <input id="date-to" type="date" value={value.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
        </div>
        {selectColumn("key-col", "Key column (for the comparison with your list)", value.keyColumn, "keyColumn")}
        <div className={form.field}>
          <label htmlFor="min-fit">Minimum fit (1 to 5)</label>
          <select id="min-fit" value={value.minFit} onChange={(e) => set("minFit", Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className={form.field}>
          <label htmlFor="min-nov">Minimum novelty (1 to 5)</label>
          <select id="min-nov" value={value.minNovelty} onChange={(e) => set("minNovelty", Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className={form.field}>
        <label htmlFor="crit-text">What you need, in your words (up to 600 characters)</label>
        <textarea id="crit-text" maxLength={600} value={value.text} onChange={(e) => set("text", e.target.value)} />
        <p className={form.hint}>Your criteria are sealed to the enclave key; the seller never sees them.</p>
      </div>
      <details>
        <summary>Compare with my own list (optional, for the novelty score)</summary>
        <p className={form.hint}>
          Your list never leaves this browser. Only 128 numbers are sealed into the request. Without a list, novelty reads n/a. Pick the
          key column above, then paste one key per line, or choose a CSV with that column.
        </p>
        <div className={form.field}>
          <label htmlFor="own-file">CSV or text file</label>
          <input id="own-file" type="file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await hashList(await f.text()); }} />
        </div>
        <div className={form.field}>
          <label htmlFor="own-paste">Or paste keys</label>
          <textarea id="own-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} onBlur={() => void hashList(pasted)} />
        </div>
        {listInfo ? <p className={form.hint} role="status">{listInfo}</p> : null}
        {value.minhash ? <button type="button" onClick={() => { setPasted(""); setListInfo(null); set("minhash", ""); }}>Remove my list</button> : null}
      </details>
    </div>
  );
}
