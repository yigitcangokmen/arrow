"use client";
import { useState } from "react";
import { shortHash } from "../lib/links.ts";
import styles from "./HashValue.module.css";

/** A long hash shown short, with the whole value in the title and a copy button. */
export function HashValue({ value }: { value: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  return (
    <span className={styles.hash}>
      <span className="mono" title={value}>{shortHash(value)}</span>
      <button
        type="button"
        className={styles.copy}
        aria-label={`Copy ${value}`}
        onClick={() => navigator.clipboard.writeText(value).then(() => setCopied("yes"), () => setCopied("no"))}
      >
        {copied === "yes" ? "copied" : "copy"}
      </button>
      {copied === "no" ? <span role="status" className={styles.note}> copying was blocked; hover for the value</span> : null}
    </span>
  );
}
