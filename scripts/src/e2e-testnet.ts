// WS4-T10 (K2): the whole market path on testnet, every step recorded in evidence/testnet.json.
//   npx tsx scripts/src/e2e-testnet.ts [--blob-base <https prefix>] [--buyer <acct>] [--seller <acct>] [--steps 0-8]
//                                      [--ai | --no-ai] [--listing-ids L1,L2,L3] [--publish-demo [--listings-out <file>]]
// 0 preflight · 1 mint · 2 list x3 · 3 eval L1 (PASS) · 4 eval L2 (BUY) · 5 buy L2 · 6 decrypt + hash equality
// · 7 eval on the broken-host listing -> refund + balance back · 8 leak budget counters.
// Steps 3 and 4 need the NEAR AI key inside the OutLayer secret; without it they are skipped ("waiting H-01a") and
// everything else still runs. Exit: 0 all green (WARN allowed), 1 a step failed, 3 steps were skipped.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Account } from "near-api-js";
import {
  BITS_PER_EVAL_MILLI, bytesToHex, encryptFile, fetchAndCheckBlob, formatUsdc, hexToBytes, type NearEvent, NETWORKS, parseEvents,
  prepareList, resolveNetwork, sha256Hex, txStatus, view,
} from "@arrow/sdk";
import { buyCommand, type Ctx, evalCommand, type EvalResult } from "../../agent/src/commands.ts";
import { configDir, resolveActor } from "../../agent/src/keys.ts";
import { readTable } from "../../agent/src/data.ts";
import { findEventId, SettleTimeout } from "../../agent/src/settle.ts";
import { type PaidTx, muteRateLimitNoise, realTransport, retryRateLimited, rpcProvider } from "../../agent/src/transport.ts";
import { makeViews } from "../../agent/src/views.ts";
import { loadEnv, repoRoot } from "./lib/env.ts";
import { appendRun } from "./lib/evidence.ts";
import { explorerTx, log, mask } from "./lib/log.ts";

export type Status = "PASS" | "WARN" | "FAIL" | "SKIP";
export interface StepResult {
  n: number;
  status: Status;
  summary: string;
  link?: string;
}
type Slot = "L1" | "L2" | "L3";

const SCRIPT = "scripts/src/e2e-testnet.ts";
const UNLOCK = "fixtures/demo/unlock-schedule-412.csv";
const LABELS = "fixtures/demo/wallet-labels-1000.csv";
// DEC K-06 demo prices: price 2.00, eval fee 0.25 USDC.
const PRICE = "2000000";
const EVAL_FEE = "250000";
const MINT_AMOUNT = 10_000_000n;
const MIN_BALANCE = 5_000_000n;
const MAX_EVALS = 50;
const BROKEN_HOST = (sha: string) => `https://blob-host-missing.invalid/${sha}.bin`;

const LISTING_SPECS: Record<Slot, { file: string; title: string; desc: string }> = {
  L1: { file: UNLOCK, title: "[synthetic] e2e unlock schedule", desc: "Synthetic end-to-end test data: a fictional Q1 2027 token unlock schedule. Made by the Arrow team." },
  L2: { file: LABELS, title: "[synthetic] e2e wallet labels", desc: "Synthetic end-to-end test data: fictional labels for 1,000 NEAR DeFi wallets. Made by the Arrow team." },
  L3: { file: LABELS, title: "[synthetic] e2e broken host", desc: "Synthetic end-to-end test data. The ciphertext host is missing on purpose, so every eval must refund." },
};

export interface E2eDeps {
  ctx: Ctx;
  buyerId: string;
  sellerId: string;
  /** The NEAR AI key is believed to be in the OutLayer secret; steps 3 and 4 run only then. */
  hasAi: boolean;
  balanceOf(accountId: string): Promise<bigint>;
  mint(accountId: string, amount: bigint): Promise<PaidTx>;
  /** Makes the ciphertext available over https and returns the URL; throws unless that URL serves exactly these bytes. */
  host(blob: Uint8Array, sha256: string): Promise<string>;
  txEvents(txHash: string, signerId: string): Promise<NearEvent[]>;
  /** K and nonce for a plaintext, created on first use and kept outside the repo so the ciphertext stays the same. */
  keys(plaintextSha: string, source: string): { key: Uint8Array; nonce: Uint8Array };
  repo: string;
  workDir: string;
  sleep(ms: number): Promise<void>;
  /** Compact UTC stamp that makes evidence ids unique per run. */
  stamp: string;
  say(line: string): void;
}

