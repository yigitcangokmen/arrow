// The CLI and MCP command bodies (WS4-T11). They return plain results; cli.ts formats them and mcp.ts serialises them.
// Nothing here prints criteria text, list contents, keys or plaintext.
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  BlobHashMismatch, Criteria, decodeEvalResult, decryptFile, fetchAndCheckBlob, formatBits, formatUsdc,
  type Listing, type Mode, type Network, openRelease, parseUsdc, prepareBuy, prepareEval, prepareList, resolveNetwork, sha256Hex, signature, signatureHex,
} from "@arrow/sdk";
import { isTeamAccount } from "@arrow/sdk/team";
import { evidenceDir, type EvidenceRunInput } from "../../scripts/src/lib/evidence.ts";
import { readTable } from "./data.ts";
import { type Actor, type ActorFlags, configDir, type Role } from "./keys.ts";
import { findEventId, pollRecord, recoveryHint, type WaitDeps } from "./settle.ts";
import type { PaidTx, Transport } from "./transport.ts";
import type { ViewsLike } from "./views.ts";

export const EXIT = { ok: 0, error: 1, usage: 2, pending: 3, refunded: 4, needsConfirm: 5, budgetExhausted: 6 } as const;

export class CliError extends Error {
  constructor(message: string, public readonly exit: number = EXIT.error) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * A failure after the money went out (X12-5): the purchase is paid, so callers report its ids and the recovery command
 * instead of an error that invites paying again.
 */
export class PaidButUnfinished extends CliError {
  constructor(message: string, public readonly txUrl: string, public readonly purchaseId: number) {
    super(`${message} · paid, purchase #${purchaseId}, tx ${txUrl}: ${recoveryHint("purchase", purchaseId)}`);
    this.name = "PaidButUnfinished";
  }
}

/** The contract refused the payment (an Exx panic in the transfer callback), so the token's resolve step returned it all (X12F-5). */
export class PaymentRefused extends CliError {
  constructor(what: string, rejection: string | undefined, network: Network) {
    super(`the market refused the ${what}: ${rejection} · the full amount went back to your ${network === "mainnet" ? "NEAR Intents" : "arrow-usd"} balance`);
    this.name = "PaymentRefused";
  }
}

export interface Ctx {
  network: Network;
  /** The market contract id; the CLI's file key is bound to it (X12-1). Default: the network's configured contract. */
  contract?: string;
  views: ViewsLike;
  transport: Transport;
  actor(role: Role, flags?: ActorFlags): Actor;
  /** Spend plan + confirmation; only mainnet asks (DEC D4-19). */
  confirm(plan: string[]): Promise<void>;
  evidence(run: Omit<EvidenceRunInput, "commit" | "timestamp_utc" | "script">): void;
  wait?: Partial<WaitDeps>;
  fetchImpl?: typeof fetch;
  progress?(line: string): void;
}

const waitDeps = (ctx: Ctx): WaitDeps => ({ network: ctx.network, views: ctx.views, ...ctx.wait });
const num = (v: unknown) => Number(v);
const link = (tx: PaidTx) => tx.url;

async function requireListing(ctx: Ctx, id: number): Promise<Listing> {
  const l = await ctx.views.listing(id);
  if (!l) throw new CliError(`listing #${id} not found on ${ctx.network}`);
  return l;
}

/** Team-controlled accounts from evidence/team-accounts.json (NEAR ids and EVM addresses); empty when the file is missing. */
function teamAccounts(): string[] {
  const f = resolve(evidenceDir(), "team-accounts.json");
  if (!existsSync(f)) return [];
  const doc = JSON.parse(readFileSync(f, "utf8")) as { near?: string[]; evm?: { address: string }[] };
  return [...(doc.near ?? []), ...(doc.evm ?? []).map((e) => e.address)];
}

/**
 * CRY-5: the demo key's scalar is public, so whatever is sealed to it (a verdict, a purchase's K) is readable by anyone.
 * On mainnet it may only be used on the team's own listings; a third-party seller's data must never be opened to everyone.
 */
function assertDemoKeyAllowed(ctx: Ctx, listing: Listing, demoKey: boolean | undefined): void {
  if (!demoKey || ctx.network !== "mainnet" || isTeamAccount(listing.seller, teamAccounts())) return;
  throw new CliError(
    `--demo-key is refused on listing #${listing.id}: its key is public, so anyone could decrypt what you pay for from seller ${listing.seller}. On mainnet it works only on the team's demo listings; drop --demo-key to use your own viewing key.`,
    EXIT.usage,
  );
}

function record(ctx: Ctx, run: Parameters<Ctx["evidence"]>[0]) {
  try {
    ctx.evidence(run);
  } catch (e) {
    ctx.progress?.(`note: evidence not written (${(e as Error).message})`);
  }
}

// ---------------------------------------------------------------- eval

export interface EvalResult {
  listing_id: number;
  eval_id: number;
  status: "done" | "refunded";
  verdict?: "BUY" | "PASS";
  fit?: number;
  /** undefined when the buyer sent no list: novelty is then fixed and its gate skipped (DEC I-16) */
  novelty?: number;
  bits_out: string;
  budget_left_bits: string;
  budget_total_bits: string;
  refund_reason?: string;
  tx: string;
  tx_url: string;
  /** set by `result`, which has no payment tx */
  network?: Network;
}

/** criteria JSON (an object, or a path to a file) plus the optional key list -> sealed-ready Criteria. */
export function loadCriteria(input: string | Record<string, unknown>, list?: { path: string; keyColumn?: string }): Criteria {
  const raw = typeof input === "string" ? JSON.parse(readFileSync(input, "utf8")) : { ...input };
  if (list) {
    const column = list.keyColumn ?? raw.key_column;
    if (!column) throw new CliError("--my-list needs --key-column (or key_column in the criteria file)", EXIT.usage);
    raw.minhash = signatureHex(signature(readTable(list.path).column(column)));
    raw.key_column ??= column;
  }
  const parsed = Criteria.safeParse(raw);
  if (!parsed.success) throw new CliError(`criteria invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "criteria"}: ${i.message}`).join("; ")}`, EXIT.usage);
  return parsed.data;
}

export async function evalCommand(
  ctx: Ctx,
  a: { listingId: number; criteria: string | Record<string, unknown>; myList?: string; keyColumn?: string; demoKey?: boolean; account?: string },
): Promise<EvalResult> {
  const listing = await requireListing(ctx, a.listingId);
  assertDemoKeyAllowed(ctx, listing, a.demoKey);
  const before = await ctx.views.leakBudget(a.listingId);
  if (listing.evals_used >= listing.max_evals || (before && before.left_milli < before.bits_per_eval_milli)) {
    throw new CliError("leak budget exhausted, buy-only listing", EXIT.budgetExhausted);
  }
  const criteria = loadCriteria(a.criteria, a.myList ? { path: a.myList, keyColumn: a.keyColumn } : undefined);
  const programPk = await ctx.views.programPubkey();
  if (!programPk) throw new CliError("the market has no program key yet (init_program_key not run)");

  const buyer = ctx.actor("buyer", { demoKey: a.demoKey, account: a.account });
  const viewing = await buyer.viewingKey();
  const msg = prepareEval({ listingId: a.listingId, criteria, buyerPk: viewing.buyerPk, programPk });
  const fee = BigInt(listing.eval_fee);
  await ctx.confirm([`pay ${formatUsdc(fee)} USDC eval fee for listing #${a.listingId} from ${buyer.id}`, `network: ${ctx.network}`, "the criteria and your list never leave this machine unencrypted"]);

