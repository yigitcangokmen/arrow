"use client";
import { useEffect, useRef, useState } from "react";
import { BuyInputError, ownListSignature, type CriteriaFormState } from "../../../lib/buy.ts";
import form from "../../../components/form.module.css";

const yield_ = () => new Promise<void>((r) => setTimeout(r, 0));

/** The buyer's criteria. The optional own list is turned into 128 numbers here; the list itself is not kept or sent. */
export function CriteriaForm({ columns, value, onChange }: { columns: readonly string[]; value: CriteriaFormState; onChange(v: CriteriaFormState): void }) {
  const [listInfo, setListInfo] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  /** The list as typed or loaded, kept in this tab only so it can be hashed again when the key column changes. */
  const [rawList, setRawList] = useState("");
  const latest = useRef(value);
  latest.current = value;
  const set = <K extends keyof CriteriaFormState>(k: K, v: CriteriaFormState[K]) => onChange({ ...value, [k]: v });

  // The signature depends on the key column. It is recomputed whenever either changes, so it never hashes whole CSV lines
  // because the column was picked after the file (QA-05).
  useEffect(() => {
    let alive = true;
    const apply = (minhash: string, info: string | null) => {
      if (!alive) return;
      setListInfo(info);
      if (latest.current.minhash !== minhash) onChange({ ...latest.current, minhash });
    };
    if (rawList.trim() === "") {
      apply("", null);
      return () => void (alive = false);
    }
    if (!value.keyColumn) {
      apply("", "Pick the key column above, then your list is compared on it.");
      return () => void (alive = false);
    }
    setListInfo("Computing…");
    yield_().then(() => {
      try {
        const sig = ownListSignature(rawList, value.keyColumn);
        apply(sig ? sig.hex : "", sig ? `${sig.keys} keys turned into 128 numbers in this browser.` : "No keys found in that list.");
      } catch (e) {
        apply("", e instanceof BuyInputError ? e.message : "Could not read that list.");
      }
    });
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawList, value.keyColumn]);

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
      <div className={form.field}>
        <label htmlFor="crit-text">What you need, in your words (up to 600 characters)</label>
        <textarea id="crit-text" maxLength={600} required aria-required="true" aria-describedby="crit-hint" value={value.text} onChange={(e) => set("text", e.target.value)} />
        <p id="crit-hint" className={form.hint}>
          Required. Your criteria are sealed to the enclave key; the seller cannot read them. The key and date columns you pick move the public
          instruction count of the run (see the trust table).
        </p>
      </div>
      <fieldset className={form.field} style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className={form.legend}>Columns you need <span className={form.hint}>(optional)</span></legend>
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
      <details className={form.fine}>
        <summary>Fine-tune the inspection (optional): rows, dates, scores, compare with my own list</summary>
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
        <details>
          <summary>Compare with my own list (optional, for the novelty score)</summary>
          <p className={form.hint} id="own-hint">
            Your list itself is not sent: 128 numbers made from it here are sealed into the request. They are not keyed, so whoever can
            unseal the request can test guesses and recover up to 128 members of your list (trust row <i>OutLayer keystore DAO</i>). Without a list, novelty reads n/a. Pick the
            key column above first, then paste one key per line, or choose a CSV with that column.
          </p>
          <div className={form.field}>
            <label htmlFor="own-file">CSV or text file</label>
            <input id="own-file" type="file" disabled={!value.keyColumn} aria-describedby="own-hint" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRawList(await f.text()); }} />
          </div>
          <div className={form.field}>
            <label htmlFor="own-paste">Or paste keys</label>
            <textarea id="own-paste" disabled={!value.keyColumn} aria-describedby="own-hint" value={pasted} onChange={(e) => setPasted(e.target.value)} onBlur={() => setRawList(pasted)} />
          </div>
          {listInfo ? <p className={form.hint} role="status">{listInfo}</p> : null}
          {rawList ? <button type="button" onClick={() => { setPasted(""); setRawList(""); }}>Remove my list</button> : null}
        </details>
      </details>
    </div>
  );
}
