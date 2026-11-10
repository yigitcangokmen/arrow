// Append-only evidence writer (WS4-T08, DEC D4-08, PLAN 7.6 / A.3). The only code that writes evidence/<net>.json.
// Always targets the main checkout's evidence/ (never a worktree copy). The schema moves to @arrow/sdk with WS4-T01.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { mainCheckout, repoRoot } from "./env.ts";

export type EvidenceNetwork = "testnet" | "mainnet";

const hex64OrNull = z.string().regex(/^[0-9a-f]{64}$/).nullable();

export const EvidenceRun = z.object({
  id: z.string().min(1),
  kind: z.enum(["list", "eval", "buy", "refund", "inbound", "outbound", "attack", "spike", "deploy", "lock"]),
  tx: z.string().nullable(),
  chain: z.enum(["near", "base", "solana"]),
  block_height: z.number().int().nullable(),
  timestamp_utc: z.string(),
  listing_id: z.union([z.number(), z.string()]).nullable(),
  eval_id: z.union([z.number(), z.string()]).nullable(),
  purchase_id: z.union([z.number(), z.string()]).nullable(),
  oneclick_deposit: z.string().nullable(),
  expect: z.string(),
  observed: z.string(),
  script: z.string(),
  commit: z.string(),
});
export type EvidenceRun = z.infer<typeof EvidenceRun>;

export const EvidenceFile = z.object({
  network: z.enum(["testnet", "mainnet"]),
  contract: z.string(),
  contract_wasm_sha256: hex64OrNull,
  program_wasm_sha256: hex64OrNull,
  program_wasm_url: z.string().nullable(),
  lock: z.object({ tx: z.string().nullable(), block_height: z.number().nullable(), timestamp_utc: z.string().nullable() }),
  accounts: z.record(z.string(), z.string()),
  runs: z.array(EvidenceRun),
  corrections: z.array(z.unknown()),
});
export type EvidenceFile = z.infer<typeof EvidenceFile>;

/** Caller may omit commit and timestamp_utc; they default to HEAD and now. */
export type EvidenceRunInput = Omit<EvidenceRun, "commit" | "timestamp_utc"> & Partial<Pick<EvidenceRun, "commit" | "timestamp_utc">>;

export function evidenceDir(): string {
  return process.env.ARROW_EVIDENCE_DIR || resolve(mainCheckout(), "evidence");
}

export function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "uncommitted";
  }
}

const SKELETON: Record<EvidenceNetwork, EvidenceFile> = {
  testnet: {
    network: "testnet", contract: "arrow.arrowhq.testnet", contract_wasm_sha256: null, program_wasm_sha256: null,
    program_wasm_url: null, lock: { tx: null, block_height: null, timestamp_utc: null }, accounts: {}, runs: [], corrections: [],
  },
  mainnet: {
    network: "mainnet", contract: "arrow-market.near", contract_wasm_sha256: null, program_wasm_sha256: null,
    program_wasm_url: null, lock: { tx: null, block_height: null, timestamp_utc: null },
    accounts: { treasury: "arrowhq.near", relayer: "arrow-relayer.arrowhq.near" }, runs: [], corrections: [],
  },
};

function fileFor(network: EvidenceNetwork): string {
  return resolve(evidenceDir(), `${network}.json`);
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Runs fn while holding evidence/.lock (created with 'wx', 50 x 100 ms attempts, then error). */
function withLock<T>(fn: () => T): T {
  mkdirSync(evidenceDir(), { recursive: true });
  const lock = resolve(evidenceDir(), ".lock");
  let fd: number | undefined;
  for (let i = 0; i < 50 && fd === undefined; i++) {
    try {
      fd = openSync(lock, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      sleepMs(100);
    }
  }
  if (fd === undefined) throw new Error(`evidence lock busy: ${lock}`);
  try {
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function writeAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

export function readEvidence(network: EvidenceNetwork): EvidenceFile {
  const f = fileFor(network);
  return existsSync(f) ? EvidenceFile.parse(JSON.parse(readFileSync(f, "utf8"))) : structuredClone(SKELETON[network]);
}

export function appendRun(network: EvidenceNetwork, run: EvidenceRunInput): void {
  const full = EvidenceRun.parse({ commit: gitCommit(), timestamp_utc: new Date().toISOString(), ...run });
  withLock(() => {
    const ev = readEvidence(network);
    if (ev.runs.some((r) => r.id === full.id)) throw new Error(`evidence run id ${full.id} already exists (append-only)`);
    ev.runs.push(full);
    writeAtomic(fileFor(network), ev);
  });
}

/** Top-level fields other than runs/corrections (hashes, lock, accounts, program url). */
export function setTopLevel(network: EvidenceNetwork, patch: Partial<Omit<EvidenceFile, "network" | "runs" | "corrections">>): void {
  withLock(() => {
    const ev = readEvidence(network);
    writeAtomic(fileFor(network), EvidenceFile.parse({ ...ev, ...patch }));
  });
}

/** Team-controlled EVM addresses (addresses only, never keys): DEC H-07 counts any other seller as external. */
export function appendTeamEvm(entry: { role: string; address: string; created_utc: string }): void {
  withLock(() => {
    const f = resolve(evidenceDir(), "team-accounts.json");
    const doc = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { near: [], evm: [], solana: [] };
    doc.evm = [...(doc.evm ?? []), entry];
    writeAtomic(f, doc);
  });
}