  const tx = await ctx.transport.pay({ actor: buyer, amount: fee, msg });
  ctx.progress?.(`paid ${formatUsdc(fee)} USDC · tx ${link(tx)} · waiting for the enclave (60-118 s)`);
  const { id, rejection } = await findEventId(waitDeps(ctx), tx, "arrow_eval", "eval_id", "accepted");
  if (id === undefined) throw new PaymentRefused("payment", rejection, ctx.network);
  const ev = await pollRecord(waitDeps(ctx), "eval", id, () => ctx.views.eval(id));
  const after = await ctx.views.leakBudget(a.listingId);

  const res: EvalResult = {
    listing_id: a.listingId,
    eval_id: id,
    status: ev.status as "done" | "refunded",
    bits_out: formatBits(listing.bits_per_eval_milli),
    budget_left_bits: formatBits(after?.left_milli ?? 0),
    budget_total_bits: formatBits(after?.budget_milli ?? 0),
    tx: tx.txHash,
    tx_url: tx.url,
  };
  if (ev.status === "refunded" || !ev.sealed_result) {
    res.status = "refunded";
    res.refund_reason = ev.refund_reason ?? "unknown";
    record(ctx, { id: `cli-eval-${ctx.network}-${id}`, kind: "refund", tx: tx.txHash, chain: "near", block_height: null, listing_id: a.listingId, eval_id: id, purchase_id: null, oneclick_deposit: null, expect: "eval fee refunded on failure", observed: `refunded (${res.refund_reason})` });
    return res;
  }
  const state = decodeEvalResult(ev.sealed_result, viewing.scalarHex, listing.mode as Mode);
  res.verdict = state.verdict;
  res.fit = state.fit;
  res.novelty = criteria.minhash ? state.novelty : undefined;
  record(ctx, { id: `cli-eval-${ctx.network}-${id}`, kind: "eval", tx: tx.txHash, chain: "near", block_height: null, listing_id: a.listingId, eval_id: id, purchase_id: null, oneclick_deposit: null, expect: "capped verdict returned", observed: formatEval(res) });
  return res;
}

