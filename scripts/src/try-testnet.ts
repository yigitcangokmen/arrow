// WS4-T14: the judge path. A fresh testnet account, test money, two evals, a purchase and a hash check, in about three minutes.
//   npm run try:testnet -- [--criteria <file>] [--with-list --blob-url <https> [--file <csv>]] [--reset]
//                          [--sponsor-url <url>] [--listings <file>] [--record]
// Scope (DEC P-01, D4-12): eval (PASS scene) -> eval (BUY scene) -> buy -> decrypt -> sha256 check. The judge cannot host a blob,
// so listing is shown by `npm run arrow -- list --dry-run` and the e2e evidence; `--with-list` lists a file if you host the blob.
// The account key and the decrypt key live in ~/.config/arrow/judge-testnet.json (mode 0600, outside the repo). Nothing is committed.
// Exit: 0 ok · 1 error · 2 a cap or the enclave stopped the run (see bench:offline).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Account, KeyPair } from "near-api-js";
import { formatUsdc, resolveNetwork, view, viewAccount } from "@arrow/sdk";
import { buyCommand, CliError, type Ctx, EXIT, evalCommand, type EvalResult, formatEval, listCommand } from "../../agent/src/commands.ts";
import { configDir, newScalarHex, resolveActor } from "../../agent/src/keys.ts";
import { muteRateLimitNoise, realTransport, retryRateLimited, rpcProvider } from "../../agent/src/transport.ts";
import { makeViews } from "../../agent/src/views.ts";
import { loadEnv, repoRoot } from "./lib/env.ts";
import { appendRun } from "./lib/evidence.ts";
import { log, mask } from "./lib/log.ts";

export const JUDGE_FILE = "judge-testnet.json";
export const MIN_NODE = [22, 22, 2] as const;
const MINT_AMOUNT = 10_000_000n;
const NEED_BALANCE = 3_000_000n; // two evals + one purchase of the demo listings cost 2.50 aUSD
const CAP_MESSAGE = "Testnet cap reached (10 evals/account/day, 400/day). See recorded results: npm run bench:offline";
const ENCLAVE_MESSAGE = "Enclave could not complete (NEAR AI credit or OutLayer). See: npm run bench:offline";
const FAUCET_URL = "https://helper.nearprotocol.com/account";
const DEFAULT_SITE = "arrow-market.vercel.app";

export interface DemoListings {
  contract: string;
  program_wasm_sha256: string;
  pass_listing_id: number;
  buy_listing_id: number;
  created_utc: string;
}

export interface TryDeps {
  ctx: Ctx;
  say(line: string): void;
  now(): number;
  /** Where the judge file lives; always outside the repo. */
  dir: string;
  nodeVersion: string;
  listings(): DemoListings;
  accountExists(accountId: string): Promise<boolean>;
  newKey(): { publicKey: string; secret: string };
  faucet(accountId: string, publicKey: string): Promise<{ ok: boolean; status: number }>;
  sponsor(publicKey: string): Promise<{ ok: true; accountId: string } | { ok: false; status: number; message: string; fallback?: string }>;
  balanceOf(accountId: string): Promise<bigint>;
  mint(accountId: string, secret: string, amount: bigint): Promise<void>;
  repo: string;
  /** The current program hash on chain, to detect stale demo listings. */
  programHash(): Promise<string>;
}

export interface TryOpts {
  criteria?: string;
  reset?: boolean;
  withList?: { blobUrl?: string; file?: string };
}

export class TryStop extends Error {
  constructor(message: string, public readonly exit: number = EXIT.error) {
    super(message);
    this.name = "TryStop";
  }
}

