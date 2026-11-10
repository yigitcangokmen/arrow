// WS4-T15 (H-14): one real pass of the whole market on mainnet, or the same step machine on testnet with --dry.
//   npx tsx scripts/src/e2e-mainnet.ts [--network mainnet|testnet] [--dry | --dry-plan] [--yes] [--relay direct|hosted]
//        [--skip-inbound] [--skip-outbound] [--from-step N] [--only N] [--blob-base <https prefix>] [--buyer <acct>] [--seller <acct>]
// 0 preflight · 1 inbound (Base -> Intents) · 2 seller funding · 3 list x3 · 4 eval L1 (PASS) · 5 eval L2 (BUY) · 6 buy L2 (demo key)
// · 7 decrypt + hash triple · 8 eval on the broken-host listing -> refund · 9 outbound (Intents -> Solana) · 10 leak budget.
//   mainnet      moves real USDC: a human runs it (H-14), types y at the spend plan, and agents never pass --yes.
//   --dry-plan   preflight + spend plan only, sends nothing (either network).
//   --dry        testnet rehearsal: steps 1, 2 and 9 are mainnet-only and skipped, the other 8 run against the testnet deploy.
// Refunds land in the buyer's NEAR Intents balance, not in the Base wallet (DEC K-05).
// Exit: 0 all green (WARN allowed), 1 a step failed, 3 steps were skipped, 5 spend not confirmed.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { KeyPair } from "near-api-js";
import {
  BITS_PER_EVAL_MILLI, type ConfigView, encryptFile, formatUsdc, type Network, type NearEvent, NETWORKS, oneclick,
  parseEvents, prepareList, resolveNetwork, sha256Hex, signRawErc191, txStatus, type VersionView, view, viewAccessKey, viewAccount,
} from "@arrow/sdk";
import { buyCommand, type Ctx, decryptCommand, type DecryptResult, evalCommand, type EvalResult } from "../../agent/src/commands.ts";
import { configDir, resolveActor } from "../../agent/src/keys.ts";
import { readTable } from "../../agent/src/data.ts";
import { findEventId, SettleTimeout } from "../../agent/src/settle.ts";
import { muteRateLimitNoise, realTransport, type PaidTx, type RelayMode, type Transport } from "../../agent/src/transport.ts";
import { makeViews } from "../../agent/src/views.ts";
import { ethBalance, sendUsdc, usdcBalance, waitReceipt } from "./lib/base.ts";
import { confirmSpend } from "./lib/confirm.ts";
import { loadEnv, repoRoot } from "./lib/env.ts";
import { appendRun, type EvidenceRun, readEvidence } from "./lib/evidence.ts";
import { mtBalanceOf } from "./lib/intents.ts";
import { explorerTx, log, mask } from "./lib/log.ts";
import { balanceWarnings, INTENTS_METHODS, keyProblems } from "./lib/relayer.ts";
import { fastfsHost, fileKeys, serves, type Status } from "./e2e-testnet.ts";

export interface StepResult {
  n: number;
  status: Status;
  summary: string;
  link?: string;
  /** not applicable in this mode (mainnet-only steps in a testnet rehearsal): left out of the green count */
  na?: true;
}
type Slot = "L1" | "L2" | "L3";

const SCRIPT = "scripts/src/e2e-mainnet.ts";
export const LAST_STEP = 10;
export const MAINNET_ONLY = new Set([1, 2, 9]);
/** steps that move value on mainnet */
const SPENDS = [1, 2, 3, 4, 5, 6, 8, 9];
const UNLOCK = "fixtures/demo/unlock-schedule-412.csv";
const LABELS = "fixtures/demo/wallet-labels-1000.csv";
// Card amounts (USDC base units, 6 decimals). DEC K-06 demo prices: price 2.00, eval fee 0.25.
export const AMOUNTS = { inbound: 5_000_000n, fund: 500_000n, price: 2_000_000n, evalFee: 250_000n, outbound: 1_000_000n } as const;
const PRICE = AMOUNTS.price.toString();
const EVAL_FEE = AMOUNTS.evalFee.toString();
const MAX_EVALS = 50;
const H15_BUYER_NEEDS = 8_000_000n;
const H15_SELLER_NEEDS = 3_500_000n;
const H15_MIN_INBOUND = 3_000_000n;
const MIN_ETH_WEI = 500_000_000_000_000n; // 0.0005 ETH, H-14 precondition
const BROKEN_HOST = (sha: string) => `https://blob-host-missing.invalid/${sha}.bin`;

const LISTING_SPECS: Record<Slot, { file: string; title: string; desc: string }> = {
  L1: { file: UNLOCK, title: "[synthetic] Q1 2027 token unlock schedule (412 rows)", desc: "Synthetic end-to-end test data: a fictional Q1 2027 token unlock schedule. Made by the Arrow team." },
  L2: { file: LABELS, title: "[synthetic] NEAR DeFi wallet labels (1,000 rows)", desc: "Synthetic end-to-end test data: fictional labels for 1,000 NEAR DeFi wallets. Made by the Arrow team." },
  L3: { file: LABELS, title: "[synthetic] e2e broken host", desc: "Synthetic end-to-end test data. The ciphertext host is missing on purpose, so every eval must refund." },
};

const f = (u: bigint) => formatUsdc(u);
/** formatUsdc refuses negative amounts, and a shortfall is exactly what the plan must be able to show */
const fs = (u: bigint) => (u < 0n ? `-${f(-u)}` : f(u));
const copy = (b: Uint8Array) => new Uint8Array(b);
const big = (v: unknown) => BigInt(String(v));
const items = (e: NearEvent): any[] => (Array.isArray(e.data) ? e.data : [e.data]);
const isRefundMemo = (m: unknown) => m === "refund" || (typeof m === "string" && m.startsWith("arrow:refund:"));
const sellerShare = (amount: bigint, treasuryBps: number) => (amount * BigInt(10_000 - treasuryBps)) / 10_000n;

// ---------------------------------------------------------------------- spend plan

export interface PlanInput {
  steps: Set<number>;
  bond: bigint;
  /** what 1Click is quoted to deliver for AMOUNTS.inbound; the amount itself when no quote was made */
  inboundOut: bigint;
  feeBpsEval: number;
  feeBpsSale: number;
  buyerNow: bigint;
  sellerNow: bigint;
}

export interface Plan {
  lines: string[];
  buyerAfter: bigint;
  sellerAfter: bigint;
  /** H-15 inbound in base units: max(3, 8.0 - buyerAfter) */
  h15Inbound: bigint;
  /** a balance would go below zero at some step: the run would fail half way and strand money */
  shortfalls: string[];
  spendsValue: boolean;
}

