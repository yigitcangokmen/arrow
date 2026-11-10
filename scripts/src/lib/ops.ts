// The H-23 upkeep checks (X12-OPS-3): everything `balances.ts --ops` fails on. Read-only; the probes get their dependencies injected,
// so scripts/test/balances.test.ts can feed them a fake chain and a fake HTTP world.
import { createHash } from "node:crypto";
import { formatUnits } from "viem";
import { fetchAndCheckBlob } from "@arrow/sdk";

export type OpsNetwork = "mainnet" | "testnet";

export interface OpsDeps {
  network: OpsNetwork;
  /** the market contract */
  contract: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  /** NEAR balance in NEAR units, null when the account does not exist */
  nearBalance(accountId: string): Promise<number | null>;
  view(account: string, method: string, args: object): Promise<any>;
  /** release/sha256.txt (mainnet) or the release candidate file (testnet); null when there is none */
  releaseSha: string | null;
  /** the listings a judge is sent to (the two demo scenes): their ciphertext host must still serve the sha */
  demoListings: number[];
  log(line: string): void;
}

/** Floors in NEAR. The relayer holds ~0.6 NEAR of prepaid gas for the 40-60 s of one 600 TGas execute_intents, so 0.3 could not carry even one payment. */
export const FLOORS = { mainnetTank: 0.3, testnetTank: 5, relayer: 0.65, judge: 20 } as const;

const MODEL = "Qwen/Qwen3.8-27B";
const near = (n: number | null) => (n === null ? "(account not found)" : `${n.toFixed(4)} NEAR`);
const yoctoToNear = (v: unknown) => Number(formatUnits(BigInt(String(v ?? "0")), 24));

/** FastFS answers HEAD 404 and GET 200, so only the GET and the sha decide. HEAD is printed as information. */
export async function wasmUrlCheck(f: typeof fetch, url: string, want: string, log: (l: string) => void): Promise<boolean> {
  try {
    const head = await f(url, { method: "HEAD", signal: AbortSignal.timeout(20000) }).catch(() => null);
    const res = await f(url, { signal: AbortSignal.timeout(60000) });
    const sha = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    const ok = res.status === 200 && sha === want;
    log(`program wasm URL ${url}: GET ${res.status}, sha256 ${sha === want ? "matches" : "DIFFERS from"} ${want.slice(0, 12)}… (HEAD ${head?.status ?? "failed"}, informational)`);
    return ok;
  } catch (e) {
    log(`program wasm URL ${url}: ${(e as Error).message}`);
    return false;
  }
}

