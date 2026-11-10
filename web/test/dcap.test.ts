// WS5-T07: the in-browser DCAP check with a fake verifier module and a fake network.
import { describe, expect, it, vi } from "vitest";
import { checkQuote, COLLATERAL_KEYS, type DcapDeps, type DcapModule, PCCS_URL, shortHex } from "../lib/dcap.ts";
import { CAVEAT, fetchNearAiLine } from "../lib/nearAi.ts";

const QUOTE = Buffer.from(new Uint8Array(700).fill(7)).toString("base64");
const API = "https://api.outlayer.ai";
const collateral = Object.fromEntries(COLLATERAL_KEYS.map((k) => [k, "x"]));
const hex = (c: string, n = 96) => c.repeat(n);
const report = { TD10: { mr_td: hex("a"), rt_mr0: hex("b"), rt_mr1: hex("c"), rt_mr2: hex("d"), rt_mr3: hex("e"), report_data: hex("f", 128) } };

function setup(over: { status?: string; advisory?: string[]; verifyThrows?: boolean; outlayer?: () => Promise<unknown>; pccs?: () => Promise<unknown> } = {}) {
  const verify = vi.fn((_q: Uint8Array, _c: unknown, _now: bigint) => {
    if (over.verifyThrows) throw new Error("TCB level not supported");
    return { status: over.status ?? "UpToDate", advisory_ids: over.advisory ?? [], report };
  });
  const mod: DcapModule = {
    default: vi.fn(async () => ({})),
    js_verify: verify,
    js_get_collateral: vi.fn(over.pccs ?? (async () => collateral)),
  };
  const fetchJson = vi.fn(over.outlayer ?? (async () => { throw new Error("HTTP 404"); }));
  const deps: DcapDeps = { load: async () => mod, fetchJson, nowSeconds: () => 1_762_000_000.9 };
  return { mod, verify, fetchJson, deps };
}

