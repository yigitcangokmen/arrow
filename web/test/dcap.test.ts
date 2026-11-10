// WS5-T07: the in-browser DCAP check with a fake verifier module and a fake network.
import { describe, expect, it, vi } from "vitest";
import { checkQuote, type DcapDeps, type DcapModule, PCCS_URL, shortHex } from "../lib/dcap.ts";
import { CAVEAT, fetchNearAiLine } from "../lib/nearAi.ts";

const QUOTE = Buffer.from(new Uint8Array(700).fill(7)).toString("base64");
const collateral = { tcb_info: "x" };
const bytes = (n: number, v: number) => new Uint8Array(n).fill(v);
const report = { type: "td10", data: { mrTd: bytes(48, 0xaa), rtMr0: bytes(48, 0xbb), rtMr1: bytes(48, 0xcc), rtMr2: bytes(48, 0xdd), rtMr3: bytes(48, 0xee), reportData: bytes(64, 0xff) } };

function setup(over: { status?: string; advisory?: string[]; verifyThrows?: boolean; pccs?: () => Promise<unknown> } = {}) {
  const verify = vi.fn((_q: Uint8Array, _c: unknown, _now: number) => {
    if (over.verifyThrows) throw new Error("Signature is invalid for qe_identity");
    return { status: over.status ?? "UpToDate", advisory_ids: over.advisory ?? [], report };
  });
  const mod: DcapModule = { verify, getCollateral: vi.fn(over.pccs ?? (async () => collateral)) };
  const deps: DcapDeps = { load: async () => mod, nowSeconds: () => 1_762_000_000.9 };
  return { mod, verify, deps };
}

describe("checkQuote", () => {
  it("UpToDate is PROVEN, names its collateral source and passes whole seconds", async () => {
    const s = setup();
    const r = await checkQuote(QUOTE, s.deps);
    expect(r).toMatchObject({ label: "PROVEN", status: "UpToDate", source: "pccs.phala.network" });
    expect(r.text).toBe("Intel TDX quote served by OutLayer for this request verifies against Intel collateral (source: pccs.phala.network): UpToDate");
    expect(s.verify.mock.calls[0]![2]).toBe(1_762_000_000);
    expect(s.mod.getCollateral).toHaveBeenCalledWith(PCCS_URL, expect.any(Uint8Array));
  });

  it("shows the measurements as hex; report_data is cut to its first 32 bytes", async () => {
    const r = await checkQuote(QUOTE, setup().deps);
    expect(r.fields).toMatchObject({ mr_td: "aa".repeat(48), rt_mr0: "bb".repeat(48), rt_mr3: "ee".repeat(48) });
    expect(r.fields!.report_data).toBe("ff".repeat(32));
    expect(shortHex("a".repeat(96))).toBe("aaaaaaaaaaaaaaaa…aaaaaaaa");
    expect(shortHex("")).toBe("n/a");
  });

  it("CI-2: the collateral is never taken from OutLayer, the party being verified", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await checkQuote(QUOTE, setup().deps);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("known advisories are RISKY and listed", async () => {
    for (const status of ["SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded", "OutOfDate", "TDRelaunchAdvised"]) {
      const r = await checkQuote(QUOTE, setup({ status, advisory: ["INTEL-SA-00837", "INTEL-SA-00960"] }).deps);
      expect(r.label, status).toBe("RISKY");
      expect(r.advisoryIds).toEqual(["INTEL-SA-00837", "INTEL-SA-00960"]);
      expect(r.text).toContain("INTEL-SA-00837, INTEL-SA-00960");
    }
  });

  it("an unknown or revoked status is never a pass", async () => {
    for (const status of ["Revoked", "Unknown"]) {
      const r = await checkQuote(QUOTE, setup({ status }).deps);
      expect(r.label).toBe("NOT PROVEN");
      expect(r.text).toContain("not treated as a pass");
    }
  });

  it("a verification error is NOT PROVEN with the reason", async () => {
    const r = await checkQuote(QUOTE, setup({ verifyThrows: true }).deps);
    expect(r).toMatchObject({ label: "NOT PROVEN", status: null, source: "pccs.phala.network" });
    expect(r.text).toContain("Signature is invalid for qe_identity");
  });

  it("no collateral is NOT PROVEN (collateral unavailable)", async () => {
    const s = setup({ pccs: async () => { throw new Error("Failed to fetch"); } });
    const r = await checkQuote(QUOTE, s.deps);
    expect(r.label).toBe("NOT PROVEN");
    expect(r.text).toMatch(/^NOT PROVEN \(collateral unavailable\)/);
    expect(s.verify).not.toHaveBeenCalled();
  });

  it("a broken quote or a verifier that will not load is NOT PROVEN, not an exception", async () => {
    expect((await checkQuote("%%%", setup().deps)).label).toBe("NOT PROVEN");
    const s = setup();
    const r = await checkQuote(QUOTE, { ...s.deps, load: async () => { throw new Error("module blocked"); } });
    expect(r).toMatchObject({ label: "NOT PROVEN" });
    expect(r.text).toContain("module blocked");
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
