// Shared, memoized data access for the verify rows. One RPC call or fetch is made at most once per run.
import { type Network, NETWORKS, type NetworkConfig } from "../config.ts";
import { ArrowViews } from "../contract.ts";
import { sha256Hex } from "../crypto.ts";
import { functionCallArgs, parseEvents, type RpcOptions, txStatus } from "../rpc.ts";
import type { Eval, EvidenceFile, EvidenceRun, Listing } from "../schemas.ts";
import { type Attestation, fetchAttestation } from "./attestation.ts";
import type { VerifyOptions } from "./types.ts";

export type EvidenceKind = EvidenceRun["kind"];

export interface EvalFacts {
  run: EvidenceRun;
  tx: any | null;
  requestId: number | null;
  inputData: string | null;
  attestation: Attestation | null;
  /** Why attestation is null (or "ok"): printed in row details, never turned into a pass. */
  note: string;
}

export const num = (v: number | string): number => Number(v);

export interface RequestEvent {
  requestId: number;
  /** request_data.predecessor_id: the account that called outlayer's request_execution (the market contract). */
  predecessorId: string | null;
  /** request_data.sender_id: the transaction signer. */
  senderId: string | null;
}

/** near-outlayer execution_requested events in the tx; request_data is a JSON string inside the event. */
export function requestEvents(tx: any): RequestEvent[] {
  const out: RequestEvent[] = [];
  for (const ev of parseEvents(tx)) {
    if (ev.standard !== "near-outlayer" || ev.event !== "execution_requested") continue;
    const items = Array.isArray(ev.data) ? ev.data : [ev.data];
    for (const item of items) {
      let rd = item?.request_data;
      if (typeof rd === "string") {
        try {
          rd = JSON.parse(rd);
        } catch {
          continue;
        }
      }
      const id = rd?.request_id;
      if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) {
        out.push({ requestId: Number(id), predecessorId: typeof rd.predecessor_id === "string" ? rd.predecessor_id : null, senderId: typeof rd.sender_id === "string" ? rd.sender_id : null });
      }
    }
  }
  return out;
}

/** request_id inside the near-outlayer execution_requested event. */
export const findRequestId = (tx: any): number | null => requestEvents(tx)[0]?.requestId ?? null;

export class VerifyCtx {
  readonly network: Network;
  readonly cfg: NetworkConfig;
  readonly contract: string;
  readonly evidence: EvidenceFile;
  readonly fetch: typeof fetch;
  readonly rpcOpts: RpcOptions;
  readonly views: ArrowViews;
  readonly now: Date;
  private memo = new Map<string, Promise<any>>();
  private sender: string | undefined;

  constructor(readonly opts: VerifyOptions) {
    this.network = opts.network;
    this.cfg = NETWORKS[opts.network];
    this.evidence = opts.evidence;
    this.contract = opts.contract ?? opts.evidence.contract ?? this.cfg.contract;
    this.fetch = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? new Date();
    this.rpcOpts = { fetchImpl: this.fetch };
    this.views = new ArrowViews(this.network, this.contract, this.rpcOpts);
  }

  once<T>(key: string, make: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key);
    if (!p) {
      p = make();
      this.memo.set(key, p);
    }
    return p;
  }

  /** Runs of these kinds on this contract (STATE-2: a run that names another contract reads that contract's ids, not ours). */
  runs(...kinds: EvidenceKind[]): EvidenceRun[] {
    return this.evidence.runs.filter((r) => kinds.includes(r.kind) && (r.contract === undefined || r.contract === this.contract));
  }

  config() {
    return this.once("config", () => this.views.config());
  }

  /** Accounts that might have signed an evidence tx, most likely first (EXPERIMENTAL_tx_status needs the signer). */
  private senderCandidates(): string[] {
    const acc = Object.entries(this.evidence.accounts);
    const rank = ([k]: [string, string]) => (k === "relayer" ? 0 : /buyer/.test(k) ? 1 : /seller/.test(k) ? 2 : 3);
    const ordered = acc.sort((a, b) => rank(a) - rank(b)).map(([, v]) => v);
    return [...new Set([...(this.sender ? [this.sender] : []), ...ordered, this.contract])];
  }

  /** Full receipt tree of an evidence tx from the archival RPC. Tries the likely signers until one is known. */
  tx(hash: string, signers?: string[]): Promise<any> {
    return this.once(`tx:${hash}`, async () => {
      let last: unknown;
      for (const who of [...(signers ?? []), ...this.senderCandidates()]) {
        try {
          const t = await txStatus(this.network, hash, who, "FINAL", { ...this.rpcOpts, archival: true });
          this.sender = who;
          return t;
        } catch (e) {
          last = e;
        }
      }
      throw new Error(`tx ${hash} not found via archival RPC (${(last as Error)?.message ?? "no signer candidates"})`);
    });
  }

  /** The eval tx, its OutLayer request_id and input_data, and the stored attestation (if any). */
  facts(run: EvidenceRun): Promise<EvalFacts> {
    return this.once(`facts:${run.id}`, async () => {
      const base = { run, tx: null, requestId: null, inputData: null, attestation: null };
      if (!run.tx) return { ...base, note: "evidence run has no tx" };
      let tx: any;
      try {
        tx = await this.tx(run.tx);
      } catch (e) {
        return { ...base, note: `archival unavailable: ${(e as Error).message}` };
      }
      const inputs = functionCallArgs(tx, { receiverId: this.cfg.outlayer, methodName: "request_execution" });
      const inputData = inputs.map((a) => a?.input_data).find((d) => typeof d === "string") ?? null;
      const requestId = findRequestId(tx);
      if (requestId === null) return { ...base, tx, inputData, note: "no execution_requested event in the tx" };
      try {
        const attestation = await fetchAttestation(this.cfg.outlayerApi, requestId, this.fetch);
        return { run, tx, requestId, inputData, attestation, note: attestation ? "ok" : "attestation not stored" };
      } catch (e) {
        return { run, tx, requestId, inputData, attestation: null, note: (e as Error).message };
      }
    });
  }

  evalFacts(): Promise<EvalFacts[]> {
    return this.once("evalFacts", async () => {
      const out: EvalFacts[] = [];
      for (const r of this.runs("eval")) if (r.tx) out.push(await this.facts(r));
      return out;
    });
  }

  /** sha256 of the bytes behind a URL. Throws on a non-2xx answer. */
  urlSha256(url: string): Promise<string> {
    return this.once(`url:${url}`, async () => {
      const res = await this.fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
      return sha256Hex(new Uint8Array(await res.arrayBuffer()));
    });
  }

  private async paged<T>(get: (from: number) => Promise<T[]>): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += 50) {
      const page = await get(from);
      all.push(...page);
      if (page.length < 50) return all;
    }
  }

  listings(): Promise<Listing[]> {
    return this.once("listings", () => this.views.allListings());
  }

  evalsOf(listingId: number | string): Promise<Eval[]> {
    return this.once(`evals:${listingId}`, () => this.paged((from) => this.views.evalsByListing(listingId, { from, limit: 50 })));
  }

  purchase(id: number | string) {
    return this.once(`purchase:${id}`, () => this.views.purchase(id));
  }
  eval(id: number | string) {
    return this.once(`eval:${id}`, () => this.views.eval(id));
  }
  leakBudget(id: number | string) {
    return this.once(`leak:${id}`, () => this.views.leakBudget(id));
  }
}
