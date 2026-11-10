"use client";
import { useState } from "react";
import { evidenceJson, type WebRun } from "../lib/evidence.ts";
import styles from "./form.module.css";

/** Evidence for evidence-add: the JSON is shown and can be copied. Ids and hashes only, never keys or data. */
export function CopyEvidence({ run }: { run: WebRun }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const json = evidenceJson(run);
  return (
    <details>
      <summary>Evidence JSON</summary>
      <pre className={styles.pre}>{json}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(json).then(() => setCopied("yes"), () => setCopied("no"));
        }}
      >
        Copy evidence JSON
      </button>
      {copied === "yes" ? <span role="status"> copied</span> : null}
      {copied === "no" ? <span role="status"> the browser blocked copying; select the text above</span> : null}
    </details>
  );
}