export function formatEval(r: EvalResult): string {
  if (r.status === "refunded") return `REFUNDED (${r.refund_reason}) · eval fee less the treasury share returned to your ${refundTarget(r.tx_url || (r.network ?? ""))} · eval #${r.eval_id}${r.tx_url ? ` · tx ${r.tx_url}` : ""}`;
  const parts: string[] = [r.verdict!];
  if (r.fit !== undefined) parts.push(`fit ${r.fit}/5`, `novelty ${r.novelty !== undefined ? `${r.novelty}/5` : "n/a"}`);
  parts.push(`out ${r.bits_out} bits`, `budget left ${r.budget_left_bits}/${r.budget_total_bits} bits`, `eval #${r.eval_id}`);
  if (r.tx_url) parts.push(`tx ${r.tx_url}`);
  return parts.join(" · ");
}

/** DEC K-05: money comes back to the Intents balance on mainnet, to the token balance on testnet; never "your wallet". */
export const refundTarget = (txUrl: string) => (txUrl.includes("testnet") ? "arrow-usd balance" : "NEAR Intents balance");

/** QA-07: reads an eval that settled after `eval` stopped waiting, and decodes the verdict when it was sealed to this key. */
export async function resultCommand(ctx: Ctx, a: { evalId: number; demoKey?: boolean; account?: string }): Promise<EvalResult | { eval_id: number; listing_id: number; status: "pending" }> {
  const ev = await ctx.views.eval(a.evalId);
  if (!ev) throw new CliError(`eval #${a.evalId} not found on ${ctx.network}`);
  const listing = await requireListing(ctx, num(ev.listing_id));
  if (ev.status === "pending") return { eval_id: a.evalId, listing_id: num(ev.listing_id), status: "pending" };
  const after = await ctx.views.leakBudget(num(ev.listing_id));
  const res: EvalResult = {
    listing_id: num(ev.listing_id),
    eval_id: a.evalId,
    status: ev.status as "done" | "refunded",
    bits_out: formatBits(listing.bits_per_eval_milli),
    budget_left_bits: formatBits(after?.left_milli ?? 0),
    budget_total_bits: formatBits(after?.budget_milli ?? 0),
    tx: "",
    tx_url: "",
    network: ctx.network,
  };
  if (ev.status === "refunded" || !ev.sealed_result) {
    res.status = "refunded";
    res.refund_reason = ev.refund_reason ?? "unknown";
    return res;
  }
  const viewing = await ctx.actor("buyer", { demoKey: a.demoKey, account: a.account }).viewingKey();
  if (ev.buyer_pk !== viewing.buyerPk) throw new CliError("this eval was paid with a different viewing key (try --demo-key, or the account that paid it)");
  const state = decodeEvalResult(ev.sealed_result, viewing.scalarHex, listing.mode as Mode);
  res.verdict = state.verdict;
  res.fit = state.fit;
  res.novelty = state.novelty; // the record does not say whether a list was sent; without one novelty is the fixed value
  return res;
}

