// Server side of /verify and /verify/[evalId]: the rows come from the same engine the CLI runs (`@arrow/sdk/verify`),
// so the page can never say more than `npm run verify` does. Inputs are injected; the pages pass the generated evidence.
import { NETWORKS } from "@arrow/sdk/config";
import { EvidenceFile, type Eval, type EvidenceRun } from "@arrow/sdk/schemas";
import { runVerify, VerifyCtx, type Attestation, type Report, type TeamAccounts, type VerifyOptions } from "@arrow/sdk/verify";
import type { Network } from "../config.ts";

export interface VerifyInputs {
  network: Network;
  /** The recorded evidence file for this network (generated/data.ts); null when the file does not exist. */
  evidence: unknown;
  releaseSha256?: string | null;
  /** NEAR accounts and EVM addresses of the team, flat (generated/data.ts). */
  teamAccounts?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** null when there is no evidence file at all; a file that does not parse throws (the page shows an error). */
export function parseEvidence(raw: unknown): EvidenceFile | null {
  return raw === null || raw === undefined ? null : EvidenceFile.parse(raw);
}

const teamOf = (flat: readonly string[] | undefined): TeamAccounts | undefined =>
  flat ? { near: flat.filter((a) => !a.startsWith("0x")), evm: flat.filter((a) => a.startsWith("0x")).map((address) => ({ address })) } : undefined;

export function optionsOf(i: VerifyInputs, evidence: EvidenceFile): VerifyOptions {
  return {
    network: i.network,
    evidence,
    ...(i.releaseSha256 ? { releaseSha256: i.releaseSha256 } : {}),
    teamAccounts: teamOf(i.teamAccounts),
    ...(i.fetchImpl ? { fetchImpl: i.fetchImpl } : {}),
    ...(i.now ? { now: i.now } : {}),
  };
}

/** The report for the whole evidence file: what `npm run verify -- --network <n> --json` prints. */
export async function loadReport(i: VerifyInputs): Promise<{ report: Report | null; evidence: EvidenceFile | null }> {
  const evidence = parseEvidence(i.evidence);
  if (!evidence) return { report: null, evidence: null };
  return { report: await runVerify(optionsOf(i, evidence)), evidence };
}

export interface AttestationFacts {
  requestId: number;
  record: Attestation;
}

export interface EvalPageData {
  evalId: number;
  /** The evidence run for this eval; null when the eval tx is not in the evidence file. */
  run: EvidenceRun | null;
  /** The contract's own view of the eval; null when the contract has no such eval. */
  onChain: Eval | null;
  /** The engine rows that concern this eval (wasm hash, attestation), only when the run is in evidence. The listing-level rows stay on /verify. */
  report: Report | null;
  attestation: AttestationFacts | null;
  /** Why there is no attestation (never turned into a pass). */
  attestationNote: string | null;
  /** Set when the on-chain view could not be read. */
  viewError: string | null;
  /** The recorded listing and purchase of the same listing on this market, for the page's plain timeline; null when not recorded. */
  story: { list: EvidenceRun | null; buy: EvidenceRun | null };
}

export const isEvalId = (s: string): boolean => /^\d{1,12}$/.test(s);

/** The rows that make sense for one eval: the evidence is cut down to this eval's tx, so R2 and the I rows speak about this eval only. */
export async function loadEval(i: VerifyInputs, evalId: number): Promise<EvalPageData> {
  const evidence = parseEvidence(i.evidence);
  const base = optionsOf(i, evidence ?? { network: i.network, contract: NETWORKS[i.network].contract, contract_wasm_sha256: null, program_wasm_sha256: null, program_wasm_url: null, lock: { tx: null, block_height: null, timestamp_utc: null }, accounts: {}, runs: [], corrections: [] });

  const ctx = new VerifyCtx(base);
  // Only runs on this market's contract: an earlier testnet market reused the same eval ids (STATE-2), and its runs would fail every row here.
  const runs = ctx.runs("eval").filter((r) => r.tx && Number(r.eval_id) === evalId);
  const run = runs.at(-1) ?? null;
  let onChain: Eval | null = null;
  let viewError: string | null = null;
  try {
    onChain = (await ctx.eval(evalId)) as Eval | null;
  } catch (e) {
    viewError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  if (!evidence || !run) return { evalId, run: null, onChain, report: null, attestation: null, attestationNote: null, viewError, story: { list: null, buy: null } };
  const sameListing = (r: EvidenceRun) => Boolean(r.tx) && run.listing_id !== null && Number(r.listing_id) === Number(run.listing_id);
  const story = { list: ctx.runs("list").filter(sameListing).at(-1) ?? null, buy: ctx.runs("buy").filter(sameListing).at(-1) ?? null };

  const only = { ...base, evidence: { ...evidence, runs: evidence.runs.filter((r) => r.kind !== "eval" || r === run) }, only: ["wasm", "attestation"] as VerifyOptions["only"] };
  const [report, facts] = await Promise.all([runVerify(only), ctx.facts(run)]);
  let attestation: AttestationFacts | null = null;
  if (facts.attestation && facts.requestId !== null) attestation = { requestId: facts.requestId, record: facts.attestation };
  return { evalId, run, onChain, report, attestation, attestationNote: attestation ? null : facts.note, viewError, story };
}

// The last summary line /verify computed in this server instance, per network, with the time it was computed, so the home page
// can quote it ("as of YYYY-MM-DD HH:MM UTC") without starting a run of its own (about 90 s). Nothing remembered means the line is left out.
export interface RememberedSummary {
  line: string;
  /** "YYYY-MM-DD HH:MM UTC" of the run that produced the line. */
  at: string;
}
const lastLines = new Map<Network, RememberedSummary>();
export const rememberSummary = (net: Network, line: string, now: Date = new Date()): void =>
  void lastLines.set(net, { line, at: `${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)} UTC` });
export const lastSummary = (net: Network): RememberedSummary | null => lastLines.get(net) ?? null;
