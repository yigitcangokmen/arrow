// The recorded run on /try/recorded: the steps of one finished testnet run (listing #14, eval #14, purchase #5), with the
// transaction of each step from the evidence file and the times and fingerprints read from the chain.
import { EvidenceFile, type Eval, type Listing, type Purchase } from "@arrow/sdk/schemas";
import { CONTRACTS } from "./config.ts";
import { RECORDED_RUN } from "./links.ts";

export interface ReplayStep {
  label: string;
  /** When the replay shows the step, in seconds of the real run after the inspection was paid. */
  at: number;
  /** The real time shown next to the step, only when the chain recorded it ("earlier" for the listing). */
  clock: string | null;
  detail: string;
  txHash: string | null;
}

export interface RecordedRun {
  steps: ReplayStep[];
  verdict: string | null;
  /** listing.blob_sha256, eval.h and purchase.h as the chain holds them now. */
  fingerprints: { listed: string; inspected: string | null; delivered: string | null } | null;
  match: boolean;
  paidAt: string | null;
}

const sec = (ns: string | number | null | undefined): number | null => (ns === null || ns === undefined ? null : Number(BigInt(ns) / 1_000_000n) / 1000);

/** Builds the replay. `chain` is what the views returned (null when the RPC was not reachable); the evidence alone still gives the transactions. */
export function recordedRun(evidence: unknown, chain: { listing: Listing | null; eval: Eval | null; purchase: Purchase | null } | null): RecordedRun {
  const parsed = EvidenceFile.safeParse(evidence);
  const runs = parsed.success && parsed.data.contract === CONTRACTS.testnet ? parsed.data.runs : [];
  const list = [...runs].reverse().find((r) => r.kind === "list" && Number(r.listing_id) === RECORDED_RUN.listingId) ?? null;
  const ev = runs.find((r) => r.kind === "eval" && Number(r.eval_id) === RECORDED_RUN.evalId && Number(r.listing_id) === RECORDED_RUN.listingId) ?? null;
  const buy = runs.find((r) => r.kind === "buy" && Number(r.purchase_id) === RECORDED_RUN.purchaseId) ?? null;

  const e = chain?.eval ?? null;
  const p = chain?.purchase ?? null;
  const l = chain?.listing ?? null;
  const t0 = sec(e?.created_at_ns);
  const rel = (ns: string | number | null | undefined) => {
    const t = sec(ns);
    return t === null || t0 === null ? null : Math.max(0, Math.round(t - t0));
  };
  // The verdict is sealed to the buyer's own key, so the chain shows it only sealed; the run's script recorded it in plain words.
  const verdict = ev ? (/^(BUY|PASS)[^·]*·[^·]*·[^·]*/.exec(ev.observed)?.[0].trim() ?? null) : null;
  const evalSettled = rel(e?.settled_at_ns);
  const buyAt = rel(p?.created_at_ns);
  const buySettled = rel(p?.settled_at_ns);
  const fingerprints = l ? { listed: l.blob_sha256, inspected: e?.h ?? null, delivered: p?.h ?? null } : null;
  const match = !!fingerprints && fingerprints.inspected === fingerprints.listed && fingerprints.delivered === fingerprints.listed;

  const clock = (s: number | null) => (s === null ? null : `+${s} s`);
  // Replay positions fall back to the usual timings when the chain could not be read (about a minute to a verdict).
  const vAt = evalSettled ?? 60;
  const bAt = Math.max(buyAt ?? vAt + 15, vAt + 3);
  const kAt = Math.max(buySettled ?? bAt + 10, bAt + 3);
  const steps: ReplayStep[] = [
    { label: "A seller lists a synthetic file, encrypted in their browser", at: -2, clock: "earlier", detail: l ? `listing #${l.id}: ${l.title}` : `listing #${RECORDED_RUN.listingId}`, txHash: list?.tx ?? null },
    { label: "A buyer pays the inspection fee", at: 0, clock: t0 === null ? null : "+0 s", detail: `eval #${RECORDED_RUN.evalId}`, txHash: ev?.tx ?? null },
    { label: "Arrow's program, in sealed hardware, checks the file's fingerprint, takes a 40-row sample and asks the AI", at: 2, clock: null, detail: "nothing of this step is public except its run time and work done", txHash: null },
    { label: "The verdict comes back, sealed to the buyer", at: vAt, clock: clock(evalSettled), detail: verdict ?? "done", txHash: null },
    { label: "The buyer buys the file", at: bAt, clock: clock(buyAt), detail: `purchase #${RECORDED_RUN.purchaseId}`, txHash: buy?.tx ?? null },
    { label: "The key comes back, sealed to the buyer", at: kAt, clock: clock(buySettled), detail: "the program hands over the file's key and the fingerprint of the file it fetched", txHash: null },
    {
      label: "The buyer decrypts the file and checks its fingerprint",
      at: kAt + 2,
      clock: null,
      detail: match ? "listed = inspected = delivered on chain, and the run recorded that its download matched too" : "the fingerprints are below",
      txHash: null,
    },
  ];
  return { steps, verdict, fingerprints, match, paidAt: ev?.timestamp_utc ?? null };
}