const atLeast = (v: string, min: readonly number[]) => {
  const a = v.split(".").map(Number);
  for (let i = 0; i < min.length; i++) if ((a[i] ?? 0) !== min[i]) return (a[i] ?? 0) > min[i];
  return true;
};
const sec = (ms: number) => `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;

interface Profile {
  account_id?: string;
  private_key?: string;
  buyer_scalar_hex?: string;
}
const profilePath = (dir: string) => join(dir, JUDGE_FILE);
const readProfile = (dir: string): Profile | undefined => (existsSync(profilePath(dir)) ? JSON.parse(readFileSync(profilePath(dir), "utf8")) : undefined);
function writeProfile(dir: string, p: Profile) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(profilePath(dir), JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  chmodSync(profilePath(dir), 0o600);
}

async function ensureAccount(d: TryDeps, reset: boolean): Promise<{ id: string; how: string }> {
  if (reset) rmSync(profilePath(d.dir), { force: true });
  const have = readProfile(d.dir);
  if (have?.account_id && have.private_key && (await d.accountExists(have.account_id))) return { id: have.account_id, how: "reused" };

  const key = d.newKey();
  const hex = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  const faucetId = `arrow-judge-${hex}.testnet`;
  let id: string | undefined;
  let how = "";
  const f = await d.faucet(faucetId, key.publicKey).catch(() => ({ ok: false, status: 0 }));
  if (f.ok) {
    id = faucetId;
    how = "faucet";
  } else {
    const s = await d.sponsor(key.publicKey).catch((e) => ({ ok: false as const, status: 0, message: String(e instanceof Error ? e.message : e) }));
    if (!s.ok) {
      const fallback = "fallback" in s && s.fallback ? `\n${s.fallback}` : "";
      throw new TryStop(`could not create a testnet account (faucet HTTP ${f.status}, sponsor ${s.status}: ${s.message}). Create one at https://near-faucet.io or run: npm run verify && npm run bench:offline${fallback}`, s.status === 429 ? EXIT.usage : EXIT.error);
    }
    id = s.accountId;
    how = "sponsor";
  }
  for (let i = 0; i < 15 && !(await d.accountExists(id)); i++) await new Promise((r) => setTimeout(r, 2000));
  if (!(await d.accountExists(id))) throw new TryStop(`account ${id} was not visible on testnet after 30 s; run again in a minute`);
  writeProfile(d.dir, { account_id: id, private_key: key.secret, buyer_scalar_hex: newScalarHex() });
  return { id, how };
}

function capOrRethrow(e: unknown): never {
  const text = e instanceof Error ? e.message : String(e);
  if (/Arrow: E1[12]\b/.test(text)) throw new TryStop(CAP_MESSAGE, EXIT.usage);
  throw e;
}

export interface TryReport {
  exit: number;
  line: string;
}