// ---------------------------------------------------------------- buy + decrypt

export interface DecryptResult {
  purchase_id: number;
  listing_id: number;
  checks: { label: string; ok: boolean; value?: string }[];
  ok: boolean;
  out?: string;
  bytes?: number;
}

export interface BuyResult {
  listing_id: number;
  purchase_id: number;
  status: "done" | "refunded";
  refund_reason?: string;
  tx: string;
  tx_url: string;
  decrypt?: DecryptResult;
}

export async function buyCommand(ctx: Ctx, a: { listingId: number; demoKey?: boolean; out?: string; outDir?: string; exclusive?: boolean; account?: string; recordDemo?: boolean }): Promise<BuyResult> {
  const listing = await requireListing(ctx, a.listingId);
  assertDemoKeyAllowed(ctx, listing, a.demoKey);
  const programPk = await ctx.views.programPubkey();
  if (!programPk) throw new CliError("the market has no program key yet (init_program_key not run)");
  const buyer = ctx.actor("buyer", { demoKey: a.demoKey, account: a.account });
  const viewing = await buyer.viewingKey();
  // X12-T01: download and hash the file before paying; a seller who serves it once (to the enclave) cannot take the price.
  let blob: Uint8Array;
  try {
    blob = await fetchAndCheckBlob(listing.blob_url, listing.blob_sha256, ctx.fetchImpl);
  } catch (e) {
    throw new CliError(`the listing's file cannot be read right now, so nothing was paid: ${(e as Error).message}`);
  }
  const price = BigInt(listing.price);
  await ctx.confirm([`pay ${formatUsdc(price)} USDC for listing #${a.listingId} from ${buyer.id}`, `network: ${ctx.network}`]);

  const tx = await ctx.transport.pay({ actor: buyer, amount: price, msg: prepareBuy({ listingId: a.listingId, buyerPk: viewing.buyerPk }) });
  ctx.progress?.(`paid ${formatUsdc(price)} USDC · tx ${link(tx)} · waiting for the key release`);
  const { id, rejection } = await findEventId(waitDeps(ctx), tx, "arrow_purchase", "purchase_id", "accepted");
  if (id === undefined) throw new PaymentRefused("payment", rejection, ctx.network);
  const p = await pollRecord(waitDeps(ctx), "purchase", id, () => ctx.views.purchase(id));
  const res: BuyResult = { listing_id: a.listingId, purchase_id: id, status: p.status as "done" | "refunded", tx: tx.txHash, tx_url: tx.url };
  const demo = a.recordDemo && a.demoKey ? " (demo:true)" : "";
  if (p.status === "refunded") {
    res.refund_reason = p.refund_reason ?? "unknown";
    record(ctx, { id: `cli-buy-${ctx.network}-${id}`, kind: "refund", tx: tx.txHash, chain: "near", block_height: null, listing_id: a.listingId, eval_id: null, purchase_id: id, oneclick_deposit: null, expect: "price refunded on failure", observed: `refunded (${res.refund_reason})` });
    return res;
  }
  try {
    res.decrypt = await decryptCommand(ctx, { purchaseId: id, demoKey: a.demoKey, out: a.out, outDir: a.outDir, exclusive: a.exclusive, account: a.account, blob });
  } catch (e) {
    throw new PaidButUnfinished((e as Error).message, tx.url, id);
  }
  record(ctx, { id: `cli-buy-${ctx.network}-${id}`, kind: "buy", tx: tx.txHash, chain: "near", block_height: null, listing_id: a.listingId, eval_id: null, purchase_id: id, oneclick_deposit: null, expect: "key released, hashes equal", observed: `${res.decrypt.ok ? "hashes equal, decrypted" : "HASH CHECK FAILED"}${demo}` });
  return res;
}

