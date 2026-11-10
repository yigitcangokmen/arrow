"use client";
import { useEffect, useState } from "react";
import { ProofPill } from "../../components/ProofPill.tsx";
import { checkQuote, type DcapModule, type DcapResult, shortHex } from "../../lib/dcap.ts";
import styles from "./verify.module.css";

const deps = (nowMs: () => number) => ({
  // A plain import(), made only when this row mounts: the verifier wasm is about a megabyte.
  load: () => import("@phala/dcap-qvl-web") as unknown as Promise<DcapModule>,
  fetchJson: async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  },
  nowSeconds: () => nowMs() / 1000,
});

/** Verifies the stored TDX quote of one request against Intel collateral, in this browser. */
export function DcapRow({ quoteB64, outlayerApi }: { quoteB64: string; outlayerApi: string }) {
  const [result, setResult] = useState<DcapResult | null>(null);

  useEffect(() => {
    let alive = true;
    setResult(null);
    checkQuote(quoteB64, outlayerApi, deps(Date.now)).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [quoteB64, outlayerApi]);

  return (
    <div className={styles.box} aria-live="polite">
      {result ? <ProofPill label={result.label} /> : <span role="status">Checking the Intel TDX quote in this browser…</span>}
      {result ? <p>{result.text}</p> : null}
      {result?.fields ? (
        <dl className={styles.facts}>
          {(["mr_td", "rt_mr0", "rt_mr1", "rt_mr2", "rt_mr3", "report_data"] as const).map((k) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd className="mono" title={result.fields![k]}>{shortHex(result.fields![k])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p>
        <ProofPill label="NOT PROVEN" /> Binding of this quote to the eval is OutLayer&apos;s attestation record; Arrow does not verify the quote
        on chain.
      </p>
    </div>
  );
}