/** The numbers H-14 asks the human to approve. Pure: balances and fee rates in, lines out. */
export function spendPlan(i: PlanInput): Plan {
  const has = (n: number) => i.steps.has(n);
  let buyer = i.buyerNow;
  let seller = i.sellerNow;
  const lines: string[] = [];
  const shortfalls: string[] = [];
  const check = (step: number) => {
    if (buyer < 0n) shortfalls.push(`buyer Intents balance would be ${fs(buyer)} after step ${step}`);
    if (seller < 0n) shortfalls.push(`seller Intents balance would be ${fs(seller)} after step ${step}`);
  };
  if (has(1)) {
    buyer += i.inboundOut;
    lines.push(`step 1  inbound: ${f(AMOUNTS.inbound)} USDC leaves the buyer's Base wallet (plus Base gas) -> about ${f(i.inboundOut)} arrives as buyer Intents USDC`);
    check(1);
  }
  if (has(2)) {
    buyer -= AMOUNTS.fund;
    seller += AMOUNTS.fund;
    lines.push(`step 2  seller funding: ${f(AMOUNTS.fund)} USDC buyer -> seller inside Intents (transfer, no msg)`);
    check(2);
  }
  if (has(3)) {
    seller -= 3n * i.bond;
    lines.push(`step 3  list x3: 3 x ${f(i.bond)} USDC listing bond paid by the seller (${f(3n * i.bond)})`);
    check(3);
  }
  for (const [n, label] of [[4, "L1"], [5, "L2"]] as const) {
    if (!has(n)) continue;
    buyer -= AMOUNTS.evalFee;
    seller += sellerShare(AMOUNTS.evalFee, i.feeBpsEval);
    lines.push(`step ${n}  eval ${label}: ${f(AMOUNTS.evalFee)} USDC from the buyer (seller keeps ${(10_000 - i.feeBpsEval) / 100}%)`);
    check(n);
  }
  if (has(6)) {
    buyer -= AMOUNTS.price;
    seller += sellerShare(AMOUNTS.price, i.feeBpsSale);
    lines.push(`step 6  buy L2: ${f(AMOUNTS.price)} USDC from the buyer (seller keeps ${(10_000 - i.feeBpsSale) / 100}%)`);
    check(6);
  }
  if (has(8)) {
    buyer -= AMOUNTS.evalFee;
    check(8);
    buyer += AMOUNTS.evalFee;
    lines.push(`step 8  eval L3: ${f(AMOUNTS.evalFee)} USDC from the buyer, refunded in full to the buyer's NEAR Intents balance (not to Base)`);
  }
  if (has(9)) {
    seller -= AMOUNTS.outbound;
    lines.push(`step 9  outbound: ${f(AMOUNTS.outbound)} USDC seller Intents -> Solana through 1Click`);
    check(9);
  }
  const needed = H15_BUYER_NEEDS - buyer;
  const h15Inbound = needed > H15_MIN_INBOUND ? needed : H15_MIN_INBOUND;
  lines.push(`total leaving Base: ${has(1) ? `${f(AMOUNTS.inbound)} USDC + gas` : "nothing"} (bonds, fees and the price stay inside Intents; treasury shares are not tracked)`);
  lines.push(`after this run, buyer Intents will hold ≈${fs(buyer)} USDC; H-15 needs ≥ 8.0 → H-15 inbound = max(3, 8.0 − ${fs(buyer)}) = ${f(h15Inbound)} USDC`);
  lines.push(`seller will hold ≈${fs(seller)} USDC; H-15 needs ≥ 3.5${seller < H15_SELLER_NEEDS ? ` (short by ${f(H15_SELLER_NEEDS - seller)}: a step 2 style transfer covers it)` : ""}`);
  return { lines, buyerAfter: buyer, sellerAfter: seller, h15Inbound, shortfalls, spendsValue: SPENDS.some(has) };
}

// ---------------------------------------------------------------------- preflight rules

export interface ReleaseSha {
  sha: string;
  source: string;
  /** false for the release candidate file: a mismatch is then a warning, not a blocker */
  frozen: boolean;
}

/** The on-chain config against what H-14 expects. Blockers and warnings are kept apart. */
export function configProblems(p: { network: Network; version: VersionView; cfg: ConfigView; pk: string | null; release: ReleaseSha | null }): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const c = p.cfg.config as { outlayer?: string; intents?: string | null; usdc_token_id?: string; program_wasm_hash?: string };
  if (p.version.build !== p.network) problems.push(`build is ${p.version.build}, not ${p.network}`);
  if (p.cfg.paused) problems.push("contract is paused");
  const outlayer = p.network === "mainnet" ? "outlayer.near" : "outlayer.testnet";
  if (c.outlayer !== outlayer) problems.push(`outlayer is ${c.outlayer}, expected ${outlayer}`);
  if (p.network === "mainnet") {
    if (c.intents !== NETWORKS.mainnet.intents) problems.push(`intents is ${c.intents}, expected ${NETWORKS.mainnet.intents}`);
    if (c.usdc_token_id !== NETWORKS.mainnet.usdcToken) problems.push(`usdc_token_id is ${c.usdc_token_id}, expected ${NETWORKS.mainnet.usdcToken}`);
  }
  if (!p.pk || !/^04[0-9a-f]{128}$/.test(p.pk)) problems.push("program_pubkey is not 130 hex (init_program_key not run?)");
  const have = (c.program_wasm_hash ?? "").toLowerCase();
  if (!p.release) {
    (p.network === "mainnet" ? problems : warnings).push("release/sha256.txt is missing (the freeze writes it): program_wasm_hash cannot be compared");
  } else if (have !== p.release.sha) {
    const msg = `program_wasm_hash ${have.slice(0, 12)}… != ${p.release.source} ${p.release.sha.slice(0, 12)}…`;
    (p.release.frozen ? problems : warnings).push(p.release.frozen ? msg : `${msg} (release candidate, not frozen)`);
  }
  return { problems, warnings };
}

/** The gas tank must cover this run's OutLayer deposits: 3 evals and 1 release. Falls back to 0.9 NEAR when the config has no deposits. */
export function tankNeeded(cfg: ConfigView): bigint {
  const c = cfg.config as { outlayer_deposit_eval?: string; outlayer_deposit_release?: string };
  try {
    return 3n * big(c.outlayer_deposit_eval) + big(c.outlayer_deposit_release);
  } catch {
    return 900_000_000_000_000_000_000_000n;
  }
}

// ---------------------------------------------------------------------- resume (--from-step)

export interface Resume {
  stamp: string;
  ids: Partial<Record<Slot, number>>;
  /** listings that already have a completed (not refunded) eval in that run */
  evalDone: Partial<Record<"L1" | "L2", boolean>>;
  purchaseId?: number;
}

type EvidenceRow = Pick<EvidenceRun, "id" | "kind" | "listing_id" | "eval_id" | "purchase_id">;

/** The listing, eval and purchase ids of the newest earlier run that listed all three listings, so a retry never pays twice. */
export function resumeFrom(runs: EvidenceRow[]): Resume | null {
  const mine = runs.map((r) => ({ r, m: /^e2e-(?:mainnet|dry)-(\d{8}T\d{6}Z)-(.*)$/.exec(r.id) })).filter((x) => x.m);
  const stamps = [...new Set(mine.map((x) => x.m![1]))].sort().reverse();
  for (const stamp of stamps) {
    const rows = mine.filter((x) => x.m![1] === stamp).map((x) => ({ ...x.r, rest: x.m![2] }));
    const ids: Partial<Record<Slot, number>> = {};
    for (const row of rows) {
      const m = /^list-(L[123])-\d+$/.exec(row.rest);
      if (m && row.listing_id !== null) ids[m[1] as Slot] = Number(row.listing_id);
    }
    if (!ids.L1 || !ids.L2 || !ids.L3) continue;
    const evalDone: Resume["evalDone"] = {};
    for (const slot of ["L1", "L2"] as const) evalDone[slot] = rows.some((x) => x.kind === "eval" && Number(x.listing_id) === ids[slot]);
    const buy = rows.find((x) => x.kind === "buy" && Number(x.listing_id) === ids.L2 && x.purchase_id !== null);
    return { stamp, ids, evalDone, purchaseId: buy ? Number(buy.purchase_id) : undefined };
  }
  return null;
}

