// G3 check shown on /buy and /try: the hash on chain, the hash the enclave reported for the eval and for the release,
// and the hash of the bytes the browser downloaded. All present rows must be equal.
export interface HashRow {
  label: string;
  value: string | null;
  state: "ok" | "mismatch" | "pending";
}

export interface HashCheck {
  rows: HashRow[];
  /** Every row is present and equal to the on-chain hash. */
  match: boolean;
  /** Labels of the rows that differ from the chain. */
  mismatched: string[];
}

/** `evalH` / `releaseH`: undefined leaves the row out, null shows it as pending. */
export function hashCheck(i: { onChain: string; evalH?: string | null; releaseH?: string | null; downloaded?: string | null }): HashCheck {
  const rows: HashRow[] = [{ label: "listing.blob_sha256 (chain)", value: i.onChain, state: "ok" }];
  const add = (label: string, v: string | null | undefined) => {
    if (v === undefined) return;
    rows.push({ label, value: v, state: v === null ? "pending" : v === i.onChain ? "ok" : "mismatch" });
  };
  add("eval h (enclave, from the eval output)", i.evalH);
  add("release h (enclave, from the release output)", i.releaseH);
  rows.push(
    i.downloaded == null
      ? { label: "sha256(downloaded blob)", value: null, state: "pending" }
      : { label: "sha256(downloaded blob)", value: i.downloaded, state: i.downloaded === i.onChain ? "ok" : "mismatch" },
  );
  return { rows, match: rows.every((r) => r.state === "ok"), mismatched: rows.filter((r) => r.state === "mismatch").map((r) => r.label) };
}
