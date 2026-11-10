"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { ArrowViews } from "@arrow/sdk/contract";
import { encryptFile } from "@arrow/sdk/crypto";
import { fetchAndCheckBlob } from "@arrow/sdk/flows";
import { isTeamAccount } from "@arrow/sdk/team";
import { formatUsdc, net } from "../../lib/format.ts";
import { parseUsdc } from "@arrow/sdk/usdc";
import { CONTRACTS, type Network } from "../../lib/config.ts";
import { describeError } from "../../lib/errors.ts";
import { listingLinks } from "../../lib/links.ts";
import { locateLatest } from "../../lib/locate.ts";
import { checkPayment, pendingPayment, payWithIntent, PaymentPending, PaymentUnclear, type PaidTx } from "../../lib/pay.ts";
import type { PendingPayment } from "../../lib/pending.ts";
import {
  budgetPreview, buildListMsg, checkBlobUrl, fileKind, inspectFile, MAX_PLAINTEXT_BYTES, normalizePayout, prefixesFor, SellInputError, validateFields,
  type SellFields, type TitlePrefix,
} from "../../lib/sell.ts";
import { findEventId } from "../../lib/settle.ts";
import { suggestTopUp } from "../../lib/topup.ts";
import type { Eoa } from "../../lib/wallet.ts";
import { Announcer } from "../../components/Announcer.tsx";
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
  /** Accounts the team listed in evidence/team-accounts.json: only they may use the [team-made] label. */
  teamAccounts: string[];
  /** Arrow's share in basis points of an inspection fee and of a sale. */
  feeBps: { eval: number; sale: number };
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

/** The seller's take, from the contract's own rounding (NUM-4). */
function takeRate(price: string, evalFee: string, bps: { eval: number; sale: number }, bond: bigint): string {
  let fee = "";
  try {
    const f = parseUsdc(evalFee);
    const p = parseUsdc(price);
    fee = ` You receive ${formatUsdc(net(f, bps.eval))} of each ${formatUsdc(f)} inspection fee and ${formatUsdc(net(p, bps.sale))} of each ${formatUsdc(p)} sale.`;
  } catch {
    // the fields are being typed
  }
  return `Arrow keeps ${bps.eval / 100}% of each inspection fee and ${bps.sale / 100}% of each sale.${fee} The ${formatUsdc(bond)} USDC listing bond is a listing fee paid to Arrow; it is not given back.`;
}

const wipe = (s: Sealed | null) => {
  s?.plain.fill(0);
  s?.key.fill(0);
};