export interface E2eOpts {
  steps: Set<number>;
  listingIds?: [number, number, number];
  publishDemo?: boolean;
  listingsOut?: string;
}

export interface E2eReport {
  results: StepResult[];
  listingIds: Partial<Record<Slot, number>>;
  exit: number;
  summary: string;
}

const copy = (b: Uint8Array) => new Uint8Array(b);
const parseU128 = (v: unknown) => BigInt(String(v));
const items = (e: NearEvent): any[] => (Array.isArray(e.data) ? e.data : [e.data]);
const isRefundMemo = (m: unknown) => m === "refund" || (typeof m === "string" && m.startsWith("arrow:refund:"));
const nearTx = (hash: string) => explorerTx("testnet", "near", hash);

export async function runE2e(deps: E2eDeps, opts: E2eOpts): Promise<E2eReport> {
  const { buyerId, sellerId } = deps;
  const wait = (step: number) => opts.steps.has(step);
  const ctx: Ctx = { ...deps.ctx, evidence: (run) => deps.ctx.evidence({ ...run, id: `e2e-${deps.stamp}-${run.id.replace(/^cli-/, "")}` }) };
  const waitDeps = () => ({ network: "testnet" as const, views: ctx.views, ...ctx.wait });
  const record = (id: string, run: Omit<Parameters<Ctx["evidence"]>[0], "id">) => deps.ctx.evidence({ ...run, id: `e2e-${deps.stamp}-${id}` });
  const usdc = NETWORKS.testnet.usdcToken;

  const S = {
    programPk: "",
    programHash: "",
    ids: {} as Partial<Record<Slot, number>>,
    /** evals_used of resumed listings before this run; listings made in this run start at 0 */
    base: { L1: 0, L2: 0, L3: 0 } as Record<Slot, number>,
    accepted: { L1: 0, L2: 0, L3: 0 } as Record<Slot, number>,
    evalDone: { L1: false, L2: false },
    bought: undefined as undefined | Awaited<ReturnType<typeof buyCommand>>,
  };
  if (opts.listingIds) (["L1", "L2", "L3"] as const).forEach((s, i) => (S.ids[s] = opts.listingIds![i]));

  // ------------------------------------------------------------------ steps
  async function preflight(): Promise<StepResult> {
    const v = await ctx.views.version();
    const cfg = await ctx.views.config();
    const c = cfg.config as { outlayer?: string; program_wasm_hash?: string };
    const pk = await ctx.views.programPubkey();
    const problems: string[] = [];
    if (v.build !== "testnet") problems.push(`build is ${v.build}, not testnet`);
    if (cfg.paused) problems.push("contract is paused");
    if (c.outlayer !== "outlayer.testnet") problems.push(`outlayer is ${c.outlayer}`);
    if (!pk || !/^04[0-9a-f]{128}$/.test(pk)) problems.push("program_pubkey is not 130 hex");
    if (parseU128(cfg.tank_available) < 900_000_000_000_000_000_000_000n) problems.push("gas tank below 0.9 NEAR");
    for (const [role, id] of [["buyer", buyerId], ["seller", sellerId]] as const) {
      if (!ctx.actor(role).nearSecret) problems.push(`no NEAR key for ${id}`);
    }
    if (problems.length) return { n: 0, status: "FAIL", summary: problems.join("; ") };
    S.programPk = pk!;
    S.programHash = c.program_wasm_hash ?? "";
    for (const slot of ["L1", "L2", "L3"] as const) {
      if (S.ids[slot] !== undefined) S.base[slot] = (await ctx.views.leakBudget(S.ids[slot]!))?.evals_used ?? 0;
    }
    const bal = await Promise.all([sellerId, buyerId].map((a) => deps.balanceOf(a)));
    return {
      n: 0, status: "PASS",
      summary: `${v.name} ${v.version} build=${v.build} path=${v.payment_path}/${v.result_path} · program_pubkey ${pk!.slice(0, 10)}… · program ${S.programHash.slice(0, 8)}… · aUSD seller ${formatUsdc(bal[0])} buyer ${formatUsdc(bal[1])} · NEAR AI key in secret: ${deps.hasAi ? "assumed yes" : "no (steps 3, 4 wait H-01a)"}`,
    };
  }

  async function mint(): Promise<StepResult> {
    const done: string[] = [];
    let last: PaidTx | undefined;
    for (const id of [sellerId, buyerId]) {
      const before = await deps.balanceOf(id);
      if (before >= MIN_BALANCE) {
        done.push(`${id.split(".")[0]} has ${formatUsdc(before)}`);
        continue;
      }
      const tx = await deps.mint(id, MINT_AMOUNT);
      let after = before;
      for (let i = 0; i < 20 && after < before + MINT_AMOUNT; i++) {
        await deps.sleep(2000);
        after = await deps.balanceOf(id);
      }
      if (after < before + MINT_AMOUNT) return { n: 1, status: "FAIL", summary: `mint to ${id} not visible after 40 s`, link: tx.url };
      record(`mint-${id.split(".")[0]}`, { kind: "spike", tx: tx.txHash, chain: "near", block_height: null, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: `mint: ${formatUsdc(MINT_AMOUNT)} aUSD to ${id}`, observed: `balance ${formatUsdc(before)} -> ${formatUsdc(after)}` });
      done.push(`minted ${formatUsdc(MINT_AMOUNT)} to ${id.split(".")[0]}`);
      last = tx;
    }
    return { n: 1, status: "PASS", summary: done.join(" · "), link: last?.url };
  }

  async function listOne(slot: Slot, spec: { file: string; title: string; desc: string; price: string; evalFee: string }, broken: boolean): Promise<{ id: number; tx: PaidTx; sha: string }> {
    const plain = new Uint8Array(readFileSync(join(deps.repo, spec.file)));
    const table = readTable(join(deps.repo, spec.file));
    const { key, nonce } = deps.keys(sha256Hex(plain), spec.file);
    const probe = encryptFile(plain, copy(key), nonce);
    const blobUrl = broken ? BROKEN_HOST(probe.blobSha256) : await deps.host(probe.blob, probe.blobSha256);
    const seller = ctx.actor("seller");
    const prepared = prepareList({
      plaintext: plain, title: spec.title, publicDesc: spec.desc, columns: table.columns, rowsClaimed: table.rows, blobUrl,
      price: spec.price, evalFee: spec.evalFee, maxEvals: MAX_EVALS, mode: "scored", programPk: S.programPk, seller: seller.id, key: copy(key), nonce,
    });
    if (prepared.blobSha256 !== probe.blobSha256) throw new Error("ciphertext is not reproducible (key/nonce store changed?)");
    const cfg = await ctx.views.config();
    const bond = BigInt(String((cfg.config as { listing_bond?: string }).listing_bond ?? "100000"));
    const tx = await ctx.transport.pay({ actor: seller, amount: bond, msg: prepared.msg });
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
    return { id, tx, sha: prepared.blobSha256 };
  }

  async function list(): Promise<StepResult> {
    const out: string[] = [];
    const links: string[] = [];
    const common = { price: PRICE, evalFee: EVAL_FEE };
    for (const [slot, broken] of [["L1", false], ["L2", false], ["L3", true]] as const) {
      const r = await listOne(slot, { ...LISTING_SPECS[slot], ...common }, broken);
      S.ids[slot] = r.id;
      out.push(`${slot}=#${r.id}`);
      links.push(r.tx.url);
    }
    return { n: 2, status: "PASS", summary: `listed ${out.join(" ")} (3 listings, price 2.00, eval fee 0.25 aUSD)`, link: links[0] };
  }

  const critPath = (name: string) => join(deps.repo, "fixtures/criteria", name);

  async function evalOnce(slot: Slot, criteria: string): Promise<EvalResult> {
    const id = S.ids[slot]!;
    const res = await evalCommand(ctx, { listingId: id, criteria });
    S.accepted[slot]++;
    return res;
  }
  /** A refund with reason "null" is OutLayer's yield timeout, not a verdict about the data: one retry (card T10). */
  async function evalRetry(slot: Slot, criteria: string): Promise<EvalResult> {
    const r = await evalOnce(slot, criteria);
    return r.status === "refunded" && r.refund_reason === "null" ? evalOnce(slot, criteria) : r;
  }
  const verdictText = (r: EvalResult) => `${r.verdict} · fit ${r.fit}/5 · novelty ${r.novelty ?? "n/a"}/5 · eval #${r.eval_id}`;

  async function evalPass(): Promise<StepResult> {
    if (!deps.hasAi) return { n: 3, status: "SKIP", summary: "waiting H-01a (NEARAI_API_KEY is not in the OutLayer secret)" };
    if (S.ids.L1 === undefined) return { n: 3, status: "SKIP", summary: "needs step 2 (or --listing-ids)" };
    const r = await evalRetry("L1", critPath("demo.json"));
    if (r.status === "refunded") return { n: 3, status: "FAIL", summary: `eval #${r.eval_id} refunded (${r.refund_reason})`, link: r.tx_url };
    S.evalDone.L1 = true;
    // novelty 1 < min_novelty 3 is a structural gate: BUY here would be a bug whatever the model says.
    if (r.verdict !== "PASS") return { n: 3, status: "FAIL", summary: `expected PASS, got ${verdictText(r)}`, link: r.tx_url };
    return { n: 3, status: "PASS", summary: verdictText(r), link: r.tx_url };
  }

  async function evalBuy(): Promise<StepResult> {
    if (!deps.hasAi) return { n: 4, status: "SKIP", summary: "waiting H-01a (NEARAI_API_KEY is not in the OutLayer secret)" };
    if (S.ids.L2 === undefined) return { n: 4, status: "SKIP", summary: "needs step 2 (or --listing-ids)" };
    let r = await evalRetry("L2", critPath("demo-buy.json"));
    if (r.status === "done" && r.verdict !== "BUY") r = await evalRetry("L2", critPath("demo-buy.json"));
    if (r.status === "refunded") return { n: 4, status: "FAIL", summary: `eval #${r.eval_id} refunded (${r.refund_reason})`, link: r.tx_url };
    S.evalDone.L2 = true;
    if (r.verdict === "BUY") return { n: 4, status: "PASS", summary: verdictText(r), link: r.tx_url };
    return { n: 4, status: "WARN", summary: `BUY scene not reproduced; LLM verdict ${verdictText(r)}`, link: r.tx_url };
  }

  async function buy(): Promise<StepResult> {
    const id = S.ids.L2;
    if (id === undefined) return { n: 5, status: "SKIP", summary: "needs step 2 (or --listing-ids)" };
    const out = join(deps.workDir, `l2-${id}.csv`);
    const r = await buyCommand(ctx, { listingId: id, out });
    S.bought = r;
    if (r.status === "refunded") return { n: 5, status: "FAIL", summary: `purchase #${r.purchase_id} refunded (${r.refund_reason})`, link: r.tx_url };
    return { n: 5, status: "PASS", summary: `bought listing #${id} for 2.00 aUSD · purchase #${r.purchase_id} · sealed key released`, link: r.tx_url };
  }

  async function decrypt(): Promise<StepResult> {
    const b = S.bought;
    if (!b?.decrypt) return { n: 6, status: "SKIP", summary: "needs step 5" };
    const d = b.decrypt;
    const bad = d.checks.filter((c) => !c.ok);
    if (bad.length) return { n: 6, status: "FAIL", summary: `hash check failed: ${bad.map((c) => c.label).join("; ")}` };
    // sha256(plaintext) against the value the demo generator wrote down
    const expected = JSON.parse(readFileSync(join(deps.repo, "fixtures/demo/expected.json"), "utf8")).plaintext_sha256?.["wallet-labels-1000.csv"] as string | undefined;
    const got = d.out ? sha256Hex(new Uint8Array(readFileSync(d.out))) : undefined;
    if (d.out) rmSync(d.out, { force: true });
    if (!expected || got !== expected) return { n: 6, status: "FAIL", summary: `sha256(plaintext) ${got?.slice(0, 12)}… != expected ${expected?.slice(0, 12)}…` };
    const evalLeg = d.checks.some((c) => c.label.startsWith("eval.h == listing.blob_sha256 (eval #"));
    const core = "listing.blob_sha256 == purchase.h == sha256(download) == " + (evalLeg ? "eval.h" : "(eval.h not exercised)") + " · sha256(plaintext) == fixtures/demo/expected.json";
    return evalLeg
      ? { n: 6, status: "PASS", summary: `${core} · sha256 match` }
      : { n: 6, status: "WARN", summary: `${core} · eval.h leg waits for a completed eval on this listing (H-01a)` };
  }

  async function refundEval(): Promise<StepResult> {
    const id = S.ids.L3;
    if (id === undefined) return { n: 7, status: "SKIP", summary: "needs step 2 (or --listing-ids)" };
    const before = await deps.balanceOf(buyerId);
    let r = await evalOnce("L3", critPath("demo-buy.json"));
    if (r.status === "refunded" && r.refund_reason === "null") r = await evalOnce("L3", critPath("demo-buy.json"));
    if (r.status !== "refunded") return { n: 7, status: "FAIL", summary: `expected a refund, got ${verdictText(r)}`, link: r.tx_url };
    if (r.refund_reason !== "not_ok") return { n: 7, status: "FAIL", summary: `refund reason "${r.refund_reason}", expected "not_ok" (enclave fetch/ok:false)`, link: r.tx_url };
    const hash = r.tx;
    let refund: any;
    let transfer: any;
    for (let i = 0; i < 20 && !(refund && transfer); i++) {
      const events = await deps.txEvents(hash, buyerId).catch(() => []);
      refund = events.filter((e) => e.standard === "arrow" && e.event === "arrow_refund").flatMap(items).find((d) => d.kind === "eval" && Number(d.id) === r.eval_id);
      transfer = events.filter((e) => e.standard === "nep141" && e.event === "ft_transfer" && e.executorId === usdc).flatMap(items).find((d) => isRefundMemo(d.memo) && d.new_owner_id === buyerId);
      if (!(refund && transfer)) await deps.sleep(3000);
    }
    if (!refund) return { n: 7, status: "FAIL", summary: "no arrow_refund event in the payment transaction", link: r.tx_url };
    if (!transfer) return { n: 7, status: "FAIL", summary: "arrow_refund seen but no NEP-141 ft_transfer with memo refund back to the buyer", link: r.tx_url };
    // A failed eval keeps the treasury's fee_bps_eval share of the fee; the rest comes back.
    const bps = (await ctx.views.config()).config as { fee_bps_eval?: number };
    const kept = (BigInt(EVAL_FEE) * BigInt(bps.fee_bps_eval ?? 1000)) / 10_000n;
    const back = String(BigInt(EVAL_FEE) - kept);
    if (String(refund.amount) !== back || String(transfer.amount) !== back) return { n: 7, status: "FAIL", summary: `refund amounts: arrow_refund ${refund.amount}, ft_transfer ${transfer.amount}, expected ${back} (eval fee ${EVAL_FEE} less the ${kept} treasury share)`, link: r.tx_url };
    let after = await deps.balanceOf(buyerId);
    for (let i = 0; i < 10 && after !== before - kept; i++) {
      await deps.sleep(3000);
      after = await deps.balanceOf(buyerId);
    }
    if (after !== before - kept) return { n: 7, status: "FAIL", summary: `buyer balance ${formatUsdc(before)} before, ${formatUsdc(after)} after the refund (expected ${formatUsdc(before - kept)})`, link: r.tx_url };
    const base = `arrow_refund{reason:"not_ok"} + ft_transfer memo refund ${formatUsdc(BigInt(back))} aUSD + buyer balance ${formatUsdc(after)} (the treasury kept ${formatUsdc(kept)})`;
    return deps.hasAi
      ? { n: 7, status: "PASS", summary: base, link: r.tx_url }
      : { n: 7, status: "WARN", summary: `${base}; the refund mechanics are proven, the cause is not isolated: with no NEAR AI key in the secret every eval refunds before the blob is fetched (H-01a)`, link: r.tx_url };
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
    if (problems.length) return { n: 8, status: "FAIL", summary: problems.join("; ") };
    if (seen.length === 0) return { n: 8, status: "SKIP", summary: "needs step 2" };
    const l3 = S.accepted.L3 > 0 ? " · the refunded L3 eval still counts (never decremented)" : "";
    return { n: 8, status: "PASS", summary: `${seen.join(" · ")}${l3}` };
  }

  // ------------------------------------------------------------------ run
  const plan: [number, () => Promise<StepResult>][] = [
    [0, preflight], [1, mint], [2, list], [3, evalPass], [4, evalBuy], [5, buy], [6, decrypt], [7, refundEval], [8, leakBudget],
  ];
  const results: StepResult[] = [];
  const emit = (r: StepResult) => {
    results.push(r);
    deps.say(`[${r.status}] step ${r.n} · ${r.summary}${r.link ? ` · ${r.link}` : ""}`);
  };
  for (const [n, fn] of plan) {
    if (n !== 0 && !wait(n)) continue;
    try {
      const r = await fn();
      if (n === 0 && !wait(0) && r.status === "PASS") continue; // preflight data is always collected, only printed on request
      emit(r);
      if (n === 0 && r.status === "FAIL") break;
    } catch (e) {
      emit({ n, status: "FAIL", summary: e instanceof SettleTimeout ? e.message : mask(e instanceof Error ? e.message : String(e)) });
    }
  }

  if (opts.publishDemo) await publishDemo(deps, opts, S, emit, record).catch((e) => emit({ n: 9, status: "FAIL", summary: `publish-demo: ${mask(String(e instanceof Error ? e.message : e))}` }));

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  const green = count("PASS") + count("WARN");
  const summary = `E2E testnet: ${green}/${results.length} steps green` + (count("WARN") ? ` (${count("WARN")} WARN)` : "") + (count("SKIP") ? ` · ${count("SKIP")} skipped (waiting H-01a / earlier step)` : "") + (count("FAIL") ? ` · ${count("FAIL")} FAILED` : "");
  deps.say(summary);
  return { results, listingIds: S.ids, exit: count("FAIL") ? 1 : count("SKIP") ? 3 : 0, summary };
}

