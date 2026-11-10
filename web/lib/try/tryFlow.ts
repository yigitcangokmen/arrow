// The free testnet run in the browser (DEC P-01..P-04): account, mint, list, eval, result, buy, decrypt.
// near-api-js is imported dynamically and only here (DEC L-06); only /try loads this module.
import { ArrowViews } from "@arrow/sdk/contract";
import { NETWORKS } from "@arrow/sdk/config";
import { decryptFile, encryptFile, keccakScalarHex, publicKeyHex, sha256Hex } from "@arrow/sdk/crypto";
import { decodeEvalResult, MAX_BLOB_BYTES, openRelease, prepareBuy } from "@arrow/sdk/flows";
import { view } from "@arrow/sdk/rpc";
import { Criteria, EvidenceFile } from "@arrow/sdk/schemas";
import type { State } from "@arrow/sdk/state";
import { buildEvalMsg, downloadCiphertext } from "../buy.ts";
import { CONTRACTS } from "../config.ts";
import { hashCheck, type HashCheck } from "../hashes.ts";
import { buildListMsg, fullTitle, inspectFile, type SellFields } from "../sell.ts";
import { findEvent, waitForRecord, type PollDeps } from "../settle.ts";

export type TryStep = "account" | "mint" | "list" | "eval" | "result" | "buy" | "decrypt";
export type TryCriteria = "demo" | "demo-buy" | "print-row-1";

export const TRY_STEPS: readonly TryStep[] = ["account", "mint", "list", "eval", "result", "buy", "decrypt"];

export interface StepInfo {
  state: "doing" | "done" | "failed" | "skipped";
  txHash?: string;
  detail?: string;
}

/** Which synthetic file each scene lists (fixtures/demo/README.md). print-row-1 reads whatever is listed. */
export const DATASETS: Record<TryCriteria, { file: string; title: string; keyColumn: string; scene: "L1" | "L2" }> = {
  demo: { file: "unlock-schedule-412.csv", title: "Q1 2027 token unlock schedule (412 rows)", keyColumn: "token_contract", scene: "L1" },
  "demo-buy": { file: "wallet-labels-1000.csv", title: "NEAR DeFi wallet labels (1,000 rows)", keyColumn: "account_id", scene: "L2" },
  "print-row-1": { file: "wallet-labels-1000.csv", title: "NEAR DeFi wallet labels (1,000 rows)", keyColumn: "account_id", scene: "L2" },
};

export const CAP_MESSAGE =
  "Daily testnet eval cap reached (10 per account, 400 per day). Run `npm run bench:offline` to re-score recorded runs without the network.";

const ACCOUNT_HELP = "Run `npm run try:testnet` instead, or get test NEAR at near-faucet.io.";

export class TryError extends Error {
  constructor(public readonly code: "ACCOUNT_FAILED" | "CAP" | "REFUNDED" | "NO_DEMO_LISTING" | "HASH_MISMATCH" | "OTHER", message: string, public readonly step?: TryStep) {
    super(message);
    this.name = "TryError";
  }
}

export interface TryConfig {
  programPk: string;
  /** The program hash the contract runs now. A recorded demo listing sealed to another program is refused (E13). */
  programWasmHash?: string | null;
  /** listing_bond in USDC base units. */
  bond: string;
}

export interface TryResult {
  accountId: string;
  listingId: number;
  usedDemoListing: boolean;
  evalId: number;
  state: State;
  purchaseId?: number;
  hashes?: HashCheck;
  hashInput?: { onChain: string; evalH: string | null; releaseH: string | null; downloaded: string };
  file?: { name: string; bytes: Uint8Array };
  elapsedMs: number;
}

// The few near-api-js members used here, so tests can pass a fake module.
interface NearAccountLike {
  callFunctionRaw(a: { contractId: string; methodName: string; args: object; gas?: bigint; deposit?: bigint; waitUntil?: string }): Promise<{ transaction: { hash: string } }>;
  getState(): Promise<unknown>;
}
export interface NearApi {
  KeyPair: { fromRandom(curve: "ed25519"): { toString(): string; getPublicKey(): { toString(): string } } };
  Account: new (id: string, provider: unknown, key: string) => NearAccountLike;
  JsonRpcProvider: new (o: { url: string }) => unknown;
  FailoverRpcProvider: new (providers: unknown[]) => unknown;
}

