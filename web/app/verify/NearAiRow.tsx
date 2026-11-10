"use client";
import { useEffect, useState } from "react";
import { ProofPill } from "../../components/ProofPill.tsx";
import { fetchNearAiLine, type NearAiLine } from "../../lib/nearAi.ts";
import styles from "./verify.module.css";

/** The NEAR AI endpoint's attestation as seen from this browser right now. Always NOT PROVEN: it is not eval-time. */
export function NearAiRow({ urlPrefix }: { urlPrefix: string }) {
  const [line, setLine] = useState<NearAiLine | null>(null);

  useEffect(() => {
    let alive = true;
    fetchNearAiLine(urlPrefix, fetch, new Date()).then((l) => {
      if (alive) setLine(l);
    });
    return () => {
      alive = false;
    };
  }, [urlPrefix]);

  return (
    <div className={styles.box} aria-live="polite">
      <ProofPill label="NOT PROVEN" /> {line ? line.text : <span role="status">Asking the NEAR AI endpoint for its attestation…</span>}
    </div>
  );
}