describe("checkQuote", () => {
  it("UpToDate is PROVEN, names its collateral source and passes the time as a BigInt", async () => {
    const s = setup();
    const r = await checkQuote(QUOTE, API, s.deps);
    expect(r).toMatchObject({ label: "PROVEN", status: "UpToDate", source: "pccs.phala.network" });
    expect(r.text).toBe("Intel TDX quote served by OutLayer for this request verifies against Intel collateral (source: pccs.phala.network): UpToDate");
    expect(typeof s.verify.mock.calls[0]![2]).toBe("bigint");
    expect(s.verify.mock.calls[0]![2]).toBe(1_762_000_000n);
    expect(s.mod.js_get_collateral).toHaveBeenCalledWith(PCCS_URL, expect.any(Uint8Array));
    expect(s.mod.default).toHaveBeenCalledWith({ module_or_path: "/dcap/dcap-qvl-web_bg.wasm" });
    expect(s.fetchJson).toHaveBeenCalledWith(`${API}/tdx/collateral`);
  });

  it("shows the measurements; report_data is cut to its first 32 bytes", async () => {
    const r = await checkQuote(QUOTE, API, setup().deps);
    expect(r.fields).toMatchObject({ mr_td: hex("a"), rt_mr0: hex("b"), rt_mr3: hex("e") });
    expect(r.fields!.report_data).toBe(hex("f", 64));
    expect(shortHex(hex("a"))).toBe("aaaaaaaaaaaaaaaa…aaaaaaaa");
    expect(shortHex("")).toBe("n/a");
  });

  it("OutLayer collateral is used when it has the Phala shape", async () => {
    const s = setup({ outlayer: async () => collateral });
    const r = await checkQuote(QUOTE, API, s.deps);
    expect(r.source).toBe("OutLayer");
    expect(s.mod.js_get_collateral).not.toHaveBeenCalled();
  });

  it("OutLayer collateral in another shape is ignored and the PCCS is used", async () => {
    const s = setup({ outlayer: async () => ({ tcb_info: "x" }) });
    const r = await checkQuote(QUOTE, API, s.deps);
    expect(r.source).toBe("pccs.phala.network");
    expect(s.verify.mock.calls[0]![1]).toBe(collateral);
  });

  it("known advisories are RISKY and listed", async () => {
    for (const status of ["SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded", "OutOfDate"]) {
      const r = await checkQuote(QUOTE, API, setup({ status, advisory: ["INTEL-SA-00837", "INTEL-SA-00960"] }).deps);
      expect(r.label, status).toBe("RISKY");
      expect(r.advisoryIds).toEqual(["INTEL-SA-00837", "INTEL-SA-00960"]);
      expect(r.text).toContain("INTEL-SA-00837, INTEL-SA-00960");
    }
  });

  it("an unknown status is never a pass", async () => {
    const r = await checkQuote(QUOTE, API, setup({ status: "Revoked" }).deps);
    expect(r.label).toBe("NOT PROVEN");
    expect(r.text).toContain("not treated as a pass");
  });

  it("a verification error is NOT PROVEN with the reason", async () => {
    const r = await checkQuote(QUOTE, API, setup({ verifyThrows: true }).deps);
    expect(r).toMatchObject({ label: "NOT PROVEN", status: null, source: "pccs.phala.network" });
    expect(r.text).toContain("TCB level not supported");
  });

  it("no collateral anywhere is NOT PROVEN (collateral unavailable)", async () => {
    const s = setup({ pccs: async () => { throw new Error("Failed to fetch"); } });
    const r = await checkQuote(QUOTE, API, s.deps);
    expect(r.label).toBe("NOT PROVEN");
    expect(r.text).toMatch(/^NOT PROVEN \(collateral unavailable\)/);
    expect(s.verify).not.toHaveBeenCalled();
  });

  it("a broken quote or a wasm that will not load is NOT PROVEN, not an exception", async () => {
    expect((await checkQuote("%%%", API, setup().deps)).label).toBe("NOT PROVEN");
    const s = setup();
    const r = await checkQuote(QUOTE, API, { ...s.deps, load: async () => { throw new Error("wasm blocked"); } });
    expect(r).toMatchObject({ label: "NOT PROVEN" });
    expect(r.text).toContain("wasm blocked");
  });
});

describe("fetchNearAiLine", () => {
  const prefix = "https://cloud-api.near.ai/v1/attestation/report?model=Qwen%2FQwen3.8-27B&provider=near&signing_algo=ecdsa";
  const at = new Date("2026-11-12T09:30:45Z");
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("is NOT PROVEN, says it is the current endpoint state and when it was fetched", async () => {
    const l = await fetchNearAiLine(prefix, ok({ gateway_attestation: { signing_address: "0xabc" } }), at);
    expect(l.label).toBe("NOT PROVEN");
    expect(l.text).toContain(CAVEAT);
    expect(l.text).toContain("fetched 2026-11-12 09:30 UTC");
    expect(l.signingAddress).toBe("0xabc");
  });

  it("sends a fresh 32-byte nonce", async () => {
    const urls: string[] = [];
    await fetchNearAiLine(prefix, (async (u: any) => { urls.push(String(u)); return new Response("{}"); }) as typeof fetch, at);
    expect(urls[0]).toMatch(/&nonce=[0-9a-f]{64}$/);
  });

  it("an HTTP error or a network error is still NOT PROVEN and still says what it is", async () => {
    const e = await fetchNearAiLine(prefix, (async () => new Response("", { status: 503 })) as typeof fetch, at);
    expect(e).toMatchObject({ label: "NOT PROVEN", signingAddress: null });
    expect(e.text).toContain("unavailable (HTTP 503)");
    const n = await fetchNearAiLine(prefix, (async () => { throw new Error("CORS"); }) as typeof fetch, at);
    expect(n.text).toContain("unavailable");
    expect(n.text).toContain(CAVEAT);
  });
});
