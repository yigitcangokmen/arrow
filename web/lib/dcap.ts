// In-browser DCAP check of the TDX quote OutLayer stored for one request (WS5-T07, DEC O-07).
// The pure-JS verifier @phala/dcap-qvl (>= 0.3.9) checks the quote, the TCB info and the QE identity signature against Intel's
// root CA. The earlier wasm build @phala/dcap-qvl-web 0.3.3 did not check the QE identity (GHSA-796p-j2gh-9m2q) and has no
// fixed release. Everything the check needs is injected so the tests run without a network.
export type ProofLabel = "PROVEN" | "NOT PROVEN" | "RISKY";

/** The members of @phala/dcap-qvl used here. */
export interface DcapModule {
  verify(quote: Uint8Array, collateral: unknown, nowSecs: number): DcapVerified;
  getCollateral(pccsUrl: string, quote: Uint8Array): Promise<unknown>;
}

export interface DcapVerified {
  status: string;
  advisory_ids?: string[];
  report?: { type?: string; data?: unknown };
}

export interface DcapDeps {
  load(): Promise<DcapModule>;
  nowSeconds(): number;
}

export const PCCS_URL = "https://pccs.phala.network/tdx/certification/v4";

export interface DcapFields {
  mr_td: string;
  rt_mr0: string;
  rt_mr1: string;
  rt_mr2: string;
  rt_mr3: string;
  /** First 32 bytes of the 64-byte report_data (OutLayer: the worker public key). */
  report_data: string;
}

export interface DcapResult {
  label: ProofLabel;
  /** js_verify status, e.g. "UpToDate"; null when verification did not run. */
  status: string | null;
  source: "pccs.phala.network" | null;
  advisoryIds: string[];
  fields: DcapFields | null;
  text: string;
}

const RISKY_STATUS = /^(SWHardeningNeeded|ConfigurationNeeded|ConfigurationAndSWHardeningNeeded|OutOfDate\w*|TDRelaunchAdvised\w*)$/;
const TIMEOUT_MS = 20_000;

export const base64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

const hexOf = (v: unknown): string => (v instanceof Uint8Array ? Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("") : typeof v === "string" ? v : "");

/** The measurements of a TDX 1.0 or 1.5 report as hex (the library returns bytes, camelCase). */
function fieldsOf(report: DcapVerified["report"]): DcapFields | null {
  const d = report?.data as { mrTd?: unknown; rtMr0?: unknown; rtMr1?: unknown; rtMr2?: unknown; rtMr3?: unknown; reportData?: unknown; base?: unknown } | undefined;
  const td = (d && "mrTd" in d ? d : (d?.base as typeof d)) ?? undefined;
  if (!td || !("mrTd" in td)) return null;
  return {
    mr_td: hexOf(td.mrTd), rt_mr0: hexOf(td.rtMr0), rt_mr1: hexOf(td.rtMr1), rt_mr2: hexOf(td.rtMr2), rt_mr3: hexOf(td.rtMr3),
    report_data: hexOf(td.reportData).slice(0, 64),
  };
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * PROVEN only for status UpToDate. Known advisories are RISKY. Anything that throws or is unknown is NOT PROVEN.
 * The collateral comes from the Phala PCCS and never from OutLayer, the party being verified; the library checks every
 * collateral signature (CRLs, TCB info, QE identity) against Intel's root CA, so the PCCS is a cache, not a trust anchor.
 */
export async function checkQuote(quoteB64: string, deps: DcapDeps): Promise<DcapResult> {
  const none: Omit<DcapResult, "label" | "text"> = { status: null, source: null, advisoryIds: [], fields: null };
  let mod: DcapModule;
  let quote: Uint8Array;
  try {
    quote = base64ToBytes(quoteB64);
    mod = await deps.load();
  } catch (e) {
    return { label: "NOT PROVEN", ...none, text: `The TDX quote could not be checked in this browser: ${errText(e)}` };
  }
  let collateral: unknown;
  try {
    collateral = await withTimeout(mod.getCollateral(PCCS_URL, quote), TIMEOUT_MS, "PCCS collateral");
  } catch (e) {
    return { label: "NOT PROVEN", ...none, text: `NOT PROVEN (collateral unavailable): ${errText(e)}` };
  }
  const source = "pccs.phala.network" as const;
  try {
    const res = mod.verify(quote, collateral, Math.floor(deps.nowSeconds()));
    const status = typeof res?.status === "string" ? res.status : "unknown";
    const advisoryIds = Array.isArray(res?.advisory_ids) ? res.advisory_ids.map(String) : [];
    const fields = fieldsOf(res?.report);
    const base = `Intel TDX quote served by OutLayer for this request verifies against Intel collateral (source: ${source}): ${status}`;
    if (status === "UpToDate") return { label: "PROVEN", status, source, advisoryIds, fields, text: base };
    if (RISKY_STATUS.test(status)) {
      return { label: "RISKY", status, source, advisoryIds, fields, text: `${base}${advisoryIds.length ? ` (advisories: ${advisoryIds.join(", ")})` : ""}` };
    }
    return { label: "NOT PROVEN", status, source, advisoryIds, fields, text: `${base}; this status is not treated as a pass` };
  } catch (e) {
    return { label: "NOT PROVEN", ...none, source, text: `Intel TDX quote did not verify against Intel collateral (source: ${source}): ${errText(e)}` };
  }
}

/** "7fe60787…6297": the full value stays in the title attribute. */
export const shortHex = (h: string): string => (h.length > 20 ? `${h.slice(0, 16)}…${h.slice(-8)}` : h || "n/a");
