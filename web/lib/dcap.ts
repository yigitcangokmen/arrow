// In-browser DCAP check of the TDX quote OutLayer stored for one request (WS5-T07, DEC O-07).
// The Phala wasm verifier is loaded only when this runs. Everything the check needs is injected so the tests run
// without a network and without the wasm.
export type ProofLabel = "PROVEN" | "NOT PROVEN" | "RISKY";

export interface DcapModule {
  default(init: { module_or_path: string }): Promise<unknown>;
  js_verify(quote: Uint8Array, collateral: unknown, nowSeconds: bigint): any;
  js_get_collateral(pccsUrl: string, quote: Uint8Array): Promise<unknown>;
}

export interface DcapDeps {
  load(): Promise<DcapModule>;
  fetchJson(url: string): Promise<unknown>;
  nowSeconds(): number;
}

export const PCCS_URL = "https://pccs.phala.network/tdx/certification/v4";
export const WASM_PATH = "/dcap/dcap-qvl-web_bg.wasm";
/** The 9 keys of a Phala quote collateral. A different shape from OutLayer is not used. */
export const COLLATERAL_KEYS = [
  "pck_crl_issuer_chain", "root_ca_crl", "pck_crl", "tcb_info_issuer_chain", "tcb_info", "tcb_info_signature",
  "qe_identity_issuer_chain", "qe_identity", "qe_identity_signature",
] as const;

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
  source: "OutLayer" | "pccs.phala.network" | null;
  advisoryIds: string[];
  fields: DcapFields | null;
  text: string;
}

const RISKY_STATUS = /^(SWHardeningNeeded|ConfigurationNeeded|ConfigurationAndSWHardeningNeeded|OutOfDate\w*)$/;
const TIMEOUT_MS = 20_000;

export const base64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const isCollateral = (v: unknown): boolean => typeof v === "object" && v !== null && COLLATERAL_KEYS.every((k) => k in v);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

const hexOf = (v: unknown): string => (typeof v === "string" ? v : "");

function fieldsOf(report: any): DcapFields | null {
  const td = report?.TD10 ?? report?.TD15?.base;
  if (!td) return null;
  return {
    mr_td: hexOf(td.mr_td), rt_mr0: hexOf(td.rt_mr0), rt_mr1: hexOf(td.rt_mr1), rt_mr2: hexOf(td.rt_mr2), rt_mr3: hexOf(td.rt_mr3),
    report_data: hexOf(td.report_data).slice(0, 64),
  };
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** OutLayer's own collateral route first; when it is missing or shaped differently, the Phala PCCS. */
async function collateral(mod: DcapModule, quote: Uint8Array, outlayerApi: string, deps: DcapDeps): Promise<{ value: unknown; source: "OutLayer" | "pccs.phala.network" }> {
  try {
    const value = await withTimeout(deps.fetchJson(`${outlayerApi.replace(/\/+$/, "")}/tdx/collateral`), TIMEOUT_MS, "OutLayer collateral");
    if (isCollateral(value)) return { value, source: "OutLayer" };
  } catch {
    // the route answers 404 today; fall through to the PCCS
  }
  return { value: await withTimeout(mod.js_get_collateral(PCCS_URL, quote), TIMEOUT_MS, "PCCS collateral"), source: "pccs.phala.network" };
}

/** PROVEN only for status UpToDate. Known advisories are RISKY. Anything that throws or is unknown is NOT PROVEN. */
export async function checkQuote(quoteB64: string, outlayerApi: string, deps: DcapDeps): Promise<DcapResult> {
  const none: Omit<DcapResult, "label" | "text"> = { status: null, source: null, advisoryIds: [], fields: null };
  let mod: DcapModule;
  let quote: Uint8Array;
  try {
    quote = base64ToBytes(quoteB64);
    mod = await deps.load();
    await mod.default({ module_or_path: WASM_PATH });
  } catch (e) {
    return { label: "NOT PROVEN", ...none, text: `The TDX quote could not be checked in this browser: ${errText(e)}` };
  }
  let col: Awaited<ReturnType<typeof collateral>>;
  try {
    col = await collateral(mod, quote, outlayerApi, deps);
  } catch (e) {
    return { label: "NOT PROVEN", ...none, text: `NOT PROVEN (collateral unavailable): ${errText(e)}` };
  }
  try {
    // The third argument is a BigInt: a Number makes wasm-bindgen throw.
    const res = mod.js_verify(quote, col.value, BigInt(Math.floor(deps.nowSeconds())));
    const status = typeof res?.status === "string" ? res.status : "unknown";
    const advisoryIds = Array.isArray(res?.advisory_ids) ? res.advisory_ids.map(String) : [];
    const fields = fieldsOf(res?.report);
    const base = `Intel TDX quote served by OutLayer for this request verifies against Intel collateral (source: ${col.source}): ${status}`;
    if (status === "UpToDate") return { label: "PROVEN", status, source: col.source, advisoryIds, fields, text: base };
    if (RISKY_STATUS.test(status)) {
      return { label: "RISKY", status, source: col.source, advisoryIds, fields, text: `${base}${advisoryIds.length ? ` (advisories: ${advisoryIds.join(", ")})` : ""}` };
    }
    return { label: "NOT PROVEN", status, source: col.source, advisoryIds, fields, text: `${base}; this status is not treated as a pass` };
  } catch (e) {
    return { label: "NOT PROVEN", ...none, source: col.source, text: `Intel TDX quote did not verify against Intel collateral (source: ${col.source}): ${errText(e)}` };
  }
}

/** "7fe60787…6297": the full value stays in the title attribute. */
export const shortHex = (h: string): string => (h.length > 20 ? `${h.slice(0, 16)}…${h.slice(-8)}` : h || "n/a");
