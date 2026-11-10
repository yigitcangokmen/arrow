"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { encryptFile } from "@arrow/sdk/crypto";
import { fetchAndCheckBlob } from "@arrow/sdk/flows";
import { formatUsdc } from "../../lib/format.ts";
import type { Network } from "../../lib/config.ts";
import { describeError } from "../../lib/errors.ts";
import { listingLinks } from "../../lib/links.ts";
import { payWithIntent } from "../../lib/pay.ts";
import {
  budgetPreview, buildListMsg, checkBlobUrl, fileKind, inspectFile, MAX_PLAINTEXT_BYTES, SellInputError, TITLE_PREFIXES, validateFields,
  type SellFields, type TitlePrefix,
} from "../../lib/sell.ts";
import { findEventId } from "../../lib/settle.ts";
import { suggestTopUp } from "../../lib/topup.ts";
import type { Eoa } from "../../lib/wallet.ts";
import { CopyEvidence } from "../../components/CopyEvidence.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { StepList, type Step, type StepState } from "../../components/StepList.tsx";
import { TopUp } from "../../components/TopUp.tsx";
import { TxLink } from "../../components/TxLink.tsx";
import { WalletButton } from "../../components/WalletButton.tsx";
import form from "../../components/form.module.css";
import styles from "./sell.module.css";

interface Props {
  network: Network;
  programPk: string | null;
  bond: string;
  limits: { minPrice: string; minEvalFee: string };
  maxEvalsCap: number;
  readOnly: boolean;
}

interface Picked {
  name: string;
  size: number;
  bytes: Uint8Array;
}

/** The ciphertext and its key, kept only between "encrypted" and "listed". */
interface Sealed {
  plain: Uint8Array;
  key: Uint8Array;
  blob: Uint8Array;
  sha: string;
}

const STEPS = ["Encrypt in this browser", "Upload the ciphertext", "Seal the key to the enclave", "Sign the list intent", "Relay and wait for the listing"] as const;

const wipe = (s: Sealed | null) => {
  s?.plain.fill(0);
  s?.key.fill(0);
};