// ---------------------------------------------------------------------- refund events

/** The two events of a refund: arrow_refund from the market and the USDC transfer back to the buyer (NEP-245 on mainnet, NEP-141 on testnet). */
export function findRefundEvents(events: NearEvent[], p: { network: Network; contract: string; buyerId: string; evalId: number }) {
  const mainnet = p.network === "mainnet";
  const refund = events
    .filter((e) => e.standard === "arrow" && e.event === "arrow_refund")
    .flatMap(items)
    .find((d) => d.kind === "eval" && Number(d.id) === p.evalId);
  const transfer = events
    .filter((e) => (mainnet ? e.standard === "nep245" && e.event === "mt_transfer" && e.executorId === NETWORKS.mainnet.intents : e.standard === "nep141" && e.event === "ft_transfer" && e.executorId === NETWORKS.testnet.usdcToken))
    .flatMap(items)
    .find((d) => isRefundMemo(d.memo) && d.new_owner_id === p.buyerId && (!mainnet || d.old_owner_id === p.contract));
  const amount = transfer ? String(Array.isArray(transfer.amounts) ? transfer.amounts[0] : transfer.amount) : undefined;
  const token = transfer && Array.isArray(transfer.token_ids) ? String(transfer.token_ids[0]) : undefined;
  return { refund, transfer, amount, token };
}

// ---------------------------------------------------------------------- the step machine

export interface InboundResult {
  status: string;
  baseTx: string;
  deposit: string;
  seconds: number;
  block: number | null;
  before: bigint;
  after: bigint;
  attempts: number;
}
export interface OutboundResult {
  status: string;
  deposit: string;
  solTx: string | null;
  route: "generate-intent" | "deposit-transfer";
  nearTx: string | null;
}

export interface MainnetDeps {
  ctx: Ctx;
  /** testnet rehearsal: steps 1, 2 and 9 are not applicable */
  dry: boolean;
  buyerId: string;
  sellerId: string;
  contract: string;
  release: ReleaseSha | null;
  /** NEAR Intents USDC on mainnet, the arrow-usd token on testnet */
  balanceOf(accountId: string): Promise<bigint>;
  base?: { usdc(): Promise<bigint>; eth(): Promise<bigint> };
  /** problems and warnings about the relayer key (direct relay only) */
  relayerCheck?(): Promise<{ problems: string[]; warnings: string[] }>;
  inboundQuote?(units: bigint): Promise<bigint>;
  outboundQuote?(units: bigint): Promise<bigint>;
  inbound?(units: bigint): Promise<InboundResult>;
  outbound?(units: bigint): Promise<OutboundResult>;
  /** Makes the ciphertext available over https and returns its URL; throws unless that URL serves exactly these bytes. */
  host(blob: Uint8Array, sha256: string): Promise<string>;
  keys(plaintextSha: string, source: string): { key: Uint8Array; nonce: Uint8Array };
  txEvents(txHash: string): Promise<NearEvent[]>;
  evidenceRuns(): EvidenceRow[];
  confirm(plan: string[]): Promise<void>;
  repo: string;
  workDir: string;
  sleep(ms: number): Promise<void>;
  /** Compact UTC stamp that makes evidence ids unique per run. */
  stamp: string;
  say(line: string): void;
}

export interface MainnetOpts {
  from: number;
  only?: number;
  dryPlan?: boolean;
  skipInbound?: boolean;
  skipOutbound?: boolean;
}

export interface MainnetReport {
  results: StepResult[];
  listingIds: Partial<Record<Slot, number>>;
  exit: number;
  summary: string;
  plan?: Plan;
}

