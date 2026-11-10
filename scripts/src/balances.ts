// Balances and readiness checks (WS4-T08). Read-only: Base RPC, NEAR RPC views and plain HTTP checks.
//   balances.ts [--network mainnet|testnet] [--ops] [--require buyer>=8.0,seller>=3.5]
// Default network is mainnet because the Base wallets and the Intents balances live there.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "./lib/env.ts";
import { log } from "./lib/log.ts";

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
const CONTRACT = network === "mainnet" ? env("ARROW_CONTRACT_MAINNET", "arrow-market.near") : env("ARROW_CONTRACT_TESTNET", "arrow.arrowhq.testnet");

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

async function wasmUrlCheck(): Promise<boolean> {
  const url = process.env.PROGRAM_WASM_URL;
  const want = process.env.PROGRAM_WASM_SHA256;
  if (!url) {
    log("PROGRAM_WASM_URL: not set (set at freeze)");
    return false;
  }
  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20000) });
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const sha = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    const ok = head.status === 200 && res.status === 200 && sha === want;
    log(`PROGRAM_WASM_URL: HEAD ${head.status}, GET ${res.status}, sha256 ${sha === want ? "matches" : "DIFFERS from"} PROGRAM_WASM_SHA256`);
    return ok;
  } catch (e) {
    log(`PROGRAM_WASM_URL: ${(e as Error).message}`);
    return false;
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
    log("NEAR AI: manual check at cloud.near.ai (mainnet key)");
    log("NEAR AI (testnet key): manual check at nearbuilders.org/dashboard");
  } else {
    for (const id of ["arrowhq.testnet", CONTRACT, "arrow-judge.arrowhq.testnet"]) log(`${id}: ${near(await nearBalance(id))}`);
  }
  const wasmOk = await wasmUrlCheck();

  if (values.require) await checkRequire(values.require, intents);

  if (values.ops) {
    if (network === "mainnet") {
      const relayer = await nearBalance(env("RELAYER_ACCOUNT_ID", "arrow-relayer.arrowhq.near"));
      if (relayer === null || relayer < 0.3) fail(`relayer ${near(relayer)} < 0.3 NEAR`);
      try {
        const cfg = await view(CONTRACT, "get_config", {});
        const tank = Object.entries(cfg).find(([k]) => /tank/i.test(k))?.[1];
        const n = Number(formatUnits(BigInt(String(tank ?? "0")), 24));
        if (!(n >= 0.3)) fail(`contract tank ${n} NEAR < 0.3 NEAR`);
      } catch {
        fail("contract tank unreadable (get_config)");
      }
      if (!wasmOk) fail("wasm URL check not OK");
    } else {
      const arrowBal = await nearBalance(CONTRACT);
      if (arrowBal === null || arrowBal < 5) fail(`${CONTRACT} ${near(arrowBal)} < 5 tNEAR`);
      const judge = await nearBalance("arrow-judge.arrowhq.testnet");
      if (judge === null || judge < 20) fail(`arrow-judge.arrowhq.testnet ${near(judge)} < 20 tNEAR`);
      try {
        const f = await fetch("https://helper.nearprotocol.com/account", { method: "POST", signal: AbortSignal.timeout(15000) });
        if (f.status >= 500) fail(`faucet API ${f.status}`);
        else log(`faucet API alive (${f.status})`);
      } catch (e) {
        fail(`faucet API: ${(e as Error).message}`);
      }
      const domain = process.env.NEXT_PUBLIC_SITE_DOMAIN;
      if (!domain) fail("NEXT_PUBLIC_SITE_DOMAIN not set: cannot check the hosted sponsor route");
      else {
        try {
          const s = await fetch(`https://${domain}/api/testnet-sponsor`, {
            method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000),
          });
          if (s.status !== 400) fail(`hosted sponsor route returned ${s.status}, expected 400 (BAD_KEY)`);
          else log("hosted sponsor route alive (400 BAD_KEY)");
        } catch (e) {
          fail(`hosted sponsor route: ${(e as Error).message}`);
        }
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