/** `exclusive`: never overwrite (flag "wx"; also refuses a symlink at `out`). The MCP buy tool sets it; the CLI keeps overwriting what the user named. */
export async function decryptCommand(ctx: Ctx, a: { purchaseId: number; demoKey?: boolean; out?: string; outDir?: string; exclusive?: boolean; account?: string; blob?: Uint8Array }): Promise<DecryptResult> {
  const p = await ctx.views.purchase(a.purchaseId);
  if (!p) throw new CliError(`purchase #${a.purchaseId} not found on ${ctx.network}`);
  if (p.status !== "done" || !p.sealed_k_buyer) throw new CliError(`purchase #${a.purchaseId} is ${p.status}${p.refund_reason ? ` (${p.refund_reason})` : ""}: nothing to decrypt`);
  const listing = await requireListing(ctx, num(p.listing_id));
  const viewing = await ctx.actor("buyer", { demoKey: a.demoKey, account: a.account }).viewingKey();
  if (p.buyer_pk !== viewing.buyerPk) throw new CliError("this purchase was made with a different viewing key (try --demo-key, or the account that bought it)");

  const k = openRelease(p.sealed_k_buyer, viewing.scalarHex);
  const blob = a.blob && sha256Hex(a.blob) === listing.blob_sha256 ? a.blob : await fetchAndCheckBlob(listing.blob_url, listing.blob_sha256, ctx.fetchImpl);
  const plain = decryptFile(blob, k);
  k.fill(0);

  const downloaded = sha256Hex(blob);
  const checks: DecryptResult["checks"] = [
    { label: "listing.blob_sha256 == release.h", ok: p.h === listing.blob_sha256, value: listing.blob_sha256 },
    { label: "release.h == sha256(downloaded)", ok: p.h === downloaded, value: downloaded },
  ];
  const evals = await ctx.views.evalsByListing(num(p.listing_id)).catch(() => []);
  const mine = evals.filter((e) => e.buyer_pk === p.buyer_pk && e.status === "done" && e.h).at(-1);
  checks.push(mine ? { label: `eval.h == listing.blob_sha256 (eval #${mine.id})`, ok: mine.h === listing.blob_sha256, value: mine.h ?? undefined } : { label: "eval.h == listing.blob_sha256 (no completed eval by this key)", ok: true });

  const ok = checks.every((c) => c.ok);
  // X12-7: by default into the per-user config folder (0700), never the working directory (the repo root is not ignored).
  const out = resolve(a.out ?? join(a.outDir ?? join(configDir(), "purchases"), `arrow-listing-${listing.id}-purchase-${p.id}.dat`));
  if (ok) {
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, plain, { mode: 0o600, ...(a.exclusive && { flag: "wx" }) });
    chmodSync(out, 0o600); // an existing file keeps its old mode on overwrite
  }
  return { purchase_id: num(p.id), listing_id: num(p.listing_id), checks, ok, ...(ok && { out, bytes: plain.length }) };
}

export function formatDecrypt(d: DecryptResult): string[] {
  const lines = d.checks.map((c) => `${c.ok ? "✔" : "✘"} ${c.label}${c.value ? `   ${c.value}` : ""}`);
  lines.push(d.ok ? `wrote ${d.out} (${d.bytes} bytes)` : "hash check failed: nothing was written");
  return lines;
}

// ---------------------------------------------------------------- list

export interface ListResult {
  dry_run: boolean;
  blob_sha256: string;
  blob_path: string;
  listing_id?: number;
  tx?: string;
  tx_url?: string;
  msg_masked: Record<string, unknown>;
}

/**
 * Reproducible K and nonce from a local secret, so the ciphertext uploaded between two runs is the one that gets listed.
 * The label binds network, contract and program key: the same file listed on testnet and on mainnet (or on two contracts, or
 * under two programs) gets two unrelated keys, so a cheap testnet purchase never yields the K of a mainnet listing (X12-1).
 */