export async function runE2eMainnet(deps: MainnetDeps, opts: MainnetOpts): Promise<MainnetReport> {
  const network = deps.ctx.network;
  const mainnet = network === "mainnet";
  const sel = (n: number) => (opts.only === undefined || opts.only === n) && n >= opts.from;
  const selected = new Set([...Array(LAST_STEP + 1).keys()].filter(sel));
  const prefix = `e2e-${deps.dry ? "dry" : "mainnet"}-${deps.stamp}`;
  const ctx: Ctx = {
    ...deps.ctx,
    // the single spend plan approved up front covers every payment below
    confirm: async () => {},
    evidence: (run) =>
      deps.ctx.evidence({
        ...run,
        id: `${prefix}-${run.id.replace(/^cli-/, "")}`,
        ...(run.kind === "buy" && { observed: `${run.observed} · demo:"e2e"` }),
      }),
  };
  const record = (id: string, run: Omit<Parameters<Ctx["evidence"]>[0], "id">) => deps.ctx.evidence({ ...run, id: `${prefix}-${id}` });
  const waitDeps = () => ({ network, views: ctx.views, ...ctx.wait });
  const usdc = NETWORKS[network].usdcToken;
  const link = (chain: "near" | "base" | "solana", hash: string) => explorerTx(network, chain, hash);

  const S = {
    programPk: "",
    bond: 100_000n,
    ids: {} as Partial<Record<Slot, number>>,
    /** evals_used of resumed listings before this run; listings made in this run start at 0 */
    base: { L1: 0, L2: 0, L3: 0 } as Record<Slot, number>,
    accepted: { L1: 0, L2: 0, L3: 0 } as Record<Slot, number>,
    bought: undefined as undefined | Awaited<ReturnType<typeof buyCommand>>,
    purchaseId: undefined as number | undefined,
    plan: undefined as Plan | undefined,
  };

  // ------------------------------------------------------------------ steps
  async function preflight(): Promise<StepResult> {
    const problems: string[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];
    const v = await ctx.views.version();
    const cfg = await ctx.views.config();
    const pk = await ctx.views.programPubkey();
    const c = cfg.config as { listing_bond?: string; fee_bps_eval?: number; fee_bps_sale?: number; program_wasm_hash?: string };
    const checked = configProblems({ network, version: v, cfg, pk, release: deps.release });
    problems.push(...checked.problems);
    warnings.push(...checked.warnings);
    const tank = big(cfg.tank_available);
    if (tank < tankNeeded(cfg)) problems.push(`gas tank ${tank} yoctoNEAR is below ${tankNeeded(cfg)} (3 evals + 1 release)`);
    for (const [role, id] of [["buyer", deps.buyerId], ["seller", deps.sellerId]] as const) {
      const a = ctx.actor(role);
      if (mainnet ? !a.evm : !a.nearSecret) problems.push(`no ${mainnet ? "EVM key" : "NEAR key"} for the ${role} ${id}`);
    }
    if (deps.buyerId === deps.sellerId) problems.push("buyer and seller are the same account");

    if (mainnet && deps.relayerCheck) {
      const r = await deps.relayerCheck();
      problems.push(...r.problems.map((p) => `relayer: ${p}`));
      warnings.push(...r.warnings);
      if (r.problems.length === 0) notes.push("relayer key OK");
    }
    if (mainnet && deps.base && selected.has(1) && !opts.skipInbound) {
      const [u, e] = await Promise.all([deps.base.usdc(), deps.base.eth()]);
      notes.push(`Base buyer USDC ${f(u)} · ETH ${Number(e) / 1e18}`);
      if (u < AMOUNTS.inbound + 500_000n) problems.push(`buyer Base USDC ${f(u)} < ${f(AMOUNTS.inbound + 500_000n)} (H-14 needs 5.5)`);
      if (e < MIN_ETH_WEI) problems.push(`buyer Base ETH ${Number(e) / 1e18} < 0.0005`);
    }

    S.programPk = pk ?? "";
    S.bond = big(c.listing_bond ?? "100000");
    const [buyerNow, sellerNow] = await Promise.all([deps.buyerId, deps.sellerId].map((a) => deps.balanceOf(a)));
    notes.push(`${mainnet ? "Intents" : "aUSD"} USDC buyer ${f(buyerNow)} · seller ${f(sellerNow)}`);

    let inboundOut: bigint = AMOUNTS.inbound;
    if (mainnet && selected.has(1) && !opts.skipInbound && deps.inboundQuote) {
      try {
        inboundOut = await deps.inboundQuote(AMOUNTS.inbound);
        notes.push(`1Click dry quote inbound: ${f(AMOUNTS.inbound)} -> ${f(inboundOut)}`);
      } catch (e) {
        problems.push(`1Click inbound dry quote failed: ${mask((e as Error).message)}`);
      }
    }
    if (mainnet && selected.has(9) && !opts.skipOutbound && deps.outboundQuote) {
      try {
        notes.push(`1Click dry quote outbound: ${f(AMOUNTS.outbound)} -> ${f(await deps.outboundQuote(AMOUNTS.outbound))} on Solana`);
      } catch (e) {
        problems.push(`outbound: ${mask((e as Error).message)}`);
      }
    }
    if (selected.has(3)) {
      for (const spec of [LISTING_SPECS.L1, LISTING_SPECS.L2]) {
        try {
          await hostOf(spec);
        } catch (e) {
          problems.push(`blob: ${mask((e as Error).message)}`);
        }
      }
      if (!problems.some((p) => p.startsWith("blob:"))) notes.push("e2e blob URLs serve the expected sha256");
    }

    S.plan = spendPlan({ steps: selected, bond: S.bond, inboundOut, feeBpsEval: c.fee_bps_eval ?? 1000, feeBpsSale: c.fee_bps_sale ?? 200, buyerNow, sellerNow });
    if (!deps.dry) problems.push(...S.plan.shortfalls);
    for (const l of [...notes.map((n) => `  preflight · ${n}`), ...warnings.map((w) => `  preflight · WARN ${w}`)]) deps.say(l);
    if (problems.length) return { n: 0, status: "FAIL", summary: problems.join("; ") };
    for (const slot of ["L1", "L2", "L3"] as const) {
      if (S.ids[slot] !== undefined) S.base[slot] = (await ctx.views.leakBudget(S.ids[slot]!))?.evals_used ?? 0;
    }
    return {
      n: 0, status: warnings.length ? "WARN" : "PASS",
      summary: `${v.name} ${v.version} build=${v.build} path=${v.payment_path}/${v.result_path} · program_pubkey ${pk!.slice(0, 10)}… · program ${(c.program_wasm_hash ?? "").slice(0, 8)}…${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`,
    };
  }

  /** Hosts (and checks) this plaintext's ciphertext. Same plaintext, same key, same bytes: reruns reuse the blob. */
  async function hostOf(spec: { file: string }): Promise<string> {
    const plain = new Uint8Array(readFileSync(join(deps.repo, spec.file)));
    const { key, nonce } = deps.keys(sha256Hex(plain), spec.file);
    const probe = encryptFile(plain, copy(key), nonce);
    return deps.host(probe.blob, probe.blobSha256);
  }

  async function inbound(): Promise<StepResult> {
    if (!deps.inbound) throw new Error("no inbound implementation");
    const r = await deps.inbound(AMOUNTS.inbound);
    const gained = r.after - r.before;
    const observed = `status ${r.status} in ${r.seconds} s${r.attempts > 1 ? ` after ${r.attempts} attempts (first REFUNDED, retried at slippage 100)` : ""}; intents USDC ${f(r.before)} -> ${f(r.after)} (+${f(gained > 0n ? gained : 0n)})`;
    record("inbound", { kind: "inbound", tx: r.baseTx, chain: "base", block_height: r.block, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: r.deposit, expect: "SUCCESS, USDC arrives on the buyer's Intents account", observed });
    if (r.status !== "SUCCESS" || gained <= 0n) return { n: 1, status: "FAIL", summary: observed, link: link("base", r.baseTx) };
    return { n: 1, status: "PASS", summary: observed, link: link("base", r.baseTx) };
  }

  async function fundSeller(): Promise<StepResult> {
    const before = await deps.balanceOf(deps.sellerId);
    const tx = await ctx.transport.transfer({ actor: ctx.actor("buyer"), toId: deps.sellerId, amount: AMOUNTS.fund });
    let after = before;
    for (let i = 0; i < 30 && after < before + AMOUNTS.fund; i++) {
      await deps.sleep(2000);
      after = await deps.balanceOf(deps.sellerId);
    }
    record("fund-seller", { kind: "inbound", tx: tx.txHash, chain: "near", block_height: null, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "Intents balance moves buyer -> seller", observed: `seller ${f(before)} -> ${f(after)}` });
    if (after < before + AMOUNTS.fund) return { n: 2, status: "FAIL", summary: `seller balance ${f(before)} -> ${f(after)} 60 s after the transfer (expected +${f(AMOUNTS.fund)})`, link: tx.url };
    return { n: 2, status: "PASS", summary: `seller Intents ${f(before)} -> ${f(after)} (+${f(AMOUNTS.fund)}, no msg)`, link: tx.url };
  }

  async function listOne(slot: Slot): Promise<{ id: number; tx: PaidTx }> {
    const spec = LISTING_SPECS[slot];
    const broken = slot === "L3";
    const plain = new Uint8Array(readFileSync(join(deps.repo, spec.file)));
    const table = readTable(join(deps.repo, spec.file));
    const { key, nonce } = deps.keys(sha256Hex(plain), spec.file);
    const probe = encryptFile(plain, copy(key), nonce);
    const blobUrl = broken ? BROKEN_HOST(probe.blobSha256) : await deps.host(probe.blob, probe.blobSha256);
    const prepared = prepareList({
      plaintext: plain, title: spec.title, publicDesc: spec.desc, columns: table.columns, rowsClaimed: table.rows, blobUrl,
      price: PRICE, evalFee: EVAL_FEE, maxEvals: MAX_EVALS, mode: "scored", programPk: S.programPk, key: copy(key), nonce,
    });
    if (prepared.blobSha256 !== probe.blobSha256) throw new Error("ciphertext is not reproducible (key/nonce store changed?)");
    const tx = await ctx.transport.pay({ actor: ctx.actor("seller"), amount: S.bond, msg: prepared.msg });
    const { id, rejection } = await findEventId(waitDeps(), tx, "arrow_listed", "listing_id");
    if (id === undefined) throw new Error(`the market refused the ${slot} listing: ${rejection}`);
    // the event comes from the optimistic tx status, the view reads the final block a few seconds later
    let l = await ctx.views.listing(id);
    for (let i = 0; i < 15 && !l; i++) {
      await deps.sleep(2000);
      l = await ctx.views.listing(id);
    }
    if (!l) throw new Error(`${slot}: listing #${id} is not visible in the final state after 30 s`);
    if (l.blob_sha256 !== prepared.blobSha256 || l.blob_url !== blobUrl) throw new Error(`${slot}: listing #${id} view does not match what was sent`);
    record(`list-${slot}-${id}`, { kind: "list", tx: tx.txHash, chain: "near", block_height: null, listing_id: id, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "listing created, blob hash on chain", observed: `listed #${id} ${broken ? "(broken host on purpose)" : "(ciphertext served)"} sha256 ${prepared.blobSha256.slice(0, 12)}…` });
    return { id, tx };
  }

  async function list(): Promise<StepResult> {
    const out: string[] = [];
    let first: PaidTx | undefined;
    for (const slot of ["L1", "L2", "L3"] as const) {
      const r = await listOne(slot);
      S.ids[slot] = r.id;
      first ??= r.tx;
      out.push(`${slot}=#${r.id}`);
    }
    return { n: 3, status: "PASS", summary: `listed ${out.join(" ")} (3 synthetic listings, price ${f(AMOUNTS.price)}, eval fee ${f(AMOUNTS.evalFee)})`, link: first?.url };
  }

  const critPath = (name: string) => join(deps.repo, "fixtures/criteria", name);
  const need = (slot: Slot) => (S.ids[slot] === undefined ? "needs step 3 (or --from-step with evidence of an earlier run)" : undefined);
  const verdictText = (r: EvalResult) => `${r.verdict} · fit ${r.fit}/5 · novelty ${r.novelty ?? "n/a"}/5 · eval #${r.eval_id}`;

  async function evalOnce(slot: Slot, criteria: string): Promise<EvalResult> {
    // all e2e evals and the buy share the public demo key, so decrypt can close the eval.h leg of the hash triple
    const res = await evalCommand(ctx, { listingId: S.ids[slot]!, criteria, demoKey: true });
    S.accepted[slot]++;
    return res;
  }
  /** A refund with reason "null" is OutLayer's yield timeout, not a verdict about the data: one retry (card T10). */
  async function evalRetry(slot: Slot, criteria: string): Promise<EvalResult> {
    const r = await evalOnce(slot, criteria);
    return r.status === "refunded" && r.refund_reason === "null" ? evalOnce(slot, criteria) : r;
  }

  async function evalPass(): Promise<StepResult> {
    const miss = need("L1");
    if (miss) return { n: 4, status: "SKIP", summary: miss };
    const r = await evalRetry("L1", critPath("demo.json"));
    if (r.status === "refunded") return { n: 4, status: "FAIL", summary: `eval #${r.eval_id} refunded (${r.refund_reason})`, link: r.tx_url };
    // novelty 1 < min_novelty 3 is a structural gate: BUY here would be a bug whatever the model says.
    if (r.verdict !== "PASS") return { n: 4, status: "FAIL", summary: `expected PASS, got ${verdictText(r)}`, link: r.tx_url };
    return { n: 4, status: "PASS", summary: verdictText(r), link: r.tx_url };
  }

  async function evalBuy(): Promise<StepResult> {
    const miss = need("L2");
    if (miss) return { n: 5, status: "SKIP", summary: miss };
    let r = await evalRetry("L2", critPath("demo-buy.json"));
    if (r.status === "done" && r.verdict !== "BUY") r = await evalRetry("L2", critPath("demo-buy.json"));
    if (r.status === "refunded") return { n: 5, status: "FAIL", summary: `eval #${r.eval_id} refunded (${r.refund_reason})`, link: r.tx_url };
    if (r.verdict === "BUY") return { n: 5, status: "PASS", summary: verdictText(r), link: r.tx_url };
    return { n: 5, status: "WARN", summary: `WARN: BUY scene not reproduced; LLM verdict ${verdictText(r)}`, link: r.tx_url };
  }

  async function buy(): Promise<StepResult> {
    const miss = need("L2");
    if (miss) return { n: 6, status: "SKIP", summary: miss };
    const id = S.ids.L2!;
    const r = await buyCommand(ctx, { listingId: id, out: join(deps.workDir, `l2-${id}.csv`), demoKey: true });
    S.bought = r;
    S.purchaseId = r.purchase_id;
    if (r.status === "refunded") return { n: 6, status: "FAIL", summary: `purchase #${r.purchase_id} refunded (${r.refund_reason})`, link: r.tx_url };
    return { n: 6, status: "PASS", summary: `bought listing #${id} for ${f(AMOUNTS.price)} USDC with the demo key · purchase #${r.purchase_id} · sealed key released`, link: r.tx_url };
  }

  async function decrypt(): Promise<StepResult> {
    let d: DecryptResult | undefined = S.bought?.decrypt;
    if (!d && S.purchaseId !== undefined) d = await decryptCommand(ctx, { purchaseId: S.purchaseId, demoKey: true, out: join(deps.workDir, `l2-resumed.csv`) });
    if (!d) return { n: 7, status: "SKIP", summary: "needs step 6 (or --from-step with evidence of a bought purchase)" };
    const bad = d.checks.filter((c) => !c.ok);
    if (bad.length) return { n: 7, status: "FAIL", summary: `hash check failed: ${bad.map((c) => c.label).join("; ")}` };
    // sha256(plaintext) against the value the demo generator wrote down
    const expected = JSON.parse(readFileSync(join(deps.repo, "fixtures/demo/expected.json"), "utf8")).plaintext_sha256?.["wallet-labels-1000.csv"] as string | undefined;
    const got = d.out ? sha256Hex(new Uint8Array(readFileSync(d.out))) : undefined;
    if (d.out) rmSync(d.out, { force: true });
    if (!expected || got !== expected) return { n: 7, status: "FAIL", summary: `sha256(plaintext) ${got?.slice(0, 12)}… != expected ${expected?.slice(0, 12)}…` };
    const evalLeg = d.checks.some((c) => c.label.startsWith("eval.h == listing.blob_sha256 (eval #"));
    const core = "listing.blob_sha256 == purchase.h == sha256(download) == " + (evalLeg ? "eval.h" : "(eval.h not exercised)") + " · sha256(plaintext) == fixtures/demo/expected.json";
    return evalLeg
      ? { n: 7, status: "PASS", summary: `${core} · sha256 match` }
      : { n: 7, status: "WARN", summary: `${core} · eval.h leg waits for a completed eval by the demo key on this listing` };
  }

  async function refundEval(): Promise<StepResult> {
    const miss = need("L3");
    if (miss) return { n: 8, status: "SKIP", summary: miss };
    const before = await deps.balanceOf(deps.buyerId);
    let r = await evalOnce("L3", critPath("demo-buy.json"));
    if (r.status === "refunded" && r.refund_reason === "null") r = await evalOnce("L3", critPath("demo-buy.json"));
    if (r.status !== "refunded") return { n: 8, status: "FAIL", summary: `expected a refund, got ${verdictText(r)}`, link: r.tx_url };
    if (r.refund_reason !== "not_ok") return { n: 8, status: "FAIL", summary: `refund reason "${r.refund_reason}", expected "not_ok" (enclave fetch/ok:false)`, link: r.tx_url };
    let found = findRefundEvents([], { network, contract: deps.contract, buyerId: deps.buyerId, evalId: r.eval_id });
    for (let i = 0; i < 20 && !(found.refund && found.transfer); i++) {
      const events = await deps.txEvents(r.tx).catch(() => []);
      found = findRefundEvents(events, { network, contract: deps.contract, buyerId: deps.buyerId, evalId: r.eval_id });
      if (!(found.refund && found.transfer)) await deps.sleep(3000);
    }
    const what = mainnet ? `mt_transfer{memo:"refund", old_owner_id:${deps.contract}, new_owner_id:${deps.buyerId}}` : `ft_transfer memo refund to ${deps.buyerId}`;
    if (!found.refund) return { n: 8, status: "FAIL", summary: "no arrow_refund event in the payment transaction", link: r.tx_url };
    if (!found.transfer) return { n: 8, status: "FAIL", summary: `arrow_refund seen but no ${what}`, link: r.tx_url };
    if (String(found.refund.amount) !== EVAL_FEE || found.amount !== EVAL_FEE) return { n: 8, status: "FAIL", summary: `refund amounts: arrow_refund ${found.refund.amount}, transfer ${found.amount}, eval fee ${EVAL_FEE}`, link: r.tx_url };
    if (mainnet && found.token !== usdc) return { n: 8, status: "FAIL", summary: `refund token ${found.token} is not USDC`, link: r.tx_url };
    let after = await deps.balanceOf(deps.buyerId);
    for (let i = 0; i < 10 && after !== before; i++) {
      await deps.sleep(3000);
      after = await deps.balanceOf(deps.buyerId);
    }
    if (after !== before) return { n: 8, status: "FAIL", summary: `buyer balance ${f(before)} before, ${f(after)} after the refund`, link: r.tx_url };
    return { n: 8, status: "PASS", summary: `arrow_refund{reason:"not_ok"} + ${what} ${f(AMOUNTS.evalFee)} USDC + buyer ${mainnet ? "Intents " : ""}balance ${f(after)} unchanged`, link: r.tx_url };
  }

  async function outbound(): Promise<StepResult> {
    if (!deps.outbound) throw new Error("no outbound implementation");
    const r = await deps.outbound(AMOUNTS.outbound);
    const observed = `status ${r.status} via ${r.route}${r.solTx ? "" : " (no Solana tx hash reported)"}`;
    record("outbound", { kind: "outbound", tx: r.solTx, chain: "solana", block_height: null, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: r.deposit, expect: "SUCCESS, USDC arrives on Solana", observed });
    const url = r.solTx ? link("solana", r.solTx) : undefined;
    return r.status === "SUCCESS" ? { n: 9, status: "PASS", summary: `${f(AMOUNTS.outbound)} USDC seller Intents -> Solana · ${observed}`, link: url } : { n: 9, status: "FAIL", summary: observed, link: url };
  }

  async function leakBudget(): Promise<StepResult> {
    const problems: string[] = [];
    const seen: string[] = [];
    for (const slot of ["L1", "L2", "L3"] as const) {
      const id = S.ids[slot];
      if (id === undefined) continue;
      const b = await ctx.views.leakBudget(id);
      if (!b) {
        problems.push(`${slot} #${id}: no leak_budget`);
        continue;
      }
      const used = S.base[slot] + S.accepted[slot];
      const bits = BITS_PER_EVAL_MILLI.scored;
      const exp = { evals_used: used, spent_milli: used * bits, budget_milli: MAX_EVALS * bits, left_milli: (MAX_EVALS - used) * bits };
      const got = { evals_used: b.evals_used, spent_milli: b.spent_milli, budget_milli: b.budget_milli, left_milli: b.left_milli };
      if (JSON.stringify(exp) !== JSON.stringify(got)) problems.push(`${slot} #${id}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
      else seen.push(`${slot} used ${used} spent ${b.spent_milli}/${b.budget_milli} left ${b.left_milli}`);
    }
    if (problems.length) return { n: 10, status: "FAIL", summary: problems.join("; ") };
    if (seen.length === 0) return { n: 10, status: "SKIP", summary: "needs step 3 (or --from-step with evidence of an earlier run)" };
    const l3 = S.accepted.L3 > 0 ? " · the refunded L3 eval still counts (never decremented)" : "";
    return { n: 10, status: "PASS", summary: `${seen.join(" · ")}${l3}` };
  }

  // ------------------------------------------------------------------ run
  const plan: [number, () => Promise<StepResult>][] = [
    [0, preflight], [1, inbound], [2, fundSeller], [3, list], [4, evalPass], [5, evalBuy], [6, buy], [7, decrypt], [8, refundEval], [9, outbound], [10, leakBudget],
  ];
  const results: StepResult[] = [];
  const emit = (r: StepResult) => {
    results.push(r);
    deps.say(`[${r.status}] step ${r.n} · ${r.summary}${r.link ? ` · ${r.link}` : ""}`);
  };

  // listing ids of an earlier run, when this run starts after step 3 (or skips it)
  if (!selected.has(3) && [...selected].some((n) => n >= 4)) {
    const r = resumeFrom(deps.evidenceRuns());
    if (r) {
      Object.assign(S.ids, r.ids);
      S.purchaseId = r.purchaseId;
      deps.say(`resuming the ids of the run ${r.stamp}: L1=#${r.ids.L1} L2=#${r.ids.L2} L3=#${r.ids.L3}${r.purchaseId !== undefined ? ` · purchase #${r.purchaseId}` : ""}`);
    }
  }

  let aborted = false;
  for (const [n, fn] of plan) {
    if (aborted) break;
    if (n !== 0 && (!selected.has(n) || opts.dryPlan)) continue;
    if (n !== 0 && deps.dry && MAINNET_ONLY.has(n)) {
      emit({ n, status: "SKIP", summary: "mainnet-only: skipped in dry", na: true });
      continue;
    }
    if ((n === 1 && opts.skipInbound) || (n === 9 && opts.skipOutbound)) {
      emit({ n, status: "SKIP", summary: `skipped by --skip-${n === 1 ? "inbound" : "outbound"}` });
      continue;
    }
    try {
      const r = await fn();
      if (n !== 0) emit(r);
      else {
        // the preflight always runs (its numbers feed the plan) but is printed only when asked for or when it fails
        if (selected.has(0) || opts.dryPlan || r.status === "FAIL") emit(r);
        if (r.status === "FAIL") aborted = true;
        if (r.status !== "FAIL" || opts.dryPlan) await approve();
      }
    } catch (e) {
      emit({ n, status: "FAIL", summary: e instanceof SettleTimeout ? e.message : mask(e instanceof Error ? e.message : String(e)) });
      if (n === 0) aborted = true;
    }
  }

  /** prints the plan and, on mainnet, waits for the human; dry-plan stops here */
  async function approve(): Promise<void> {
    const p = S.plan;
    if (!p) return;
    if (!mainnet && !opts.dryPlan) return;
    deps.say("spend plan:");
    for (const l of p.lines) deps.say(`  ${l}`);
    if (!opts.dryPlan && mainnet && p.spendsValue) await deps.confirm(p.lines);
  }

  const counted = results.filter((r) => !r.na);
  const count = (s: Status) => counted.filter((r) => r.status === s).length;
  const green = count("PASS") + count("WARN");
  const head = deps.dry ? "E2E mainnet (dry on testnet)" : "E2E mainnet";
  const unit = deps.dry ? "applicable steps green" : "green";
  const summary = opts.dryPlan
    ? `E2E mainnet (${network}) dry-plan: preflight ${count("FAIL") ? "FAILED" : "green"}${S.plan ? " · spend plan printed" : ""} · nothing sent`
    : `${head}: ${green}/${counted.length} ${unit}` + (count("WARN") ? ` (${count("WARN")} WARN)` : "") + (count("SKIP") ? ` · ${count("SKIP")} skipped` : "") + (count("FAIL") ? ` · ${count("FAIL")} FAILED` : "");
  deps.say(summary);
  if (!opts.dryPlan && mainnet && count("FAIL") === 0 && count("SKIP") === 0) deps.say(`next: npm run verify -- --network mainnet --only e2e --pre-lock`);
  if (count("FAIL") > 0 && !opts.dryPlan) deps.say(`if a step failed, do not rerun from scratch: paste this output; the agent names the exact --from-step N command`);
  return { results, listingIds: S.ids, exit: count("FAIL") ? 1 : count("SKIP") ? 3 : 0, summary, plan: S.plan };
}

// ---------------------------------------------------------------------- real dependencies

/** Hosts the e2e ciphertexts at <blobBase>/<sha>.bin. When one is missing it is written to fixtures/blobs/e2e/ for the human to commit and push (D4-13). */
export function repoBlobHost(blobBase: string, repo: string): MainnetDeps["host"] {
  return async (blob, sha) => {
    const url = `${blobBase.replace(/\/+$/, "")}/${sha}.bin`;
    if (await serves(url, sha)) return url;
    const dir = join(repo, "fixtures/blobs/e2e");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sha}.bin`);
    writeFileSync(file, blob);
    throw new Error(`${url} does not serve the ciphertext: commit and push ${file} (sha256 ${sha}, ${blob.length} bytes) at the freeze commit, then rerun`);
  };
}

export const destinationTxHash = (s: { swapDetails?: Record<string, unknown> } | null): string | null => {
  const h = (s?.swapDetails as { destinationChainTxHashes?: { hash?: unknown }[] } | undefined)?.destinationChainTxHashes?.[0]?.hash;
  return typeof h === "string" && h !== "" ? h : null;
};

function parseStep(s: string | undefined, name: string): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > LAST_STEP) throw new Error(`--${name} needs a step number 0-${LAST_STEP}`);
  return n;
}

const USAGE = "usage: npx tsx scripts/src/e2e-mainnet.ts [--network mainnet|testnet] [--dry | --dry-plan] [--yes] [--relay direct|hosted] [--skip-inbound] [--skip-outbound] [--from-step N] [--only N] [--blob-base <https prefix>] [--buyer <acct>] [--seller <acct>]";

export async function main(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      network: { type: "string", default: "mainnet" }, dry: { type: "boolean" }, "dry-plan": { type: "boolean" }, yes: { type: "boolean" },
      relay: { type: "string", default: "direct" }, "skip-inbound": { type: "boolean" }, "skip-outbound": { type: "boolean" },
      "from-step": { type: "string" }, only: { type: "string" }, "blob-base": { type: "string" }, buyer: { type: "string" }, seller: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (v.help) {
    console.log(USAGE);
    return 0;
  }
  const usage = (msg: string) => (console.error(`${msg}\n${USAGE}`), 2);
  if (v.network !== "mainnet" && v.network !== "testnet") return usage("--network must be mainnet or testnet");
  const network: Network = v.network;
  if (v.relay !== "direct" && v.relay !== "hosted") return usage("--relay must be direct or hosted");
  if (network === "testnet" && !v.dry && !v["dry-plan"]) return usage("testnet runs only as a rehearsal: add --dry");
  if (network === "mainnet" && v.dry) return usage("--dry is the testnet rehearsal; on mainnet use --dry-plan (preflight + spend plan, sends nothing)");
  let from: number;
  let only: number | undefined;
  try {
    from = parseStep(v["from-step"], "from-step") ?? 0;
    only = parseStep(v.only, "only");
  } catch (e) {
    return usage((e as Error).message);
  }

  loadEnv();
  muteRateLimitNoise();
  const env = process.env;
  const cfg = resolveNetwork(network, env);
  const relay: RelayMode = v.relay;
  const mainnet = network === "mainnet";
  const signers = new Map<string, string>();
  const real = realTransport({ network, relay, env });
  const remember = async (p: Promise<PaidTx>) => {
    const t = await p;
    signers.set(t.txHash, t.signerId);
    return t;
  };
  const transport: Transport = { pay: (a) => remember(real.pay(a)), transfer: (a) => remember(real.transfer(a)) };
  const buyerAccount = v.buyer ?? "e2e-buyer.arrowhq.testnet";
  const sellerAccount = v.seller ?? "e2e-seller.arrowhq.testnet";
  const actor = (role: "buyer" | "seller", flags: { demoKey?: boolean } = {}) =>
    mainnet ? resolveActor("mainnet", role, flags) : resolveActor("testnet", role, { ...flags, account: role === "buyer" ? buyerAccount : sellerAccount });
  const buyer = actor("buyer");
  const seller = actor("seller");
  const repo = repoRoot();
  const workDir = mkdtempSync(join(tmpdir(), "arrow-e2e-main-"));

  const ctx: Ctx = {
    network,
    views: makeViews(network, env),
    transport,
    actor: (role, flags) => actor(role, flags),
    confirm: async () => {},
    evidence: (run) => appendRun(network, { ...run, script: SCRIPT }),
    progress: (l) => log(l),
  };

  const releaseFile = (name: string) => resolve(repo, "release", name);
  const readSha = (path: string) => (existsSync(path) ? /[0-9a-f]{64}/i.exec(readFileSync(path, "utf8"))?.[0]?.toLowerCase() : undefined);
  const frozen = readSha(releaseFile("sha256.txt"));
  const candidate = readSha(releaseFile("arrow-tee-rc.sha256"));
  const release: ReleaseSha | null = frozen
    ? { sha: frozen, source: "release/sha256.txt", frozen: true }
    : !mainnet && candidate
      ? { sha: candidate, source: "release/arrow-tee-rc.sha256", frozen: false }
      : null;

  const buyer0x = buyer.id as `0x${string}`;
  const relayerAccountId = env.RELAYER_ACCOUNT_ID || "arrow-relayer.arrowhq.near";
  const deps: MainnetDeps = {
    ctx, dry: !mainnet, buyerId: buyer.id, sellerId: seller.id, contract: cfg.contract, release,
    balanceOf: mainnet
      ? (id) => mtBalanceOf("mainnet", id)
      : async (id) => big(await view<string>("testnet", cfg.usdcToken, "ft_balance_of", { account_id: id })),
    host: v["blob-base"]
      ? repoBlobHost(v["blob-base"], repo)
      : mainnet
        ? async () => { throw new Error("--blob-base is required on mainnet (raw URL prefix of the freeze commit's fixtures/blobs/e2e)"); }
        : fastfsHost(seller.id, workDir),
    keys: fileKeys(resolve(configDir(), "e2e-keys.json")),
    txEvents: async (hash) => parseEvents(await txStatus(network, hash, signers.get(hash) ?? (mainnet ? relayerAccountId : buyer.id), "NONE")),
    evidenceRuns: () => readEvidence(network).runs.filter((r) => r.script === SCRIPT),
    confirm: (plan) => confirmSpend(plan, !!v.yes),
    repo, workDir,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    stamp: new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"),
    say: (l) => console.log(l), // summaries hold no secrets; log() would also mask the 0x… hash in a Base explorer link
  };

  if (mainnet) {
    deps.base = { usdc: () => usdcBalance(buyer0x), eth: () => ethBalance(buyer0x) };
    deps.inboundQuote = async (units) => big((await oneclick.quote(oneclick.inboundQuoteRequest({ amount: units.toString(), evm: buyer0x, dry: true }))).quote.amountOut);
    const solana = () => {
      const a = env.SOLANA_PAYOUT_ADDRESS;
      if (!a) throw new Error("SOLANA_PAYOUT_ADDRESS is empty in .env (H-04)");
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) throw new Error("SOLANA_PAYOUT_ADDRESS is not a base58 Solana address");
      return a;
    };
    deps.outboundQuote = async (units) => big((await oneclick.quote(oneclick.outboundQuoteRequest({ amount: units.toString(), sellerEvm: seller.id as `0x${string}`, solana: solana(), dry: true }))).quote.amountOut);
    if (relay === "direct") {
      deps.relayerCheck = async () => {
        const key = env.RELAYER_PRIVATE_KEY;
        if (!key) return { problems: ["RELAYER_PRIVATE_KEY is empty (H-07)"], warnings: [] };
        const publicKey = KeyPair.fromString(key as `ed25519:${string}`).getPublicKey().toString();
        let permission;
        try {
          permission = (await viewAccessKey("mainnet", relayerAccountId, publicKey)).permission;
        } catch (e) {
          return { problems: [`${relayerAccountId}: ${(e as Error).message}`], warnings: [] };
        }
        const { amount } = await viewAccount("mainnet", relayerAccountId);
        return { problems: keyProblems(permission, { receiver: "intents.near", methods: INTENTS_METHODS }), warnings: balanceWarnings(amount) };
      };
    }
    deps.inbound = async (units) => {
      const wallet = env.E2E_BUYER_EVM_PRIVATE_KEY as `0x${string}`;
      let attempts = 0;
      for (const slippageBps of [oneclick.DEFAULT_SLIPPAGE_BPS, 100]) {
        attempts++;
        const q = await oneclick.quote(oneclick.inboundQuoteRequest({ amount: units.toString(), evm: buyer0x, dry: false, slippageBps }));
        const deposit = q.quote.depositAddress;
        if (!deposit) throw new Error("real quote returned no depositAddress");
        const before = await mtBalanceOf("mainnet", buyer0x);
        const sentAt = Date.now();
        const baseTx = await sendUsdc(wallet, deposit as `0x${string}`, units);
        console.log(`base tx ${explorerTx("mainnet", "base", baseTx)}`);
        const receipt = await waitReceipt(baseTx);
        if (receipt.status !== "success") throw new Error(`Base transfer reverted: ${baseTx}`);
        await oneclick.submitDeposit({ txHash: baseTx, depositAddress: deposit });
        const final = await oneclick.waitForStatus(deposit, { timeoutMs: 600_000, onTick: (s, ms) => log(`inbound status ${s.status} · ${Math.round(ms / 1000)} s`) });
        const after = await mtBalanceOf("mainnet", buyer0x);
        const res: InboundResult = { status: final.status, baseTx, deposit, seconds: Math.round((Date.now() - sentAt) / 1000), block: Number(receipt.blockNumber), before, after, attempts };
        if (final.status !== "REFUNDED") return res;
        if (attempts === 2) return res;
        log("inbound REFUNDED to the Base wallet: trying once more with slippage 100");
      }
      throw new Error("unreachable");
    };
    deps.outbound = async (units) => {
      const solanaAddress = solana();
      const sellerKey = actor("seller").evm!;
      const q = await oneclick.quote(oneclick.outboundQuoteRequest({ amount: units.toString(), sellerEvm: seller.id as `0x${string}`, solana: solanaAddress, dry: false }));
      const deposit = q.quote.depositAddress;
      if (!deposit) throw new Error("1Click returned no deposit address for the outbound quote");
      const { generateIntent, submitIntent, waitForStatus } = oneclick;
      let route: OutboundResult["route"] = "generate-intent";
      let nearTx: string | null = null;
      try {
        const { intent } = await generateIntent({ signerId: seller.id, depositAddress: deposit });
        if (intent.standard !== "erc191" || typeof intent.payload !== "string") throw new Error(`1Click returned a ${intent.standard} payload, ERC-191 expected`);
        await submitIntent(await signRawErc191(intent.payload, sellerKey));
      } catch (e) {
        // D4-09 (2): a plain ERC-191 transfer intent to the quote's deposit address through our relayer, then tell 1Click about it
        log(`generate-intent route failed (${mask((e as Error).message).slice(0, 120)}): falling back to a transfer intent to the deposit address`);
        route = "deposit-transfer";
        const tx = await transport.transfer({ actor: actor("seller"), toId: deposit, amount: units });
        nearTx = tx.txHash;
        await oneclick.submitDeposit({ txHash: tx.txHash, depositAddress: deposit, nearSenderAccount: seller.id });
      }
      const final = await waitForStatus(deposit, { timeoutMs: 600_000, onTick: (s, ms) => log(`outbound status ${s.status} · ${Math.round(ms / 1000)} s`) });
      return { status: final.status, deposit, solTx: destinationTxHash(final), route, nearTx };
    };
  }

  try {
    const report = await runE2eMainnet(deps, { from, only, dryPlan: v["dry-plan"], skipInbound: v["skip-inbound"], skipOutbound: v["skip-outbound"] });
    return report.exit;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)).catch((e) => (console.error(mask(e instanceof Error ? e.message : String(e))), 1)));
}