export async function runTry(d: TryDeps, o: TryOpts): Promise<TryReport> {
  const t0 = d.now();
  if (!atLeast(d.nodeVersion, MIN_NODE)) throw new TryStop(`Node ${MIN_NODE.join(".")} or newer is needed (found ${d.nodeVersion}). Run: nvm use`);
  const acct = await ensureAccount(d, o.reset === true);
  d.say(`account ${acct.id} ${acct.how}`);
  const parts: string[] = [`account ${acct.id} (${acct.how})`];

  const profile = readProfile(d.dir)!;
  const bal = await d.balanceOf(acct.id);
  if (bal < NEED_BALANCE) {
    await d.mint(acct.id, profile.private_key!, MINT_AMOUNT);
    d.say(`minted ${formatUsdc(MINT_AMOUNT)} aUSD (test money)`);
    parts.push(`minted ${formatUsdc(MINT_AMOUNT)} aUSD`);
  } else {
    d.say(`balance ${formatUsdc(bal)} aUSD, no mint needed`);
  }

  const demo = d.listings();
  const live = await d.programHash();
  if (demo.program_wasm_sha256 !== live) throw new TryStop("testnet demo listings are stale; re-run e2e-testnet --publish-demo (team step)");
  const ctx: Ctx = { ...d.ctx, actor: (role, flags) => resolveActor("testnet", role, { account: acct.id, ...flags }) };

  if (o.withList) {
    const file = o.withList.file ?? join(d.dir, "try-testnet-sample.csv");
    if (!o.withList.file) writeFileSync(file, "account_id,label,synthetic\nalice.synthetic-demo.near,lp,yes\nbob.synthetic-demo.near,bot,yes\ncarol.synthetic-demo.near,cex,yes\n");
    const common = { file, title: "[synthetic] try-testnet sample", desc: "Synthetic sample listed by the try-testnet script.", price: "1", evalFee: "0.1" };
    const dry = await listCommand(ctx, { ...common, dryRun: true });
    if (!o.withList.blobUrl) throw new TryStop(`ciphertext written to ${dry.blob_path} (sha256 ${dry.blob_sha256}). Upload it, then rerun with --with-list --blob-url <https url>`);
    const listed = await listCommand(ctx, { ...common, blobUrl: o.withList.blobUrl });
    d.say(`listed #${listed.listing_id} · ${listed.tx_url}`);
    parts.push(`listed #${listed.listing_id}`);
  }

  const criteriaDir = join(d.repo, "fixtures/criteria");
  const run = async (what: string, listingId: number, criteria: string): Promise<EvalResult> => {
    try {
      const r = await evalCommand(ctx, { listingId, criteria });
      d.say(`${what}: ${formatEval(r)}`);
      return r;
    } catch (e) {
      return capOrRethrow(e);
    }
  };
  const pass = await run("PASS scene", demo.pass_listing_id, o.criteria ?? join(criteriaDir, "demo.json"));
  const buyScene = await run("BUY scene", demo.buy_listing_id, join(criteriaDir, "demo-buy.json"));
  if (pass.status === "refunded" && buyScene.status === "refunded" && pass.refund_reason === "not_ok" && buyScene.refund_reason === "not_ok") {
    throw new TryStop(ENCLAVE_MESSAGE, EXIT.usage);
  }
  for (const r of [pass, buyScene]) parts.push(r.status === "refunded" ? `REFUNDED (${r.refund_reason})` : formatEval(r).split(" · out ")[0]);

  const out = join(d.dir, "try-testnet", `listing-${demo.buy_listing_id}.csv`);
  mkdirSync(join(d.dir, "try-testnet"), { recursive: true });
  const bought = await buyCommand(ctx, { listingId: demo.buy_listing_id, out }).catch(capOrRethrow);
  if (bought.status === "refunded") throw new TryStop(`the purchase was refunded (${bought.refund_reason}). See: npm run bench:offline`, EXIT.usage);
  if (!bought.decrypt?.ok) throw new TryStop(`hash check failed: ${bought.decrypt?.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`);
  d.say(`bought listing #${bought.listing_id} · purchase #${bought.purchase_id} · ${bought.tx_url}`);
  d.say(`sha256 match ✔ (${bought.decrypt.checks.length} checks) · plaintext in ${out}`);
  parts.push(`bought #${bought.purchase_id}`, "sha256 match ✔");

  const [lp, lb] = await Promise.all([ctx.views.listing(demo.pass_listing_id), ctx.views.listing(demo.buy_listing_id)]);
  const fee = (r: EvalResult, l: typeof lp) => (r.status === "done" && l ? BigInt(l.eval_fee) : 0n);
  const spent = BigInt(lb?.price ?? 0) + fee(pass, lp) + fee(buyScene, lb);
  const line = `${parts.join(" · ")} · ${sec(d.now() - t0)}`;
  d.say(line);
  d.say(`spent about ${formatUsdc(spent)} aUSD of test money; nothing real moved`);
  return { exit: EXIT.ok, line };
}

