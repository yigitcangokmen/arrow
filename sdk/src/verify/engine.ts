// Glassbox verify engine (WS4-T13, DEC O-01..O-07). Pure data in, rows out: no fs, no process, no console, so the same
// code runs in the CLI (scripts/src/verify.ts) and on the /verify page. A row is PROVEN only when an independent
// check passed. A failed or impossible check is NOT PROVEN; absence of data never turns into PROVEN.
import { INPUT_OUTPUT_HASH_SEMANTICS, type OnlyKind } from "./config.ts";
import { VerifyCtx } from "./context.ts";
import { i1, TITLE as T_I1 } from "./rows/i1.ts";
import { i2, TITLE as T_I2 } from "./rows/i2.ts";
import { i3, TITLE as T_I3 } from "./rows/i3.ts";
import { i4, TITLE as T_I4 } from "./rows/i4.ts";
import { i5, TITLE as T_I5 } from "./rows/i5.ts";
import { riskyRows } from "./rows/k.ts";
import { n1, n2 } from "./rows/n.ts";
import { r1, TITLE as T_R1 } from "./rows/r1.ts";
import { r2, TITLE as T_R2 } from "./rows/r2.ts";
import { r3, TITLE as T_R3 } from "./rows/r3.ts";
import { r4, TITLE as T_R4 } from "./rows/r4.ts";
import { r5, TITLE as T_R5 } from "./rows/r5.ts";
import { r6, TITLE as T_R6 } from "./rows/r6.ts";
import { r7, TITLE as T_R7 } from "./rows/r7.ts";
import { r8, TITLE as T_R8 } from "./rows/r8.ts";
import { row, why } from "./rows/util.ts";
import type { Report, Row, VerifyOptions } from "./types.ts";

interface RowDef {
  id: string;
  title: string;
  /** Rows that exist only on mainnet (DEC D4-15): they are not even printed on testnet. */
  mainnetOnly?: boolean;
  required: (o: VerifyOptions) => boolean;
  kinds: OnlyKind[];
  run: (ctx: VerifyCtx) => Promise<Row | Row[]>;
}

const always = () => true;
const never = () => false;

/**
 * Which `--only` kinds select which rows. e2e is the REQUIRED set plus the counts; the rest name one claim each.
 * Without --only every row runs, in this order.
 */
const DEFS: RowDef[] = [
  { id: "R1", title: T_R1, required: always, kinds: ["e2e", "wasm"], run: r1 },
  { id: "R2", title: T_R2, required: always, kinds: ["e2e", "attestation"], run: r2 },
  { id: "R3", title: T_R3, required: always, kinds: ["e2e", "g3"], run: r3 },
  { id: "R4", title: T_R4, mainnetOnly: true, required: always, kinds: ["e2e", "oneclick"], run: r4 },
  { id: "R5", title: T_R5, required: always, kinds: ["e2e", "refund"], run: r5 },
  { id: "R6", title: T_R6, mainnetOnly: true, required: (o) => !o.preLock && !o.unlockedReason, kinds: ["e2e", "lock"], run: r6 },
  { id: "R7", title: T_R7, mainnetOnly: true, required: (o) => !o.unlockedReason, kinds: ["e2e", "prelock"], run: r7 },
  { id: "R8", title: T_R8, required: always, kinds: ["e2e", "g1"], run: r8 },
  { id: "I1", title: T_I1, required: (o) => (o.semantics ?? INPUT_OUTPUT_HASH_SEMANTICS) === "confirmed-s1b", kinds: ["attestation"], run: i1 },
  { id: "I2", title: T_I2, required: never, kinds: ["attestation"], run: i2 },
  { id: "I3", title: T_I3, required: never, kinds: ["wasm"], run: i3 },
  { id: "I4", title: T_I4, required: never, kinds: ["e2e"], run: i4 },
  { id: "I5", title: T_I5, required: never, kinds: ["wasm"], run: i5 },
  { id: "N1", title: "model attestation at eval time", required: never, kinds: ["attestation"], run: n1 },
  { id: "N2", title: "TDX quote is not verified on chain", required: never, kinds: ["attestation"], run: async () => n2() },
  { id: "K", title: "known risks", required: never, kinds: [], run: riskyRows },
];

export const ROW_IDS = DEFS.map((d) => d.id);

/** Runs the selected checks. Never throws for a failed check: that is a NOT PROVEN row. */
export async function runVerify(options: VerifyOptions): Promise<Report> {
  const opts: VerifyOptions = { ...options, semantics: options.semantics ?? INPUT_OUTPUT_HASH_SEMANTICS };
  const ctx = new VerifyCtx(opts);
  const only = opts.only?.length ? opts.only : null;
  const selected = DEFS.filter((d) => (opts.network === "mainnet" || !d.mainnetOnly) && (only ? d.kinds.some((k) => only.includes(k)) : true));

  const rows: Row[] = [];
  for (const def of selected) {
    try {
      const out = await def.run(ctx);
      rows.push(...(Array.isArray(out) ? out : [out]));
    } catch (e) {
      rows.push(row(def.id, "NOT PROVEN", def.required(opts), def.title, `check could not run: ${why(e)}`));
    }
  }

  const required = rows.filter((r) => r.required);
  const proven = required.filter((r) => r.label === "PROVEN").length;
  return {
    rows,
    required: { proven, total: required.length },
    // Nothing REQUIRED ran (e.g. --only on a row that is not required): nothing was proven, so that is not a pass either.
    exitCode: required.length > 0 && proven === required.length ? 0 : 1,
    network: opts.network,
    contract: ctx.contract,
    generatedAt: ctx.now.toISOString(),
    preLock: opts.preLock === true && opts.network === "mainnet",
    ...(opts.unlockedReason ? { unlockedReason: opts.unlockedReason } : {}),
  };
}