/** Freeze-time only: lists the two demo scenes under their public titles and writes fixtures/testnet-listings.json. */
async function publishDemo(
  deps: E2eDeps, opts: E2eOpts, S: { programPk: string; programHash: string }, emit: (r: StepResult) => void, record: (id: string, run: Omit<Parameters<Ctx["evidence"]>[0], "id">) => void,
): Promise<void> {
  const { SPECS } = await import("./make-demo-blobs.ts");
  if (!S.programPk) throw new Error("preflight did not run");
  const ids: number[] = [];
  for (const [slot, spec] of [["demo-pass", SPECS.unlock], ["demo-buy", SPECS.labels]] as const) {
    const plain = new Uint8Array(readFileSync(join(deps.repo, spec.file)));
    const table = readTable(join(deps.repo, spec.file));
    const { key, nonce } = deps.keys(sha256Hex(plain), spec.file);
    const probe = encryptFile(plain, copy(key), nonce);
    const blobUrl = await deps.host(probe.blob, probe.blobSha256);
    const seller = deps.ctx.actor("seller");
    const prepared = prepareList({ plaintext: plain, title: spec.title, publicDesc: spec.public_desc, columns: table.columns, rowsClaimed: table.rows, blobUrl, price: spec.price, evalFee: spec.eval_fee, maxEvals: MAX_EVALS, mode: "scored", programPk: S.programPk, seller: seller.id, key: copy(key), nonce });
    const cfg = await deps.ctx.views.config();
    const bond = BigInt(String((cfg.config as { listing_bond?: string }).listing_bond ?? "100000"));
    const tx = await deps.ctx.transport.pay({ actor: seller, amount: bond, msg: prepared.msg });
    const { id, rejection } = await findEventId({ network: "testnet", views: deps.ctx.views, ...deps.ctx.wait }, tx, "arrow_listed", "listing_id");
    if (id === undefined) throw new Error(`the market refused ${slot}: ${rejection}`);
    record(`publish-${slot}-${id}`, { kind: "list", tx: tx.txHash, chain: "near", block_height: null, listing_id: id, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "demo listing created", observed: `listed #${id} (${slot})` });
    ids.push(id);
  }
  const out = opts.listingsOut ?? join(deps.repo, "fixtures/testnet-listings.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ contract: NETWORKS.testnet.contract, program_wasm_sha256: S.programHash, pass_listing_id: ids[0], buy_listing_id: ids[1], created_utc: new Date().toISOString().slice(0, 19) + "Z" }, null, 2) + "\n");
  emit({ n: 9, status: "PASS", summary: `published demo listings pass=#${ids[0]} buy=#${ids[1]} -> ${out}` });
}

// ---------------------------------------------------------------------- real dependencies

/** Random K and nonce, stored per `scope` (network and contract) and plaintext: the same demo file listed on testnet and on mainnet gets two
 * unrelated keys, so a free testnet purchase never reveals the key of a mainnet listing. */
export function fileKeys(path: string, scope: string): E2eDeps["keys"] {
  return (plaintextSha, source) => {
    const store: Record<string, { k_hex: string; nonce_hex: string; source: string; created_utc: string }> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const slot = `${scope}|${plaintextSha}`;
    let e = store[slot];
    if (!e) {
      const c = globalThis.crypto;
      e = { k_hex: bytesToHex(c.getRandomValues(new Uint8Array(32))), nonce_hex: bytesToHex(c.getRandomValues(new Uint8Array(24))), source, created_utc: new Date().toISOString() };
      store[slot] = e;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    return { key: hexToBytes(e.k_hex), nonce: hexToBytes(e.nonce_hex) };
  };
}

export async function serves(url: string, sha: string): Promise<boolean> {
  try {
    await fetchAndCheckBlob(url, sha);
    return true;
  } catch {
    return false;
  }
}

/** testnet FastFS (repo is private, DEC K-03): `outlayer upload` signed by the seller; the CLI login is global, so it logs in first. */
export function fastfsHost(sellerId: string, workDir: string): E2eDeps["host"] {
  return async (blob, sha) => {
    const guess = `https://test.fastfs.io/${sellerId}/outlayer.testnet/${sha}.bin`;
    if (await serves(guess, sha)) return guess;
    const credentials = join(process.env.HOME ?? "", ".near-credentials/testnet", `${sellerId}.json`);
    const privateKey = JSON.parse(readFileSync(credentials, "utf8")).private_key as string;
    const file = join(workDir, `${sha}.bin`);
    writeFileSync(file, blob);
    const env = { ...process.env, OUTLAYER_NETWORK: "testnet" };
    const login = spawnSync("outlayer", ["login", "testnet"], { input: `${sellerId}\n${privateKey}\n`, env, encoding: "utf8" });
    if (login.status !== 0) throw new Error(`outlayer login as ${sellerId} failed`);
    const up = spawnSync("outlayer", ["upload", file], { env, encoding: "utf8" });
    const url = /https:\/\/\S*fastfs\.io\/\S+/.exec(`${up.stdout}\n${up.stderr}`)?.[0]?.replace(/[)\].,]+$/, "");
    if (up.status !== 0 || !url) throw new Error(`outlayer upload failed (exit ${up.status})`);
    for (let i = 0; i < 72; i++) {
      if (await serves(url, sha)) return url;
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error(`${url} does not serve the ciphertext six minutes after the upload (FastFS indexing is slow and uneven) (sha256 ${sha}, ${blob.length} bytes)`);
  };
}

function baseHost(base: string, workDir: string): E2eDeps["host"] {
  return async (blob, sha) => {
    const url = `${base.replace(/\/+$/, "")}/${sha}.bin`;
    if (await serves(url, sha)) return url;
    const file = join(workDir, `${sha}.bin`);
    writeFileSync(file, blob);
    throw new Error(`${url} does not serve the ciphertext: upload ${file} (sha256 ${sha}) and rerun`);
  };
}

function parseSteps(s: string): Set<number> {
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const m = /^(\d)(?:-(\d))?$/.exec(part.trim());
    if (!m) throw new Error(`--steps: "${part}" is not N or N-M`);
    for (let i = Number(m[1]); i <= Number(m[2] ?? m[1]); i++) out.add(i);
  }
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const { values: f } = parseArgs({
    args: argv,
    options: {
      "blob-base": { type: "string" }, buyer: { type: "string" }, seller: { type: "string" }, steps: { type: "string" },
      ai: { type: "boolean" }, "no-ai": { type: "boolean" }, "listing-ids": { type: "string" },
      "publish-demo": { type: "boolean" }, "listings-out": { type: "string" }, help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (f.help) {
    console.log("usage: npx tsx scripts/src/e2e-testnet.ts [--blob-base <https prefix>] [--buyer <acct>] [--seller <acct>] [--steps 0-8] [--ai|--no-ai] [--listing-ids L1,L2,L3] [--publish-demo [--listings-out <file>]]");
    return 0;
  }
  loadEnv();
  muteRateLimitNoise();
  const buyerId = f.buyer ?? "e2e-buyer.arrowhq.testnet";
  const sellerId = f.seller ?? "e2e-seller.arrowhq.testnet";
  const env = process.env;
  const cfg = resolveNetwork("testnet", env);
  const hasAi = f.ai ? true : f["no-ai"] ? false : (env.NEARAI_API_KEY ?? "").length > 0;
  const ids = f["listing-ids"]?.split(",").map(Number);
  if (ids && (ids.length !== 3 || ids.some((n) => !Number.isInteger(n) || n < 1))) throw new Error("--listing-ids needs three ids: L1,L2,L3");
  const workDir = mkdtempSync(join(tmpdir(), "arrow-e2e-"));
  const actor = (role: "buyer" | "seller") => resolveActor("testnet", role, { account: role === "buyer" ? buyerId : sellerId });
  const ctx: Ctx = {
    network: "testnet",
    views: makeViews("testnet", env),
    transport: realTransport({ network: "testnet", relay: "hosted", env }),
    actor: (role) => actor(role),
    confirm: async () => {},
    evidence: (run) => appendRun("testnet", { ...run, script: SCRIPT }),
    progress: (l) => log(l),
  };
  const deps: E2eDeps = {
    ctx, buyerId, sellerId, hasAi,
    balanceOf: async (id) => parseU128(await view<string>("testnet", cfg.usdcToken, "ft_balance_of", { account_id: id })),
    mint: async (id) => {
      const role = id === sellerId ? "seller" : "buyer";
      const a = actor(role);
      const account = new Account(a.id, rpcProvider("testnet", env), a.nearSecret!);
      const out = await retryRateLimited(() => account.callFunctionRaw({
        contractId: cfg.usdcToken, methodName: "mint", args: { receiver_id: id, amount: MINT_AMOUNT.toString() }, gas: 30_000_000_000_000n, waitUntil: "INCLUDED_FINAL",
      }));
      const txHash = out.transaction.hash as string;
      return { txHash, signerId: id, url: nearTx(txHash) };
    },
    host: f["blob-base"] ? baseHost(f["blob-base"], workDir) : fastfsHost(sellerId, workDir),
    txEvents: async (hash, signer) => parseEvents(await txStatus("testnet", hash, signer, "NONE")),
    keys: fileKeys(resolve(configDir(), "e2e-keys.json"), `testnet:${cfg.contract}`),
    repo: repoRoot(),
    workDir,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    stamp: new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"),
    say: (l) => log(l),
  };
  try {
    const report = await runE2e(deps, { steps: f.steps ? parseSteps(f.steps) : new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), listingIds: ids as [number, number, number] | undefined, publishDemo: f["publish-demo"], listingsOut: f["listings-out"] });
    return report.exit;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)).catch((e) => (console.error(mask(e instanceof Error ? e.message : String(e))), 1)));
}