function sellerSecret(): Buffer {
  const f = resolve(configDir(), "seller-secret");
  if (existsSync(f)) return Buffer.from(readFileSync(f, "utf8").trim(), "hex");
  const s = randomBytes(32);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, s.toString("hex") + "\n", { mode: 0o600 });
  chmodSync(f, 0o600);
  return s;
}
const derive = (market: string, label: string, plaintextSha: string, n: number) =>
  new Uint8Array(createHmac("sha256", sellerSecret()).update(`arrow:list:v2:${market}:${label}:${plaintextSha}`).digest().subarray(0, n));

export async function listCommand(
  ctx: Ctx,
  a: { file: string; title: string; desc: string; price: string; evalFee: string; maxEvals?: number; mode?: Mode; blobUrl?: string; outBlob?: string; dryRun?: boolean; account?: string },
): Promise<ListResult> {
  const table = readTable(a.file);
  const plaintext = new Uint8Array(readFileSync(a.file));
  const programPk = await ctx.views.programPubkey();
  if (!programPk) throw new CliError("the market has no program key yet (init_program_key not run)");
  if (!a.dryRun && !a.blobUrl) throw new CliError("--blob-url is required: upload the file written by --dry-run, then rerun with its URL", EXIT.usage);

  const plainSha = sha256Hex(plaintext);
  const market = `${ctx.network}:${ctx.contract ?? resolveNetwork(ctx.network, process.env).contract}:${programPk}`;
  const key = new Uint8Array(32);
  key.set(derive(market, "k", plainSha, 32));
  // sealed_k is bound to the account that pays the bond (the contract's sender_id), so resolve it first.
  const seller = ctx.actor("seller", { account: a.account });
  let prepared;
  try {
    prepared = prepareList({
      plaintext, title: a.title, publicDesc: a.desc, columns: table.columns, rowsClaimed: table.rows,
      blobUrl: a.blobUrl ?? `https://example.invalid/${"0".repeat(64)}.bin`,
      price: parseUsdc(a.price).toString(), evalFee: parseUsdc(a.evalFee).toString(), maxEvals: a.maxEvals, mode: a.mode ?? "scored", programPk,
      seller: seller.id, key, nonce: derive(market, "nonce", plainSha, 24),
    });
  } catch (e) {
    throw new CliError(`cannot build the listing: ${(e as Error).message}`, EXIT.usage);
  }
  const blobPath = resolve(a.outBlob ?? `out/${prepared.blobSha256}.bin`);
  mkdirSync(dirname(blobPath), { recursive: true });
  writeFileSync(blobPath, prepared.blob);

  const masked = JSON.parse(prepared.msg) as Record<string, unknown>;
  masked.sealed_k = "****";
  const base = { blob_sha256: prepared.blobSha256, blob_path: blobPath, msg_masked: masked };
  if (a.dryRun) return { dry_run: true, ...base };

  // The hosted copy must be byte-identical to what we sealed K for; otherwise every eval would stop with not_ok (X12F-3).
  try {
    await fetchAndCheckBlob(a.blobUrl!, prepared.blobSha256, ctx.fetchImpl);
  } catch (e) {
    if (e instanceof BlobHashMismatch) throw new CliError(`the file at --blob-url is not the ciphertext of this input (sha256 ${e.actual}, expected ${e.expected}): upload ${blobPath}`);
    throw new CliError(`cannot read --blob-url: ${(e as Error).message}`);
  }
  const cfg = await ctx.views.config();
  const bond = BigInt(String((cfg.config as { listing_bond?: string }).listing_bond ?? "100000"));
  await ctx.confirm([`list "${a.title}" from ${seller.id}`, `pay the ${formatUsdc(bond)} USDC listing bond`, `network: ${ctx.network}`]);

  const tx = await ctx.transport.pay({ actor: seller, amount: bond, msg: prepared.msg });
  const { id, rejection } = await findEventId(waitDeps(ctx), tx, "arrow_listed", "listing_id");
  if (id === undefined) throw new PaymentRefused("listing", rejection, ctx.network);
  record(ctx, { id: `cli-list-${ctx.network}-${id}`, kind: "list", tx: tx.txHash, chain: "near", block_height: null, listing_id: id, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "listing created", observed: `listed #${id}` });
  return { dry_run: false, ...base, listing_id: id, tx: tx.txHash, tx_url: tx.url };
}

