// Append-only evidence writer (WS4-T08, DEC D4-08, PLAN 7.6 / A.3). The only code that writes evidence/<net>.json.
// Always targets the main checkout's evidence/ (never a worktree copy). Schemas live in sdk/src/schemas.ts.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EvidenceFile, EvidenceRun } from "@arrow/sdk/schemas";
import { NETWORKS, resolveNetwork } from "@arrow/sdk";
import { mainCheckout, repoRoot } from "./env.ts";

export type EvidenceNetwork = "testnet" | "mainnet";

export { EvidenceFile, EvidenceRun };

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
    network: "testnet", contract: NETWORKS.testnet.contract, contract_wasm_sha256: null, program_wasm_sha256: null,
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

/**
 * STATE-2: each run names the market it ran against (ARROW_CONTRACT_<NET>, else the SDK default) and, when that is the
 * file's contract, the program the file records as current (set with `evidence-add --set program_wasm_sha256` at every
 * set_program). A run may pass either field itself. Verify skips runs of another contract. A deploy run is not filled:
 * it changes the market or its program, and the file's program may already name a program the market does not run yet.
 */
export function appendRun(network: EvidenceNetwork, run: EvidenceRunInput): void {
  const contract = resolveNetwork(network, process.env).contract;
  withLock(() => {
    const ev = readEvidence(network);
    const program = ev.contract === contract && ev.program_wasm_sha256 && run.kind !== "deploy" ? { program_wasm_sha256: ev.program_wasm_sha256 } : {};
    const full = EvidenceRun.parse({ commit: gitCommit(), timestamp_utc: new Date().toISOString(), contract, ...program, ...run });
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