// ---------------------------------------------------------------------- real dependencies

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export async function main(argv: string[]): Promise<number> {
  const { values: f } = parseArgs({
    args: argv,
    options: {
      criteria: { type: "string" }, "with-list": { type: "boolean" }, "blob-url": { type: "string" }, file: { type: "string" },
      reset: { type: "boolean" }, "sponsor-url": { type: "string" }, listings: { type: "string" }, record: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (f.help) {
    console.log("usage: npm run try:testnet -- [--criteria <file>] [--with-list --blob-url <https> [--file <csv>]] [--reset] [--sponsor-url <url>] [--listings <file>] [--record]");
    return 0;
  }
  loadEnv();
  muteRateLimitNoise();
  const env = process.env;
  const cfg = resolveNetwork("testnet", env);
  const repo = repoRoot();
  const listingsFile = f.listings ?? join(repo, "fixtures/testnet-listings.json");
  const views = makeViews("testnet", env);
  const site = env.NEXT_PUBLIC_SITE_DOMAIN || DEFAULT_SITE;
  const deps: TryDeps = {
    ctx: {
      network: "testnet",
      views,
      transport: realTransport({ network: "testnet", relay: "hosted", env }),
      actor: (role, flags) => resolveActor("testnet", role, flags),
      confirm: async () => {},
      evidence: (run) => {
        if (f.record) appendRun("testnet", { ...run, script: "scripts/src/try-testnet.ts" });
      },
      progress: (l) => log(l),
    },
    say: (l) => log(l),
    now: Date.now,
    dir: configDir(),
    nodeVersion: process.versions.node,
    listings: () => {
      if (!existsSync(listingsFile)) throw new TryStop(`${listingsFile} is missing: the team publishes the demo listings with e2e-testnet --publish-demo`);
      return JSON.parse(readFileSync(listingsFile, "utf8")) as DemoListings;
    },
    accountExists: (id) => viewAccount("testnet", id).then(() => true, () => false),
    newKey: () => {
      const kp = KeyPair.fromRandom("ed25519");
      return { publicKey: kp.getPublicKey().toString(), secret: kp.toString() };
    },
    faucet: async (accountId, publicKey) => {
      const r = await postJson(FAUCET_URL, { newAccountId: accountId, newAccountPublicKey: publicKey });
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    },
    sponsor: async (publicKey) => {
      const url = f["sponsor-url"] ?? env.ARROW_SPONSOR_URL ?? `https://${site}/api/testnet-sponsor`;
      const r = await postJson(url, { publicKey });
      if (r.status === 200 && typeof r.json?.accountId === "string") return { ok: true, accountId: r.json.accountId };
      return { ok: false, status: r.status, message: String(r.json?.error ?? "no answer"), fallback: typeof r.json?.fallback === "string" ? r.json.fallback : undefined };
    },
    balanceOf: async (id) => BigInt(await view<string>("testnet", cfg.usdcToken, "ft_balance_of", { account_id: id })),
    mint: async (id, secret, amount) => {
      const account = new Account(id, rpcProvider("testnet", env), secret as `ed25519:${string}`);
      await retryRateLimited(() => account.callFunctionRaw({
        contractId: cfg.usdcToken, methodName: "mint", args: { receiver_id: id, amount: amount.toString() }, gas: 30_000_000_000_000n, waitUntil: "INCLUDED_FINAL",
      }));
      for (let i = 0; i < 20; i++) {
        if ((await deps.balanceOf(id)) >= amount) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new TryStop("the mint did not show up after 40 s; run again");
    },
    repo,
    programHash: async () => String(((await views.config()).config as { program_wasm_hash?: string }).program_wasm_hash ?? ""),
  };
  try {
    return (await runTry(deps, {
      criteria: f.criteria, reset: f.reset,
      withList: f["with-list"] ? { blobUrl: f["blob-url"], file: f.file } : undefined,
    })).exit;
  } catch (e) {
    console.error(mask(e instanceof Error ? e.message : String(e)));
    return e instanceof TryStop || e instanceof CliError ? e.exit : EXIT.error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