export function SellForm({ network, programPk, bond, limits, maxEvalsCap, readOnly }: Props) {
  const [eoa, setEoa] = useState<Eoa | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [prefix, setPrefix] = useState<TitlePrefix>("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState("0");
  const [price, setPrice] = useState("0.25");
  const [evalFee, setEvalFee] = useState("0.10");
  const [maxEvals, setMaxEvals] = useState("50");
  const [mode, setMode] = useState<"scored" | "verdict">("scored");
  const [payout, setPayout] = useState("");
  const [selfHost, setSelfHost] = useState(false);
  const [hostUrl, setHostUrl] = useState("");
  const [steps, setSteps] = useState<StepState[]>(STEPS.map(() => "todo"));
  const [detail, setDetail] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fallback?: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [needUrl, setNeedUrl] = useState<{ href: string; name: string } | null>(null);
  const [done, setDone] = useState<{ listingId: number; txHash: string } | null>(null);
  const sealed = useRef<Sealed | null>(null);
  const fieldsRef = useRef<SellFields | null>(null);

  useEffect(() => () => wipe(sealed.current), []);

  const bondUnits = BigInt(bond);
  const lowBalance = eoa !== null && balance !== null && balance < bondUnits;
  const mark = (i: number, s: StepState, d?: string) => {
    setSteps((prev) => prev.map((v, j) => (j === i ? s : v)));
    if (d !== undefined) setDetail((prev) => ({ ...prev, [i]: d }));
  };

  async function onFile(f: File | undefined) {
    setError(null);
    setPicked(null);
    if (!f) return;
    try {
      const kind = fileKind(f.name);
      if (f.size > MAX_PLAINTEXT_BYTES) throw new SellInputError(`The file is ${f.size} bytes; the limit is ${MAX_PLAINTEXT_BYTES} (5 MB minus encryption overhead).`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = inspectFile(kind, new TextDecoder().decode(bytes));
      setPicked({ name: f.name, size: f.size, bytes });
      setColumns(info.columns);
      setRows(String(info.rows));
      if (!title) setTitle(f.name.replace(/\.(csv|jsonl)$/i, ""));
    } catch (e) {
      setError(describeError(e));
    }
  }

  function collect(): SellFields {
    const fields: SellFields = {
      prefix, title, publicDesc: desc, columns, rowsClaimed: Number(rows), price, evalFee, maxEvals: Number(maxEvals), mode,
      ...(payout.trim() ? { payout: payout.trim().toLowerCase() } : {}),
    };
    validateFields(fields, { minPrice: BigInt(limits.minPrice), minEvalFee: BigInt(limits.minEvalFee) });
    if (fields.maxEvals > maxEvalsCap) throw new SellInputError(`This market allows at most ${maxEvalsCap} inspections per listing.`);
    return fields;
  }

  async function start() {
    setError(null);
    setWarning(null);
    setNeedUrl(null);
    if (!eoa || !picked || !programPk) return;
    let fields: SellFields;
    try {
      fields = collect();
    } catch (e) {
      setError(describeError(e));
      return;
    }
    fieldsRef.current = fields;
    setBusy(true);
    setSteps(STEPS.map(() => "todo"));
    setDetail({});
    try {
      mark(0, "doing");
      wipe(sealed.current);
      const plain = picked.bytes.slice(); // the copy is wiped after use; `picked` stays for a retry
      const enc = encryptFile(plain);
      sealed.current = { plain, key: enc.key, blob: enc.blob, sha: enc.blobSha256 };
      mark(0, "done", `${enc.blob.length} bytes, sha256 ${enc.blobSha256.slice(0, 12)}…`);

      mark(1, "doing");
      if (selfHost) {
        offerDownload(enc.blob, enc.blobSha256);
        mark(1, "doing", "waiting for your https URL");
        return;
      }
      try {
        const res = await upload(`blobs/${enc.blobSha256}.bin`, new Blob([enc.blob as BlobPart]), {
          access: "public",
          handleUploadUrl: "/api/blob",
          contentType: "application/octet-stream",
          clientPayload: JSON.stringify({ sha256: enc.blobSha256, size: enc.blob.length }),
          multipart: enc.blob.length > 4_000_000,
          onUploadProgress: (p) => setDetail((prev) => ({ ...prev, 1: `${Math.round(p.percentage)}%` })),
        });
        mark(1, "done", res.url.length > 60 ? `${res.url.slice(0, 57)}…` : res.url);
        await finish(res.url, fields);
      } catch (e) {
        mark(1, "failed");
        offerDownload(enc.blob, enc.blobSha256);
        setWarning(`The hosted upload did not work (${describeError(e).message}). You can host the encrypted file yourself: download it, put it on any https host, and paste the URL.`);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function offerDownload(blob: Uint8Array, sha: string) {
    setNeedUrl({ href: URL.createObjectURL(new Blob([blob as BlobPart], { type: "application/octet-stream" })), name: `${sha}.bin` });
  }

  async function useOwnUrl() {
    setError(null);
    const fields = fieldsRef.current;
    const s = sealed.current;
    if (!fields || !s) return;
    setBusy(true);
    try {
      const url = checkBlobUrl(hostUrl);
      try {
        await fetchAndCheckBlob(url, s.sha);
      } catch (e) {
        if (e instanceof Error && e.name === "BlobHashMismatch") throw new SellInputError("That URL serves different bytes than the encrypted file. Upload the downloaded .bin unchanged.");
        setWarning("Could not check the URL from this browser (it may not allow cross-origin reads). The enclave downloads it itself and checks the hash on chain.");
      }
      mark(1, "done", url.length > 60 ? `${url.slice(0, 57)}…` : url);
      setNeedUrl(null);
      await finish(url, fields);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(blobUrl: string, fields: SellFields) {
    const s = sealed.current;
    if (!s || !eoa || !programPk) return;
    let at = 2;
    try {
      mark(2, "doing");
      const built = buildListMsg({ fields, plaintext: s.plain, key: s.key, nonce: s.blob.slice(0, 24), blobUrl, programPk, seller: eoa.intentsId });
      if (built.blobSha256 !== s.sha) throw new Error("internal check failed: the rebuilt ciphertext differs");
      mark(2, "done");

      at = 3;
      mark(3, "doing", "confirm in your wallet");
      const paid = await payWithIntent(eoa, { amount: bondUnits, msg: built.msg });
      mark(3, "done");

      at = 4;
      mark(4, "doing");
      const listingId = await findEventId(network, paid, "arrow_listed", "listing_id");
      mark(4, "done", `listing #${listingId}`);
      setDone({ listingId, txHash: paid.txHash });
      wipe(s);
      sealed.current = null;
      picked?.bytes.fill(0);
      setPicked(null);
    } catch (e) {
      mark(at, "failed");
      setError(describeError(e));
    }
  }

  const needTopUp = lowBalance && !done;
  const ready = eoa !== null && picked !== null && programPk !== null && !needTopUp && !readOnly;
  const links = done ? listingLinks(done.listingId, network) : null;

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {programPk === null && !readOnly ? (
        <ErrorBox title="The enclave key is not published yet">
          <p>Listing opens once the market contract has published its program key. Reload in a few minutes.</p>
        </ErrorBox>
      ) : null}

      <section className={form.panel} aria-labelledby="s1">
        <h2 id="s1">1. Wallet and listing bond</h2>
        <WalletButton eoa={eoa} balance={balance} onConnect={setEoa} onBalance={setBalance} />
        <p className={form.hint}>
          The listing bond is {formatUsdc(bondUnits)} USDC, paid from your NEAR Intents balance with one signature. Your wallet shows the
          intent as JSON: check that the receiver is the market contract and the amount is {formatUsdc(bondUnits)} USDC.
        </p>
        {needTopUp && eoa ? <TopUp eoa={eoa} defaultAmount={suggestTopUp(bondUnits, balance ?? 0n)} onSuccess={() => setBalance(null)} /> : null}
      </section>

      <section className={form.panel} aria-labelledby="s2">
        <h2 id="s2">2. Your file</h2>
        <div className={form.field}>
          <label htmlFor="file">CSV or JSONL file (up to {Math.floor(MAX_PLAINTEXT_BYTES / 1_000_000 * 10) / 10} MB)</label>
          <input id="file" type="file" accept=".csv,.jsonl" onChange={(e) => void onFile(e.target.files?.[0])} />
          <p className={form.hint}>The file is read here and encrypted here. Its contents are in no request: only the ciphertext is uploaded.</p>
        </div>
        {picked ? (
          <p className={styles.file}>
            {picked.name} · {picked.size} bytes · {columns.length} columns: <span className="mono">{columns.slice(0, 8).join(", ")}{columns.length > 8 ? ", …" : ""}</span>
          </p>
        ) : null}
      </section>

      <section className={form.panel} aria-labelledby="s3">
        <h2 id="s3">3. What buyers see</h2>
        <div className={form.grid2}>
          <div className={form.field}>
            <label htmlFor="prefix">Label</label>
            <select id="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value as TitlePrefix)}>
              {TITLE_PREFIXES.map((p) => (
                <option key={p} value={p}>{p === "" ? "none (external seller)" : p}</option>
              ))}
            </select>
            <p className={form.hint}>Use [synthetic] only for made-up data and [team-made] only for data the Arrow team made.</p>
          </div>
          <div className={form.field}>
            <label htmlFor="title">Title (80 characters with the label)</label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </div>
        </div>
        <div className={form.field}>
          <label htmlFor="desc">Public description (up to 280 characters)</label>
          <textarea id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} />
          <p className={form.hint}>Everyone can read this and the column names. Do not put data rows here.</p>
        </div>
        <div className={form.grid2}>
          <div className={form.field}>
            <label htmlFor="rows">Rows (claimed)</label>
            <input id="rows" inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value)} />
          </div>
          <div className={form.field}>
            <label htmlFor="price">Price to buy (USDC, at least {formatUsdc(BigInt(limits.minPrice))})</label>
            <input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className={form.field}>
            <label htmlFor="fee">Inspection fee (USDC, at least {formatUsdc(BigInt(limits.minEvalFee))})</label>
            <input id="fee" inputMode="decimal" value={evalFee} onChange={(e) => setEvalFee(e.target.value)} />
          </div>
          <div className={form.field}>
            <label htmlFor="max">Max inspections (1 to {maxEvalsCap})</label>
            <input id="max" inputMode="numeric" value={maxEvals} onChange={(e) => setMaxEvals(e.target.value)} />
          </div>
          <div className={form.field}>
            <label htmlFor="mode">Answer</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as "scored" | "verdict")}>
              <option value="scored">BUY/PASS with fit and novelty (5.67 bits per inspection)</option>
              <option value="verdict">BUY/PASS only (1.59 bits per inspection)</option>
            </select>
          </div>
          <div className={form.field}>
            <label htmlFor="payout">Payout address (optional)</label>
            <input id="payout" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x… or a NEAR account; default: this wallet" />
          </div>
        </div>
        <p className={form.hint} aria-live="polite">
          The most the chain lets out for this listing: {budgetPreview(Number.isInteger(Number(maxEvals)) && Number(maxEvals) > 0 ? Number(maxEvals) : 0, mode)}.
        </p>
        <div className={form.field}>
          <label>
            <input type="checkbox" checked={selfHost} onChange={(e) => setSelfHost(e.target.checked)} /> I host the encrypted file myself (an https URL I paste)
          </label>
        </div>
      </section>

      <div className={form.actions}>
        <button type="button" className={form.primary} disabled={!ready || busy} onClick={() => void start()}>
          {busy ? "Working…" : "Encrypt, upload and list"}
        </button>
        {!eoa ? <span className={form.hint}>Connect a wallet to continue.</span> : null}
        {eoa && !picked ? <span className={form.hint}>Choose a file to continue.</span> : null}
      </div>

      {steps.some((s) => s !== "todo") ? (
        <div className={styles.steps}>
          <StepList steps={STEPS.map((label, i): Step => ({ label, state: steps[i], detail: detail[i] }))} />
        </div>
      ) : null}

      {warning ? <p className={form.band} role="status">{warning}</p> : null}

      {needUrl ? (
        <section className={form.panel} aria-labelledby="own">
          <h3 id="own">Host it yourself</h3>
          <p>
            <a href={needUrl.href} download={needUrl.name}>Download {needUrl.name}</a>, upload it unchanged to an https host, then paste the URL.
          </p>
          <div className={form.field}>
            <label htmlFor="url">https URL (up to 200 characters)</label>
            <input id="url" value={hostUrl} onChange={(e) => setHostUrl(e.target.value)} />
          </div>
          <button type="button" className={form.primary} disabled={busy || hostUrl.trim() === ""} onClick={() => void useOwnUrl()}>Use this URL</button>
        </section>
      ) : null}

      {error ? (
        <ErrorBox title="The listing did not go through" fallback={error.fallback}>
          <p>{error.message}</p>
        </ErrorBox>
      ) : null}

      {done && links ? (
        <section className={`${form.panel} ${styles.success}`} aria-live="polite">
          <h2>Listed as #{done.listingId}</h2>
          <p>
            <Link href={links.buy}>Open the listing</Link> · <a href={links.x402}>x402 link</a> · transaction <TxLink chain="near" network={network} hash={done.txHash} />
          </p>
          <p className={form.hint}>The key and your file are cleared from this page. Reloading leaves nothing behind.</p>
          <CopyEvidence
            run={{
              kind: "list", tx: done.txHash, chain: "near", listing_id: done.listingId,
              expect: `list op accepted, listing ${done.listingId} created with a ${formatUsdc(bondUnits)} USDC bond`,
              observed: `arrow_listed event for listing ${done.listingId} in ${done.txHash}`,
            }}
          />
        </section>
      ) : null}
    </fieldset>
  );
}