export interface TryDeps {
  loadNear(): Promise<NearApi>;
  fetch: typeof fetch;
  uploadBlob(pathname: string, bytes: Uint8Array, clientPayload: string): Promise<string>;
  views: Pick<ArrowViews, "listing" | "eval" | "purchase">;
  ftBalance(accountId: string): Promise<bigint>;
  findEvent: typeof findEvent;
  waitForRecord: typeof waitForRecord;
  storage: { get(): string | null; set(v: string): void };
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The testnet evidence file, for the pre-listed demo listing fallback. */
  evidence: unknown;
  /** The criteria files by name (generated/data.ts). */
  criteria: Record<string, unknown>;
}

const STORAGE_KEY = "arrow-try-key";
const GAS = 300_000_000_000_000n;
const FAUCET = "https://helper.nearprotocol.com/account";
const MINT_AMOUNT = "5000000";
const MIN_BALANCE = 1_000_000n;

export function realDeps(env: { evidence: unknown; criteria: Record<string, unknown> }): TryDeps {
  return {
    loadNear: () => import("near-api-js") as unknown as Promise<NearApi>,
    fetch: (...a) => fetch(...a),
    uploadBlob: async (pathname, bytes, clientPayload) => {
      const { upload } = await import("@vercel/blob/client");
      const res = await upload(pathname, new Blob([bytes as BlobPart]), {
        access: "public", handleUploadUrl: "/api/blob", contentType: "application/octet-stream", clientPayload, multipart: bytes.length > 4_000_000,
      });
      return res.url;
    },
    views: new ArrowViews("testnet", CONTRACTS.testnet),
    ftBalance: async (accountId) => BigInt(await view<string>("testnet", NETWORKS.testnet.usdcToken, "ft_balance_of", { account_id: accountId })),
    findEvent,
    waitForRecord,
    storage: {
      get: () => {
        try {
          return sessionStorage.getItem(STORAGE_KEY);
        } catch {
          return null;
        }
      },
      set: (v) => {
        try {
          sessionStorage.setItem(STORAGE_KEY, v);
        } catch {
          // a blocked storage only means the key is not reused on reload
        }
      },
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    ...env,
  };
}

const randomHex = (n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The recorded `list` run to use when a fresh upload is not possible: the newest one of the wanted scene (L1 unlock schedule,
 * L2 wallet labels) on the contract this page talks to. The e2e runs also record a listing whose host is gone on purpose
 * ("broken host"); it can only ever refund, so it is never picked.
 */
export function pickDemoListing(evidence: unknown, scene?: "L1" | "L2"): number | null {
  const parsed = EvidenceFile.safeParse(evidence);
  if (!parsed.success || parsed.data.contract !== CONTRACTS.testnet) return null;
  const lists = parsed.data.runs.filter((r) => r.kind === "list" && r.listing_id !== null && !/broken host/i.test(r.observed));
  const ofScene = scene ? lists.filter((r) => r.id.includes(`-list-${scene}-`)) : [];
  const pool = ofScene.length > 0 ? ofScene : lists;
  const last = pool[pool.length - 1];
  return last ? Number(last.listing_id) : null;
}

/** Contract panics and refunds in the words of DEC P-03; everything else keeps its own text. */
export function mapTryError(e: unknown): { message: string; code: TryError["code"] } {
  const text = e instanceof Error ? e.message : String(e);
  if (e instanceof TryError) return { message: e.message, code: e.code };
  if (/Arrow: E1[12]\b|daily .*cap|eval cap/i.test(text)) return { message: CAP_MESSAGE, code: "CAP" };
  return { message: text.slice(0, 240), code: "OTHER" };
}

export async function runTry(opts: {
  criteria: TryCriteria;
  config: TryConfig;
  onStep(step: TryStep, info: StepInfo): void;
  signal: AbortSignal;
  deps: TryDeps;
}): Promise<TryResult> {
  const { deps, signal, config } = opts;
  const started = deps.now();
  const poll: PollDeps = { signal };
  let current: TryStep = "account";
  const step = (s: TryStep, info: StepInfo) => {
    current = s;
    opts.onStep(s, info);
  };

  try {
    // 1. account
    step("account", { state: "doing" });
    const near = await deps.loadNear();
    // rpc.testnet.near.org answers 429 under load: walk the same URL list as the sdk's fetch client.
    const provider = new near.FailoverRpcProvider(NETWORKS.testnet.rpc.map((url) => new near.JsonRpcProvider({ url })));
    const { account, accountId } = await openAccount(near, provider, deps);
    step("account", { state: "done", detail: accountId });

    // 2. mint
    step("mint", { state: "doing" });
    if ((await deps.ftBalance(accountId)) < MIN_BALANCE) {
      const out = await account.callFunctionRaw({
        contractId: NETWORKS.testnet.usdcToken, methodName: "mint", args: { receiver_id: accountId, amount: MINT_AMOUNT }, gas: 30_000_000_000_000n, deposit: 0n, waitUntil: "INCLUDED_FINAL",
      });
      step("mint", { state: "done", txHash: out.transaction.hash, detail: "5 test USDC" });
    } else {
      step("mint", { state: "done", detail: "balance already enough" });
    }
    const pay = async (amount: string, msg: string) => {
      const out = await account.callFunctionRaw({
        contractId: NETWORKS.testnet.usdcToken, methodName: "ft_transfer_call", args: { receiver_id: CONTRACTS.testnet, amount, msg }, gas: GAS, deposit: 1n, waitUntil: "INCLUDED_FINAL",
      });
      return { txHash: out.transaction.hash, signerId: accountId };
    };

    // 3. list (or fall back to the pre-listed demo listing)
    step("list", { state: "doing" });
    const dataset = DATASETS[opts.criteria];
    let listingId: number;
    let usedDemoListing = false;
    const uploaded = await tryUpload(deps, dataset.file);
    if (uploaded) {
      const fields: SellFields = {
        prefix: "[synthetic]", title: dataset.title, publicDesc: "Synthetic demo data made by the Arrow team (free testnet run).", columns: uploaded.columns,
        rowsClaimed: uploaded.rows, price: "0.25", evalFee: "0.10", maxEvals: 10, mode: "scored",
      };
      const built = buildListMsg({ fields, plaintext: uploaded.plain, key: uploaded.key, nonce: uploaded.nonce, blobUrl: uploaded.url, programPk: config.programPk, seller: accountId });
      const paid = await pay(config.bond, built.msg);
      const ev = await deps.findEvent("testnet", paid, "arrow_listed", { idField: "listing_id", ...poll });
      listingId = Number(ev.listing_id);
      uploaded.plain.fill(0);
      step("list", { state: "done", txHash: paid.txHash, detail: `${fullTitle(fields)} as listing #${listingId}` });
    } else {
      // No fresh upload (Blob not configured, rate limited or offline): eval and buy work on any listing, so use a recorded one.
      const demo = pickDemoListing(deps.evidence, dataset.scene);
      if (demo === null) throw new TryError("NO_DEMO_LISTING", "Uploading a fresh listing is not available right now and there is no pre-listed demo listing. Run `npm run try:testnet` instead.", "list");
      listingId = demo;
      usedDemoListing = true;
      step("list", { state: "done", detail: `using pre-listed demo listing #${demo}` });
    }

    const listing = await deps.views.listing(listingId);
    if (!listing) throw new TryError("OTHER", `Listing #${listingId} does not exist on testnet.`, "list");
    if (usedDemoListing && config.programWasmHash && (listing as { program_hash_at_list?: string }).program_hash_at_list !== config.programWasmHash) {
      throw new TryError("NO_DEMO_LISTING", `The recorded demo listing #${listingId} was sealed to an older enclave program and can no longer be inspected. Run \`npm run try:testnet\` instead.`, "list");
    }

    // 4. eval
    step("eval", { state: "doing" });
    const rawCriteria = deps.criteria[opts.criteria];
    if (!rawCriteria) throw new TryError("OTHER", `The criteria file ${opts.criteria}.json is missing from this build.`, "eval");
    const scalar = keccakScalarHex(crypto.getRandomValues(new Uint8Array(32)));
    const buyerPk = publicKeyHex(scalar);
    const evalMsg = buildEvalMsg({ listingId, criteria: Criteria.parse(rawCriteria), buyerPk, programPk: config.programPk });
    const evalPaid = await pay(listing.eval_fee, evalMsg);
    const evalEvent = await deps.findEvent("testnet", evalPaid, "arrow_eval", { phase: "accepted", idField: "eval_id", ...poll });
    const evalId = Number(evalEvent.eval_id);
    step("eval", { state: "done", txHash: evalPaid.txHash, detail: `eval #${evalId}` });

    // 5. result
    step("result", { state: "doing" });
    const evalRec = await deps.waitForRecord("The inspection", () => deps.views.eval(evalId), { signal, everyMs: 4_000, timeoutMs: 180_000, sleep: deps.sleep, now: deps.now });
    if (evalRec.status === "refunded") {
      throw new TryError("REFUNDED", `The inspection was refunded${evalRec.refund_reason ? ` (${evalRec.refund_reason})` : ""}. If NEAR AI credit ran out, run \`npm run bench:offline\` to re-score recorded runs without the network.`, "result");
    }
    if (!evalRec.sealed_result) throw new TryError("OTHER", "The contract marked the inspection done without a result.", "result");
    const state = decodeEvalResult(evalRec.sealed_result, scalar, listing.mode);
    step("result", { state: "done", detail: `${state.verdict}${state.fit ? ` · fit ${state.fit} · novelty ${state.novelty}` : ""}` });

    const base = { accountId, listingId, usedDemoListing, evalId, state, elapsedMs: 0 };
    if (opts.criteria === "print-row-1") {
      step("buy", { state: "skipped", detail: "this scene only shows the verdict" });
      step("decrypt", { state: "skipped" });
      return { ...base, elapsedMs: deps.now() - started };
    }

    // 6. buy
    step("buy", { state: "doing" });
    const buyPaid = await pay(listing.price, prepareBuy({ listingId, buyerPk }));
    const buyEvent = await deps.findEvent("testnet", buyPaid, "arrow_purchase", { phase: "accepted", idField: "purchase_id", ...poll });
    const purchaseId = Number(buyEvent.purchase_id);
    const buyRec = await deps.waitForRecord("The purchase", () => deps.views.purchase(purchaseId), { signal, everyMs: 4_000, timeoutMs: 180_000, sleep: deps.sleep, now: deps.now });
    if (buyRec.status === "refunded") throw new TryError("REFUNDED", `The purchase was refunded${buyRec.refund_reason ? ` (${buyRec.refund_reason})` : ""}.`, "buy");
    if (!buyRec.sealed_k_buyer) throw new TryError("OTHER", "The contract marked the purchase done without a key.", "buy");
    const key = openRelease(buyRec.sealed_k_buyer, scalar);
    step("buy", { state: "done", txHash: buyPaid.txHash, detail: `purchase #${purchaseId}` });

    // 7. decrypt
    step("decrypt", { state: "doing" });
    // The browser reads the host's body with the SDK's capped reader: a host that never stops cannot make the tab buffer without end.
    const got = await downloadCiphertext(listing.blob_url, listing.blob_sha256, deps.fetch);
    if (got.kind === "too-large") throw new TryError("OTHER", "The encrypted file is larger than the 5 MB limit.", "decrypt");
    if (got.kind === "manual") throw new TryError("OTHER", "The encrypted file could not be downloaded from its host.", "decrypt");
    const hashInput = { onChain: listing.blob_sha256, evalH: evalRec.h ?? null, releaseH: buyRec.h ?? null, downloaded: got.kind === "ok" ? listing.blob_sha256 : got.actual };
    const hashes = hashCheck(hashInput);
    if (!hashes.match || got.kind !== "ok") {
      key.fill(0);
      throw new TryError("HASH_MISMATCH", `sha256 mismatch: ${hashes.mismatched.join(", ") || "a hash is missing"}. The file was not decrypted.`, "decrypt");
    }
    const bytes = got.bytes;
    const plain = decryptFile(bytes, key);
    key.fill(0);
    step("decrypt", { state: "done", detail: "sha256 match ✔" });
    return { ...base, purchaseId, hashes, hashInput, file: { name: `arrow-listing-${listingId}.${new TextDecoder().decode(plain.subarray(0, 8)).trimStart().startsWith("{") ? "jsonl" : "csv"}`, bytes: plain }, elapsedMs: deps.now() - started };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    const mapped = mapTryError(e);
    const failedStep = e instanceof TryError && e.step ? e.step : current;
    opts.onStep(failedStep, { state: "failed", detail: mapped.message });
    throw e instanceof TryError ? e : new TryError(mapped.code, mapped.message, failedStep);
  }
}

interface Uploaded {
  plain: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
  url: string;
  columns: string[];
  rows: number;
}

/** Encrypts the demo file and uploads the ciphertext; null when the demo file or the upload is not available. */
async function tryUpload(deps: TryDeps, file: string): Promise<Uploaded | null> {
  try {
    const res = await deps.fetch(`/demo/${file}`);
    if (!res.ok) return null;
    const plain = new Uint8Array(await res.arrayBuffer());
    const info = inspectFile("csv", new TextDecoder().decode(plain));
    const enc = encryptFile(plain);
    const url = await deps.uploadBlob(`blobs/${enc.blobSha256}.bin`, enc.blob, JSON.stringify({ sha256: enc.blobSha256, size: enc.blob.length }));
    return { plain, key: enc.key, nonce: enc.blob.slice(0, 24), url, columns: info.columns, rows: info.rows };
  } catch {
    return null;
  }
}

async function openAccount(near: NearApi, provider: unknown, deps: TryDeps): Promise<{ account: NearAccountLike; accountId: string }> {
  const stored = deps.storage.get();
  if (stored) {
    try {
      const { accountId, secret } = JSON.parse(stored) as { accountId: string; secret: string };
      const account = new near.Account(accountId, provider, secret);
      await account.getState();
      return { account, accountId };
    } catch {
      // the stored account is gone or unreadable: make a new one
    }
  }
  const kp = near.KeyPair.fromRandom("ed25519");
  const secret = kp.toString();
  const publicKey = kp.getPublicKey().toString();

  let accountId: string | null = null;
  try {
    const wanted = `try${randomHex(5)}.testnet`;
    const res = await deps.fetch(FAUCET, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: wanted, newAccountPublicKey: publicKey }) });
    if (res.ok) accountId = wanted;
  } catch {
    // the faucet is flaky and may be blocked: the sponsor route is the second way
  }
  if (!accountId) {
    try {
      const res = await deps.fetch("/api/testnet-sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey }) });
      const body = (await res.json().catch(() => null)) as { accountId?: string; error?: string; fallback?: string } | null;
      if (res.ok && body?.accountId) accountId = body.accountId;
      else if (body?.error) throw new TryError("ACCOUNT_FAILED", `Account creation failed: ${body.error}${body.fallback ? ` ${body.fallback}.` : ""} ${ACCOUNT_HELP}`, "account");
    } catch (e) {
      if (e instanceof TryError) throw e;
    }
  }
  if (!accountId) throw new TryError("ACCOUNT_FAILED", `Account creation failed: the testnet faucet and the sponsor are both unavailable. ${ACCOUNT_HELP}`, "account");

  const account = new near.Account(accountId, provider, secret);
  for (let i = 0; ; i++) {
    try {
      await account.getState();
      break;
    } catch {
      if (i >= 5) throw new TryError("ACCOUNT_FAILED", `The new account ${accountId} did not appear on testnet in time.`, "account");
      await deps.sleep(1_500);
    }
  }
  deps.storage.set(JSON.stringify({ accountId, secret }));
  return { account, accountId };
}

/** The banner sentence under /try's title. "Same hash as mainnet" is said only when both hashes were read and are equal. */
export function programHashBand(testnetHash: string | null, mainnetHash: string | null): string {
  if (!testnetHash) return "Free testnet run. The testnet program hash could not be read.";
  const short = testnetHash.slice(0, 8);
  if (mainnetHash && mainnetHash === testnetHash) return `Free testnet run. Same wasm hash as mainnet (${short}).`;
  if (mainnetHash) return `Free testnet run. Testnet program hash ${short}; mainnet runs ${mainnetHash.slice(0, 8)}.`;
  return `Free testnet run. Testnet program hash ${short}; the mainnet hash is not published yet.`;
}