// ---------------------------------------------------------------- status

export async function statusCommand(ctx: Ctx, a: { listing?: number; eval?: number; purchase?: number; from?: number; limit?: number }): Promise<unknown> {
  if (a.eval !== undefined) {
    const e = await ctx.views.eval(a.eval);
    if (!e) throw new CliError(`eval #${a.eval} not found`);
    return { eval_id: num(e.id), listing_id: num(e.listing_id), status: e.status, refund_reason: e.refund_reason ?? null, h: e.h ?? null };
  }
  if (a.purchase !== undefined) {
    const p = await ctx.views.purchase(a.purchase);
    if (!p) throw new CliError(`purchase #${a.purchase} not found`);
    return { purchase_id: num(p.id), listing_id: num(p.listing_id), status: p.status, refund_reason: p.refund_reason ?? null, h: p.h ?? null };
  }
  if (a.listing !== undefined) return listingSummary(ctx, await requireListing(ctx, a.listing));
  // QA-06: without --from/--limit every listing; get_listings returns at most 50 and its from_index is a listing id.
  const ls = a.from === undefined && a.limit === undefined ? await allListings(ctx) : await ctx.views.listings({ from: a.from, limit: a.limit });
  return Promise.all(ls.map((l) => listingSummary(ctx, l)));
}

async function allListings(ctx: Ctx): Promise<Listing[]> {
  const all: Listing[] = [];
  for (let from = 1; ; ) {
    const page = await ctx.views.listings({ from, limit: 50 });
    all.push(...page);
    if (page.length < 50) return all;
    from = num(page[page.length - 1].id) + 1;
  }
}

export async function listingSummary(ctx: Ctx, l: Listing) {
  const b = await ctx.views.leakBudget(num(l.id)).catch(() => null);
  const left = b ? b.left_milli : Math.max(0, l.max_evals - l.evals_used) * l.bits_per_eval_milli;
  return {
    id: num(l.id), title: l.title, public_desc: l.public_desc, columns: l.columns, rows_claimed: num(l.rows_claimed), mode: l.mode,
    price_usdc: formatUsdc(BigInt(l.price)), eval_fee_usdc: formatUsdc(BigInt(l.eval_fee)),
    evals_used: l.evals_used, max_evals: l.max_evals, bits_per_eval: formatBits(l.bits_per_eval_milli),
    budget_left_bits: formatBits(left), budget_total_bits: formatBits(b?.budget_milli ?? l.max_evals * l.bits_per_eval_milli),
    leak_budget_left_bits: formatBits(left), blob_sha256: l.blob_sha256, seller: l.seller,
  };
}

// ---------------------------------------------------------------- transfer

export async function transferCommand(ctx: Ctx, a: { from?: Role; to: Role; amount: string }): Promise<{ from: string; to: string; amount: string; tx: string; tx_url: string }> {
  if (ctx.network !== "mainnet") throw new CliError("transfer runs on mainnet only", EXIT.usage);
  const from: Role = a.from ?? (a.to === "buyer" ? "seller" : "buyer");
  if (from === a.to) throw new CliError("--from and --to must be different wallets", EXIT.usage);
  const amount = parseUsdc(a.amount);
  const sender = ctx.actor(from);
  const receiver = ctx.actor(a.to);
  await ctx.confirm([`transfer ${formatUsdc(amount)} USDC inside NEAR Intents: ${sender.id} -> ${receiver.id}`, "network: mainnet"]);
  const tx = await ctx.transport.transfer({ actor: sender, toId: receiver.id, amount });
  record(ctx, { id: `cli-transfer-${tx.txHash}`, kind: "inbound", tx: tx.txHash, chain: "near", block_height: null, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "Intents balance moves", observed: `transferred ${formatUsdc(amount)} USDC ${from} -> ${a.to}` });
  return { from: sender.id, to: receiver.id, amount: formatUsdc(amount), tx: tx.txHash, tx_url: tx.url };
}
