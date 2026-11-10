// Balances and readiness checks (WS4-T08). Read-only: Base RPC, NEAR RPC views and plain HTTP checks.
//   balances.ts [--network mainnet|testnet] [--ops] [--require buyer>=8.0,seller>=3.5]
// Default network is mainnet because the Base wallets and the Intents balances live there.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveNetwork } from "@arrow/sdk";
import { loadEnv, repoRoot } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { resumeFrom } from "./e2e-mainnet.ts";
import { readEvidence } from "./lib/evidence.ts";
import { runOps, wasmUrlCheck } from "./lib/ops.ts";

loadEnv();

const { values } = parseArgs({
  options: { network: { type: "string", default: "mainnet" }, ops: { type: "boolean", default: false }, require: { type: "string" } },
});
const network = values.network === "testnet" ? "testnet" : "mainnet";
const env = (name: string, fallback: string) => process.env[name] || fallback;

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_TOKEN_ID = env("USDC_TOKEN_ID", "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
const INTENTS = env("INTENTS_CONTRACT", "intents.near");
const RPC = network === "mainnet"
  ? [env("MAINNET_RPC_URL", "https://rpc.mainnet.near.org"), "https://rpc.mainnet.fastnear.com"]
  : [env("TESTNET_RPC_URL", "https://rpc.testnet.near.org"), "https://rpc.testnet.fastnear.com"];
const CONTRACT = resolveNetwork(network, process.env).contract; // ARROW_CONTRACT_<NET> from .env, else the SDK default

let failed = false;
const fail = (msg: string) => {
  failed = true;
  log(`FAIL: ${msg}`);
};

async function rpc(params: Record<string, unknown>): Promise<any> {
  let last: unknown;
  for (const url of RPC) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "arrow", method: "query", params }),
        signal: AbortSignal.timeout(15000),
      });
      const body: any = await res.json();
      if (body.error) throw new Error(body.error.data ?? body.error.message);
      if (body.result?.error) throw new Error(body.result.error);
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** NEAR balance of an account in NEAR units, or null when the account does not exist. */
async function nearBalance(accountId: string): Promise<number | null> {
  try {
    const r = await rpc({ request_type: "view_account", finality: "final", account_id: accountId });
    return Number(formatUnits(BigInt(r.amount), 24));
  } catch {
    return null;
  }
}

async function view(account: string, method: string, args: object): Promise<any> {
  const r = await rpc({
    request_type: "call_function", finality: "final", account_id: account, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

const near = (n: number | null) => (n === null ? "(account not found)" : `${n.toFixed(4)} NEAR`);

async function baseWallets(): Promise<Record<string, number>> {
  const intents: Record<string, number> = {};
  const client = createPublicClient({ transport: http(env("BASE_RPC_URL", "https://mainnet.base.org")) });
  for (const role of ["buyer", "seller"] as const) {
    const pk = process.env[`E2E_${role.toUpperCase()}_EVM_PRIVATE_KEY`];
    if (!pk) {
      log(`${role}: E2E_${role.toUpperCase()}_EVM_PRIVATE_KEY not set (run new-evm-wallet.ts --role ${role})`);
      continue;
    }
    const address = privateKeyToAccount(pk as `0x${string}`).address;
    try {
      const [usdc, eth] = await Promise.all([
        client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        client.getBalance({ address }),
      ]);
      log(`${role} ${address}: Base USDC ${formatUnits(usdc, 6)} / ETH ${formatUnits(eth, 18)}`);
    } catch (e) {
      log(`${role} ${address}: Base RPC failed (${(e as Error).message.split("\n")[0]}); try BASE_RPC_URL=https://base.llamarpc.com`);
    }
    try {
      const raw = await view(INTENTS, "mt_balance_of", { account_id: address.toLowerCase(), token_id: USDC_TOKEN_ID });
      intents[role] = Number(formatUnits(BigInt(raw), 6));
      log(`${role} Intents USDC: ${formatUnits(BigInt(raw), 6)}`);
    } catch (e) {
      log(`${role} Intents USDC: view failed (${(e as Error).message.split("\n")[0]})`);
    }
  }
  return intents;
}

async function checkRequire(spec: string, intents: Record<string, number>): Promise<void> {
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(buyer|seller)>=(\d+(?:\.\d{1,6})?)$/);
    if (!m) {
      fail(`bad --require item "${part}" (expected buyer>=8.0)`);
      continue;
    }
    const need = Number(formatUnits(parseUnits(m[2], 6), 6));
    const have = intents[m[1]] ?? 0;
    if (have < need) fail(`${m[1]} Intents USDC ${have} < ${need}: missing ${(need - have).toFixed(6)}`);
    else log(`require ${m[1]}>=${need}: ok (${have})`);
  }
}

async function main(): Promise<void> {
  log(`network: ${network}`);
  let intents: Record<string, number> = {};
  if (network === "mainnet") {
    intents = await baseWallets();
    for (const id of ["arrowhq.near", env("RELAYER_ACCOUNT_ID", "arrow-relayer.arrowhq.near"), CONTRACT]) log(`${id}: ${near(await nearBalance(id))}`);
    try {
      const cfg = await view(CONTRACT, "get_config", {});
      const tank = Object.entries(cfg).find(([k]) => /tank/i.test(k));
      log(`contract gas tank: ${tank ? `${tank[0]}=${JSON.stringify(tank[1])}` : "no tank field in get_config"}`);
    } catch {
      log("contract gas tank: get_config not available (contract not deployed?)");
    }
    log("NEAR AI: no dashboard shows the mainnet key (KU-11); --ops sends a max_tokens 1 probe with it");
  } else {
    for (const id of ["arrowhq.testnet", CONTRACT, "arrow-judge.arrowhq.testnet"]) log(`${id}: ${near(await nearBalance(id))}`);
  }
  if (!values.ops) {
    const url = process.env.PROGRAM_WASM_URL;
    const want = process.env.PROGRAM_WASM_SHA256;
    if (url && want) await wasmUrlCheck(fetch, url, want, log);
    else log("PROGRAM_WASM_URL / PROGRAM_WASM_SHA256: not set (set at freeze)");
  }

  if (values.require) await checkRequire(values.require, intents);

  if (values.ops) {
    const release = (n: string) => {
      const f = join(repoRoot(), "release", n);
      return existsSync(f) ? readFileSync(f, "utf8").replace(/\s+/g, "").toLowerCase() : null;
    };
    // testnet: the two scenes try:testnet sends a judge to (fixtures/testnet-listings.json, written by e2e-testnet --publish-demo; the testnet
    // evidence mixes two contracts, so it is not read); mainnet: the L1 and L2 listings of the newest e2e run in the mainnet evidence
    const listingsFile = join(repoRoot(), "fixtures/testnet-listings.json");
    const ids = (): (number | undefined)[] => {
      if (network === "testnet") {
        if (!existsSync(listingsFile)) return [];
        const f = JSON.parse(readFileSync(listingsFile, "utf8"));
        return [f.pass_listing_id, f.buy_listing_id];
      }
      const r = resumeFrom(readEvidence("mainnet").runs);
      return r ? [r.ids.L1, r.ids.L2] : [];
    };
    const problems = await runOps({
      network, contract: CONTRACT, env: process.env, fetch, nearBalance, view, log,
      releaseSha: release("sha256.txt") ?? (network === "testnet" ? release("arrow-tee-rc.sha256") : null),
      demoListings: ids().filter((n): n is number => typeof n === "number"),
    });
    if (problems.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
