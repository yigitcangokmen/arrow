// The single evidence CLI (WS1-T05, W1-07, PLAN 7.6 / A.3). Writes only through scripts/src/lib/evidence.ts,
// so every write lands in the main checkout's evidence/<network>.json under evidence/.lock.
//
//   npx tsx scripts/src/evidence-add.ts --network testnet|mainnet
//       [--account <role>=<account_id>]...
//       [--set contract|contract_wasm_sha256|program_wasm_sha256|program_wasm_url=<value>]...
//       [--run '<json>' [--sender <signer>]]
//       [--file <run.json | runs.jsonl> [--sender <signer>]]
//       [--lock <tx_hash> --sender <account>]
//
// A NEAR run with a tx and no block_height needs --sender: block_height and timestamp_utc come from the archival RPC.
import "./lib/require-node.ts";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { appendRun, EvidenceRun, readEvidence, setTopLevel, type EvidenceNetwork, type EvidenceRunInput } from "./lib/evidence.ts";
import { log } from "./lib/log.ts";

const SET_FIELDS = ["contract", "contract_wasm_sha256", "program_wasm_sha256", "program_wasm_url"] as const;
const SECRET_NAME = /key|secret|private/i;

class UsageError extends Error {}

/** Throws when any object key (at any depth) looks like it holds a key or secret. */
function refuseSecretFields(value: unknown, path = ""): void {
  if (Array.isArray(value)) value.forEach((v, i) => refuseSecretFields(v, `${path}[${i}]`));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_NAME.test(k)) throw new UsageError(`refusing secret-like field "${path}${k}" (evidence never holds keys)`);
      refuseSecretFields(v, `${path}${k}.`);
    }
  }
}

function splitPair(s: string, flag: string): [string, string] {
  const at = s.indexOf("=");
  if (at <= 0) throw new UsageError(`${flag} expects name=value, got "${s}"`);
  return [s.slice(0, at), s.slice(at + 1)];
}

/** One JSON object, a JSON array, or JSON Lines (blank lines skipped). */
function readRuns(file: string): Record<string, unknown>[] {
  const text = readFileSync(file, "utf8");
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [v];
  } catch {
    return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  }
}

/** Block height and time of the block that included the tx (archival RPC). */
async function txBlock(network: EvidenceNetwork, tx: string, sender: string) {
  const { rpc, txStatus } = await import("@arrow/sdk"); // loaded only when a lookup is needed (keeps offline runs fast)
  const status = await txStatus(network, tx, sender, "NONE", { archival: true });
  const hash = status?.transaction_outcome?.block_hash;
  if (!hash) throw new Error(`tx ${tx} not found on ${network} (sender ${sender})`);
  const block = await rpc<{ header: { height: number; timestamp_nanosec: string } }>(network, "block", { block_id: hash }, { archival: true });
  return {
    block_height: block.header.height,
    timestamp_utc: new Date(Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n)).toISOString(),
  };
}

/** "<script basename>-NNN", numbered after the existing runs with that prefix. */
function nextId(script: unknown, taken: Set<string>): string {
  const base = typeof script === "string" && script ? basename(script, extname(script)) : "run";
  for (let n = 1; ; n++) {
    const id = `${base}-${String(n).padStart(3, "0")}`;
    if (!taken.has(id)) return id;
  }
}

async function completeRun(network: EvidenceNetwork, raw: Record<string, unknown>, sender: string | undefined, taken: Set<string>) {
  refuseSecretFields(raw);
  const run = {
    tx: null, chain: "near", block_height: null, listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: null,
    ...raw,
  } as Record<string, unknown>;
  if (!run.id) run.id = nextId(run.script, taken);
  else if (taken.has(String(run.id))) throw new UsageError(`evidence run id ${run.id} already exists (append-only)`);
  taken.add(String(run.id));
  if (run.chain === "near" && typeof run.tx === "string" && run.block_height == null) {
    if (!sender) throw new UsageError(`run ${run.id}: near tx without block_height needs --sender to read it from the archival RPC`);
    Object.assign(run, await txBlock(network, run.tx, sender));
  }
  EvidenceRun.parse({ commit: "-", timestamp_utc: "-", ...run }); // schema check before any write
  return run as EvidenceRunInput;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      network: { type: "string" },
      account: { type: "string", multiple: true },
      set: { type: "string", multiple: true },
      run: { type: "string" },
      file: { type: "string" },
      sender: { type: "string" },
      lock: { type: "string" },
    },
  });
  const network = values.network;
  if (network !== "testnet" && network !== "mainnet") throw new UsageError("--network testnet|mainnet is required");

  // Validate everything before the first write, so a bad argument leaves the file untouched.
  const accounts: Record<string, string> = {};
  for (const a of values.account ?? []) {
    const [role, id] = splitPair(a, "--account");
    refuseSecretFields({ [role]: id });
    accounts[role] = id;
  }
  const sets: Record<string, string> = {};
  for (const s of values.set ?? []) {
    const [field, value] = splitPair(s, "--set");
    if (!(SET_FIELDS as readonly string[]).includes(field)) throw new UsageError(`--set field must be one of ${SET_FIELDS.join("|")}`);
    // an unset shell variable expands to nothing; writing "" would leave verify R1 NOT PROVEN without a word (QA-08)
    if (value.trim() === "") throw new UsageError(`--set ${field} is empty (was .env sourced? set -a && . ./.env && set +a)`);
    sets[field] = value;
  }
  const raws: Record<string, unknown>[] = [];
  if (values.run) raws.push(JSON.parse(values.run));
  if (values.file) raws.push(...readRuns(values.file));
  if (values.lock && !values.sender) throw new UsageError("--lock needs --sender");
  if (!raws.length && !values.lock && !Object.keys(accounts).length && !Object.keys(sets).length) {
    throw new UsageError("nothing to do: pass --account, --set, --run, --file or --lock");
  }

  const taken = new Set(readEvidence(network).runs.map((r) => r.id));
  const runs = [];
  for (const raw of raws) runs.push(await completeRun(network, raw, values.sender, taken));
  const lock = values.lock ? { tx: values.lock, ...(await txBlock(network, values.lock, values.sender!)) } : undefined;

  if (Object.keys(accounts).length || Object.keys(sets).length || lock) {
    const current = readEvidence(network).accounts;
    setTopLevel(network, {
      ...sets,
      ...(Object.keys(accounts).length ? { accounts: { ...current, ...accounts } } : {}),
      ...(lock ? { lock } : {}),
    });
    for (const [role, id] of Object.entries(accounts)) log(`${network} accounts.${role} = ${id}`);
    for (const [field, value] of Object.entries(sets)) log(`${network} ${field} = ${value}`);
    if (lock) log(`${network} lock = ${lock.tx} @ ${lock.block_height}`);
  }
  for (const run of runs) {
    appendRun(network, run);
    log(`${network} run ${run.id} (${run.kind}) tx ${run.tx ?? "-"} block ${run.block_height ?? "-"}`);
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`evidence-add: ${msg}`);
  process.exit(1);
});