export function SellForm({ network, programPk, bond, limits, maxEvalsCap, readOnly, teamAccounts, feeBps }: Props) {
  const [eoa, setEoa] = useState<Eoa | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceKey, setBalanceKey] = useState(0);
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
  const [done, setDone] = useState<{ listingId: number; txHash: string | null } | null>(null);
  /** Between "the file is encrypted" and "the listing exists" the section 3 fields are frozen: what is listed is what was shown. */
  const [inProgress, setInProgress] = useState(false);
  /** The finished list msg (public ciphertext data only) and where it points; it outlives the key, so a retry never re-encrypts. */
  const [listMsg, setListMsg] = useState<{ msg: string; blobUrl: string; sha: string } | null>(null);
  const [paidTx, setPaidTx] = useState<PaidTx | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  /** A download of the ciphertext for the seller to keep: the hosted copy is not kept for ever and blob_url is fixed on chain (X12-3). */
  const [copyOfBlob, setCopyOfBlob] = useState<{ href: string; name: string } | null>(null);
  const sealed = useRef<Sealed | null>(null);
  const fieldsRef = useRef<SellFields | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => wipe(sealed.current), []);
  useEffect(() => {
    if (done) successHeading.current?.focus();
  }, [done]);
  useEffect(() => {
    setPending(eoa ? pendingPayment(eoa) : null);
  }, [eoa]);
  useEffect(() => {
    if (!inProgress && !pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inProgress, pending]);
  useEffect(() => {
    if (!errorField) return;
    const el = document.getElementById(errorField);
    el?.focus();
  }, [errorField, error]);

  const resetWallet = useCallback(() => {
    setEoa(null);
    setBalance(null);
  }, []);

  const bondUnits = BigInt(bond);
  const lowBalance = eoa !== null && balance !== null && balance < bondUnits;
  const mark = (i: number, s: StepState, d?: string) => {
    setSteps((prev) => prev.map((v, j) => (j === i ? s : v)));
    if (d !== undefined) setDetail((prev) => ({ ...prev, [i]: d }));
  };
  const fail = (e: unknown) => {
    const d = describeError(e);
    setError(d);
    setErrorField(e instanceof SellInputError && e.field ? e.field : null);
  };

  async function onFile(f: File | undefined) {
    setError(null);
    setErrorField(null);
    setPicked(null);
    if (!f) return;
    try {
      const kind = fileKind(f.name);
      if (f.size > MAX_PLAINTEXT_BYTES) throw new SellInputError(`The file is ${f.size} bytes; the limit is ${MAX_PLAINTEXT_BYTES} (5 MB minus encryption overhead).`, "file");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = inspectFile(kind, new TextDecoder().decode(bytes));
      setPicked({ name: f.name, size: f.size, bytes });
      setColumns(info.columns);
      setRows(String(info.rows));
      if (!title) setTitle(f.name.replace(/\.(csv|jsonl)$/i, ""));
    } catch (e) {
      fail(e);
    }
  }

  function collect(): SellFields {
    const fields: SellFields = {
      prefix, title, publicDesc: desc, columns, rowsClaimed: Number(rows), price, evalFee, maxEvals: Number(maxEvals), mode,
      ...(payout.trim() ? { payout: normalizePayout(payout, CONTRACTS[network]) } : {}),
    };
    validateFields(fields, { minPrice: BigInt(limits.minPrice), minEvalFee: BigInt(limits.minEvalFee) });
    if (fields.maxEvals > maxEvalsCap) throw new SellInputError(`This market allows at most ${maxEvalsCap} inspections per listing.`, "max");
    return fields;
  }

  async function start() {
    setError(null);
    setErrorField(null);
    setWarning(null);
    setNeedUrl(null);
    if (!eoa || !picked || !programPk) return;
    let fields: SellFields;
    try {
      fields = collect();
    } catch (e) {
      fail(e);
      return;
    }
    fieldsRef.current = fields;
    setBusy(true);
    setInProgress(true);
    setSteps(STEPS.map(() => "todo"));
    setDetail({});
    try {
      mark(0, "doing");
      wipe(sealed.current);
      const plain = picked.bytes.slice(); // the copy is wiped after use; `picked` stays for a retry
      const enc = encryptFile(plain);
      sealed.current = { plain, key: enc.key, blob: enc.blob, sha: enc.blobSha256 };
      mark(0, "done", `${enc.blob.length} bytes, sha256 ${enc.blobSha256.slice(0, 12)}…`);
      keepCopy(enc.blob, enc.blobSha256);

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
      fail(e);
      setInProgress(false);
    } finally {
      setBusy(false);
    }
  }

  function offerDownload(blob: Uint8Array, sha: string) {
    setNeedUrl({ href: URL.createObjectURL(new Blob([blob as BlobPart], { type: "application/octet-stream" })), name: `${sha}.bin` });
  }
  function keepCopy(blob: Uint8Array, sha: string) {
    setCopyOfBlob({ href: URL.createObjectURL(new Blob([blob as BlobPart], { type: "application/octet-stream" })), name: `${sha}.bin` });
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
        if (e instanceof Error && e.name === "BlobHashMismatch") throw new SellInputError("That URL serves different bytes than the encrypted file. Upload the downloaded .bin unchanged.", "url");
        setWarning("Could not check the URL from this browser (it may not allow cross-origin reads). The enclave downloads it itself and checks the hash on chain.");
      }
      mark(1, "done", url.length > 60 ? `${url.slice(0, 57)}…` : url);
      setNeedUrl(null);
      await finish(url, fields);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Builds the list msg once, drops the key at once, then pays. Everything after this point works from the finished msg. */
  async function finish(blobUrl: string, fields: SellFields) {
    const s = sealed.current;
    if (!s || !eoa || !programPk) return;
    mark(2, "doing");
    try {
      const built = buildListMsg({ fields, plaintext: s.plain.slice(), key: s.key.slice(), nonce: s.blob.slice(0, 24), blobUrl, programPk, seller: eoa.intentsId });
      if (built.blobSha256 !== s.sha) throw new Error("internal check failed: the rebuilt ciphertext differs");
      wipe(s);
      sealed.current = null;
      mark(2, "done");
      const m = { msg: built.msg, blobUrl, sha: s.sha };
      setListMsg(m);
      await payAndFind(m);
    } catch (e) {
      mark(2, "failed");
      fail(e);
    }
  }

  /** Pays the bond for a finished msg and looks the listing up. A retry of this function reuses the same msg, never the file. */
  async function payAndFind(m: { msg: string; sha: string }) {
    if (!eoa) return;
    setError(null);
    setBusy(true);
    let at = 3;
    try {
      mark(3, "doing", "confirm in your wallet");
      let paid: PaidTx;
      try {
        paid = await payWithIntent(eoa, { kind: "list", listingId: null, amount: bondUnits, msg: m.msg });
      } catch (e) {
        if (e instanceof PaymentUnclear || e instanceof PaymentPending) setPending(e.pending);
        throw e;
      }
      setPaidTx(paid);
      mark(3, "done");
      at = 4;
      await findListing(paid);
    } catch (e) {
      mark(at, "failed");
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function findListing(paid: PaidTx) {
    mark(4, "doing");
    const listingId = await findEventId(network, paid, "arrow_listed", "listing_id");
    mark(4, "done", `listing #${listingId}`);
    finished(listingId, paid.txHash);
  }

  function finished(listingId: number, txHash: string | null) {
    setDone({ listingId, txHash });
    picked?.bytes.fill(0);
    setPicked(null);
    setListMsg(null);
    setPaidTx(null);
    setInProgress(false);
  }

  /** "Check payment": sends the stored signed bond payment again; it never asks the wallet to sign. */
  async function checkPay() {
    if (!eoa || !listMsg) return;
    setError(null);
    setBusy(true);
    try {
      const r = await checkPayment(eoa);
      setPending(pendingPayment(eoa));
      if (r.state === "paid") {
        setPayNote("The payment went through.");
        setPaidTx(r.paid);
        mark(3, "done");
        await findListing(r.paid);
      } else if (r.state === "paid-no-tx") {
        setPayNote("The payment went through, but the relay lost its transaction link. Looking for the listing on chain.");
        const views = new ArrowViews(network, CONTRACTS[network]);
        const found = await locateLatest((id) => views.listing(id), (l) => l.blob_sha256 === listMsg.sha && l.seller.toLowerCase() === eoa.intentsId);
        if (!found) throw new Error("The payment went through, but the listing is not on chain yet. Check again in a minute.");
        mark(3, "done");
        mark(4, "done", `listing #${found.id}`);
        finished(Number(found.id), null);
      } else if (r.state === "released") {
        setPayNote("That signed payment expired without being paid. You can list again with the same file.");
      } else if (r.state === "waiting") {
        setPayNote(`Still not confirmed. The signed payment expires at ${new Date(r.until).toLocaleTimeString()}; until then do not pay again, and check again in a minute.`);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    wipe(sealed.current);
    sealed.current = null;
    setListMsg(null);
    setNeedUrl(null);
    setInProgress(false);
    setSteps(STEPS.map(() => "todo"));
    setDetail({});
    setError(null);
    setWarning(null);
  }

  const needTopUp = lowBalance && !done;
  const isTeam = eoa !== null && isTeamAccount(eoa.intentsId, teamAccounts);
  const ready = eoa !== null && picked !== null && programPk !== null && !needTopUp && !readOnly;
  const resumable = listMsg !== null || paidTx !== null || pending !== null;
  const canStart = ready && !busy && !inProgress && !resumable;
  const why = [
    !eoa ? "Connect a wallet (section 1)." : null,
    eoa && !picked ? "Choose a file (section 2)." : null,
    needTopUp ? "Add USDC for the listing bond (section 1)." : null,
    programPk === null ? "The enclave key is not published yet." : null,
    pending ? "An earlier payment is not confirmed yet: check it first." : null,
    resumable && !pending ? "A listing is in progress: use Retry listing or Start over." : null,
  ].filter((w): w is string => w !== null);
  const links = done ? listingLinks(done.listingId, network) : null;
  const invalid = (id: string) => (errorField === id ? ({ "aria-invalid": true } as const) : {});
  const announce = done
    ? `Listed as number ${done.listingId}.`
    : needUrl
      ? "Host the encrypted file yourself, then paste its https URL."
      : error
        ? `The listing did not go through: ${error.message}`
        : warning ?? "";

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Announcer text={announce} />
      {programPk === null && !readOnly ? (
        <ErrorBox title="The enclave key is not published yet">
          <p>Listing opens once the market contract has published its program key. Reload in a few minutes.</p>
        </ErrorBox>
      ) : null}

      <section className={form.panel} aria-labelledby="s1">
        <h2 id="s1">1. Wallet and listing bond</h2>
        <WalletButton eoa={eoa} balance={balance} onConnect={setEoa} onBalance={setBalance} onReset={resetWallet} refreshKey={balanceKey} />
        <p className={form.hint}>
          The listing bond is {formatUsdc(bondUnits)} USDC, paid from your NEAR Intents balance with one signature. Your wallet shows the
          intent as JSON: check that the receiver is the market contract and the amount is {formatUsdc(bondUnits)} USDC.
        </p>
        {needTopUp && eoa ? <TopUp eoa={eoa} defaultAmount={suggestTopUp(bondUnits, balance ?? 0n)} onSuccess={() => setBalanceKey((k) => k + 1)} /> : null}
      </section>

      <section className={form.panel} aria-labelledby="s2">
        <h2 id="s2">2. Your file</h2>
        <div className={form.field}>
          <label htmlFor="file">CSV or JSONL file (up to {Math.floor(MAX_PLAINTEXT_BYTES / 1_000_000 * 10) / 10} MB)</label>
          <input id="file" type="file" accept=".csv,.jsonl" aria-describedby="file-hint" disabled={inProgress} onChange={(e) => void onFile(e.target.files?.[0])} {...invalid("file")} />
          <p id="file-hint" className={form.hint}>The file is read here and encrypted here. Row data is in no request: only the ciphertext is uploaded. Column names, the row count and the exact file size are public.</p>
        </div>
        {picked ? (
          <p className={styles.file}>
            {picked.name} · {picked.size} bytes · {columns.length} columns: <span className="mono">{columns.slice(0, 8).join(", ")}{columns.length > 8 ? ", …" : ""}</span>
          </p>
        ) : null}
      </section>

      <section className={form.panel} aria-labelledby="s3">
        <h2 id="s3">3. What buyers see</h2>
        {inProgress ? <p className={form.hint}>These fields are locked while a listing is in progress. Use Start over to change them.</p> : null}
        <fieldset disabled={inProgress} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className={form.grid2}>
            <div className={form.field}>
              <label htmlFor="prefix">Label</label>
              <select id="prefix" value={prefix} aria-describedby="prefix-hint" onChange={(e) => setPrefix(e.target.value as TitlePrefix)}>
                {prefixesFor(isTeam).map((p) => (
                  <option key={p} value={p}>{p === "" ? "none (external seller)" : p}</option>
                ))}
              </select>
              <p id="prefix-hint" className={form.hint}>Use [synthetic] only for made-up data. The [team-made] label is believed only from the Arrow team&apos;s own accounts.</p>
            </div>
            <div className={form.field}>
              <label htmlFor="title">Title (80 characters with the label)</label>
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} {...invalid("title")} />
            </div>
          </div>
          <div className={form.field}>
            <label htmlFor="desc">Public description (up to 280 characters)</label>
            <textarea id="desc" value={desc} onChange={(e) => setDesc(e.target.value.replace(/[\r\n]+/g, " "))} maxLength={280} aria-describedby="desc-hint" {...invalid("desc")} />
            <p id="desc-hint" className={form.hint}>Everyone can read this and the column names. Do not put data rows here.</p>
          </div>
          <div className={form.grid2}>
            <div className={form.field}>
              <label htmlFor="rows">Rows (claimed)</label>
              <input id="rows" inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value)} {...invalid("rows")} />
            </div>
            <div className={form.field}>
              <label htmlFor="price">Price to buy (USDC, at least {formatUsdc(BigInt(limits.minPrice))})</label>
              <input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} {...invalid("price")} />
            </div>
            <div className={form.field}>
              <label htmlFor="fee">Inspection fee (USDC, at least {formatUsdc(BigInt(limits.minEvalFee))})</label>
              <input id="fee" inputMode="decimal" value={evalFee} onChange={(e) => setEvalFee(e.target.value)} {...invalid("fee")} />
            </div>
            <div className={form.field}>
              <label htmlFor="max">Max inspections (1 to {maxEvalsCap})</label>
              <input id="max" inputMode="numeric" value={maxEvals} onChange={(e) => setMaxEvals(e.target.value)} {...invalid("max")} />
            </div>
            <div className={form.field}>
              <label htmlFor="mode">Answer</label>
              <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as "scored" | "verdict")}>
                <option value="scored">BUY/PASS with fit and novelty (5.67 bits per inspection on the output channel)</option>
                <option value="verdict">BUY/PASS only (1.59 bits per inspection on the output channel)</option>
              </select>
            </div>
            <div className={form.field}>
              <label htmlFor="payout">Payout address (optional)</label>
              <input id="payout" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x… or a NEAR account; default: this wallet" {...invalid("payout")} />
            </div>
          </div>
          <p className={form.hint}>
            The most the verdicts let out for this listing (run time and instruction count are public too): {budgetPreview(Number.isInteger(Number(maxEvals)) && Number(maxEvals) > 0 ? Number(maxEvals) : 0, mode)}.
          </p>
          <p className={form.hint} id="take-rate">{takeRate(price, evalFee, feeBps, bondUnits)}</p>
          <div className={form.field}>
            <label>
              <input type="checkbox" checked={selfHost} onChange={(e) => setSelfHost(e.target.checked)} /> I host the encrypted file myself (an https URL I paste)
            </label>
          </div>
        </fieldset>
      </section>

      <div className={form.actions}>
        <button
          type="button"
          className={form.primary}
          aria-disabled={!canStart}
          aria-describedby={canStart ? undefined : "sell-why"}
          onClick={() => {
            if (canStart) void start();
          }}
        >
          {busy ? "Working…" : "Encrypt, upload and list"}
        </button>
        {listMsg && !pending && !paidTx && !busy && !done ? (
          <>
            <button type="button" className={form.primary} onClick={() => void payAndFind(listMsg)}>Retry listing</button>
            <button type="button" onClick={startOver}>Start over</button>
          </>
        ) : null}
        {paidTx && !done && !busy ? <button type="button" className={form.primary} onClick={() => void findListing(paidTx).then(undefined, (e: unknown) => { mark(4, "failed"); fail(e); })}>Check listing</button> : null}
        {pending && !busy ? <button type="button" className={form.primary} onClick={() => void checkPay()}>Check payment</button> : null}
      </div>
      {!canStart && why.length > 0 && !done ? (
        <ul id="sell-why" className={form.hint}>
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {pending ? (
        <p className={form.band}>
          You signed the ${formatUsdc(BigInt(pending.amount))} bond payment and the relay could not say whether it went through. Do not pay again: use Check payment.
          {payNote ? <> {payNote}</> : null}
        </p>
      ) : payNote ? (
        <p className={form.hint}>{payNote}</p>
      ) : null}

      {steps.some((s) => s !== "todo") ? (
        <div className={styles.steps}>
          <StepList steps={STEPS.map((label, i): Step => ({ label, state: steps[i], detail: detail[i] }))} />
        </div>
      ) : null}

      {warning ? <p className={form.band}>{warning}</p> : null}

      {needUrl ? (
        <section className={form.panel} aria-labelledby="own">
          <h3 id="own">Host it yourself</h3>
          <p>
            <a href={needUrl.href} download={needUrl.name}>Download {needUrl.name}</a>, upload it unchanged to an https host, then paste the URL.
          </p>
          <div className={form.field}>
            <label htmlFor="url">https URL (up to 200 characters)</label>
            <input id="url" value={hostUrl} onChange={(e) => setHostUrl(e.target.value)} {...invalid("url")} />
          </div>
          <button type="button" className={form.primary} disabled={busy || hostUrl.trim() === ""} onClick={() => void useOwnUrl()}>Use this URL</button>
          <button type="button" onClick={startOver}>Start over</button>
        </section>
      ) : null}

      {error ? (
        <ErrorBox title="The listing did not go through" fallback={error.fallback}>
          <p>{error.message}</p>
        </ErrorBox>
      ) : null}

      {done && links ? (
        <section className={`${form.panel} ${styles.success}`} aria-labelledby="listed">
          <h2 id="listed" tabIndex={-1} ref={successHeading}>Listed as #{done.listingId}</h2>
          <p>
            <Link href={links.buy}>Open the listing</Link> · <a href={links.x402}>x402 link</a>{done.txHash ? <> · transaction <TxLink chain="near" network={network} hash={done.txHash} /></> : null}
          </p>
          <p className={form.hint}>The key and your file are cleared from this page. Reloading leaves nothing behind.</p>
          {copyOfBlob ? (
            <p>
              Keep a copy of the encrypted file: <a href={copyOfBlob.href} download={copyOfBlob.name}>download {copyOfBlob.name}</a>. The hosted copy is not kept for
              ever and the address stored on chain does not change by itself; with this file you can host it again.
            </p>
          ) : null}
          {done.txHash ? (
            <CopyEvidence
              run={{
                kind: "list", tx: done.txHash, chain: "near", listing_id: done.listingId,
                expect: `list op accepted, listing ${done.listingId} created with a ${formatUsdc(bondUnits)} USDC bond`,
                observed: `arrow_listed event for listing ${done.listingId} in ${done.txHash}`,
              }}
            />
          ) : null}
        </section>
      ) : null}
    </fieldset>
  );
}