/** One max_tokens:1 call with the key from .env. The key is never printed; a dead, rate-limited or empty key shows here before it shows as refunds. */
async function nearAiProbe(d: OpsDeps): Promise<string | null> {
  const name = d.network === "mainnet" ? "NEARAI_API_KEY_MAINNET" : "NEARAI_API_KEY";
  const key = d.env[name];
  if (!key) return `NEAR AI probe: ${name} is not set`;
  try {
    const r = await d.fetch("https://cloud-api.near.ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "ok" }], max_tokens: 1, temperature: 0, chat_template_kwargs: { enable_thinking: false } }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.status !== 200) return `NEAR AI probe: HTTP ${r.status} (every eval would refund not_ok)`;
    d.log(`NEAR AI probe (${name}): 200`);
    return null;
  } catch (e) {
    return `NEAR AI probe: ${(e as Error).message.split("\n")[0]}`;
  }
}

/** The OutLayer secret row of the market for the current program: profile arrow, WasmHash <hash> AND Predecessor whitelist [market]. */
export function secretRowProblem(rows: any[], hash: string, market: string): string | null {
  const row = (rows ?? []).find((r) => r?.profile === "arrow" && r?.accessor?.WasmHash?.hash === hash);
  if (!row) return `no OutLayer secret row (profile arrow, WasmHash ${hash.slice(0, 12)}…) for ${market}`;
  const logic = row.access?.Logic;
  const kinds = (logic?.conditions ?? []).map((c: object) => Object.keys(c)[0]);
  const accounts = logic?.conditions?.[1]?.Predecessor?.condition?.Whitelist?.accounts;
  if (logic?.operator !== "And" || kinds.join(",") !== "WasmHash,Predecessor" || JSON.stringify(accounts) !== JSON.stringify([market]))
    return `OutLayer secret row access is not And[WasmHash, Predecessor whitelist [${market}]]`;
  return null;
}

/** Runs every upkeep check and returns the problems; an empty list means --ops passes. */
export async function runOps(d: OpsDeps): Promise<string[]> {
  const problems: string[] = [];
  const bad = (m: string) => (problems.push(m), d.log(`FAIL: ${m}`));
  const mainnet = d.network === "mainnet";

  let cfg: any = null;
  try {
    cfg = await d.view(d.contract, "get_config", {});
  } catch {
    bad(`${d.contract} get_config unreadable (contract not deployed?)`);
  }
  if (cfg) {
    // the tank is what pays OutLayer; the account balance also holds locked storage, which is not spendable
    const tank = yoctoToNear(cfg.tank_available);
    const floor = mainnet ? FLOORS.mainnetTank : FLOORS.testnetTank;
    if (!(tank >= floor)) bad(`${d.contract} tank_available ${tank.toFixed(4)} NEAR < ${floor} NEAR`);
    else d.log(`tank_available ${tank.toFixed(4)} NEAR (>= ${floor})`);
    if (cfg.paused !== false) bad(`${d.contract} is paused (get_config.paused = ${JSON.stringify(cfg.paused)})`);

    const pk = await d.view(d.contract, "program_pubkey", {}).catch(() => null);
    if (typeof pk !== "string" || !/^04[0-9a-f]{128}$/.test(pk)) bad(`${d.contract} program_pubkey is ${pk === null || pk === undefined ? "null" : "not 130 hex"} (run init_program_key)`);

    const hash = String(cfg.config?.program_wasm_hash ?? "").toLowerCase();
    if (!d.releaseSha) {
      if (mainnet) bad("release/sha256.txt is missing: cannot compare get_config.program_wasm_hash");
    } else if (hash !== d.releaseSha) bad(`program_wasm_hash ${hash.slice(0, 12)}… != release ${d.releaseSha.slice(0, 12)}…`);

    const url = String(cfg.config?.program_wasm_url ?? "");
    if (!url) bad("get_config has no program_wasm_url");
    else if (!(await wasmUrlCheck(d.fetch, url, hash, d.log))) bad(`program wasm URL ${url} does not serve ${hash.slice(0, 12)}… (GET 200 and sha256 decide)`);

    try {
      const rows = await d.view(mainnet ? "outlayer.near" : "outlayer.testnet", "list_user_secrets", { account_id: d.contract });
      const p = secretRowProblem(rows, hash, d.contract);
      if (p) bad(p);
      else d.log(`OutLayer secret row OK (profile arrow, WasmHash ${hash.slice(0, 12)}… AND Predecessor ${d.contract})`);
    } catch (e) {
      bad(`OutLayer list_user_secrets unreadable: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  for (const id of d.demoListings) {
    try {
      const l = await d.view(d.contract, "get_listing", { listing_id: id });
      if (!l) bad(`demo listing #${id} does not exist on ${d.contract}`);
      else {
        await fetchAndCheckBlob(l.blob_url, l.blob_sha256, d.fetch);
        d.log(`demo listing #${id}: ${l.blob_url} serves ${String(l.blob_sha256).slice(0, 12)}…`);
      }
    } catch (e) {
      bad(`demo listing #${id}: ciphertext not served (${(e as Error).message.split("\n")[0].slice(0, 120)})`);
    }
  }

  const ai = await nearAiProbe(d);
  if (ai) bad(ai);

  const domain = d.env.NEXT_PUBLIC_SITE_DOMAIN;
  if (mainnet) {
    const id = d.env.RELAYER_ACCOUNT_ID || "arrow-relayer.arrowhq.near";
    const relayer = await d.nearBalance(id);
    if (relayer === null || relayer < FLOORS.relayer) bad(`relayer ${id} ${near(relayer)} < ${FLOORS.relayer} NEAR (one execute_intents holds ~0.6 NEAR of prepaid gas)`);
    if (!domain) bad("NEXT_PUBLIC_SITE_DOMAIN not set: cannot check the hosted relay route");
    else {
      try {
        const r = await d.fetch(`https://${domain}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
        if (r.status !== 400) bad(`hosted relay route returned ${r.status}, expected 400 (BAD_REQUEST)`);
        else d.log("hosted relay route alive (400 BAD_REQUEST)");
      } catch (e) {
        bad(`hosted relay route: ${(e as Error).message}`);
      }
    }
  } else {
    const judge = await d.nearBalance("arrow-judge.arrowhq.testnet");
    if (judge === null || judge < FLOORS.judge) bad(`arrow-judge.arrowhq.testnet ${near(judge)} < ${FLOORS.judge} tNEAR`);
    try {
      const f = await d.fetch("https://helper.nearprotocol.com/account", { method: "POST", signal: AbortSignal.timeout(15000) });
      if (f.status >= 500) bad(`faucet API ${f.status}`);
      else d.log(`faucet API alive (${f.status})`);
    } catch (e) {
      bad(`faucet API: ${(e as Error).message}`);
    }
    if (!domain) bad("NEXT_PUBLIC_SITE_DOMAIN not set: cannot check the hosted sponsor route");
    else {
      try {
        const s = await d.fetch(`https://${domain}/api/testnet-sponsor`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
        if (s.status !== 400) bad(`hosted sponsor route returned ${s.status}, expected 400 (BAD_KEY)`);
        else d.log("hosted sponsor route alive (400 BAD_KEY)");
      } catch (e) {
        bad(`hosted sponsor route: ${(e as Error).message}`);
      }
    }
  }
  return problems;
}
