// The real verifier (@phala/dcap-qvl, pure JS) on a real OutLayer TDX quote (sdk/test/fixtures/attestation-15850.json) with
// Intel collateral captured from the Phala PCCS on 2026-11-11 (fixtures/dcap-collateral-attestation-15850.json). The check runs
// at the capture time, so it is deterministic and offline. X12-1 / CI-2: the version this replaces (dcap-qvl-web 0.3.3) still
// answered UpToDate when the QE identity signature was zeroed or the QE identity was rewritten.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { checkQuote, type DcapDeps, type DcapModule } from "../lib/dcap.ts";

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const att = load<{ tdx_quote: string }>("../../sdk/test/fixtures/attestation-15850.json");
const { capturedAtSecs, collateral } = load<{ capturedAtSecs: number; collateral: Record<string, unknown> }>("./fixtures/dcap-collateral-attestation-15850.json");
const real = createRequire(import.meta.url)("@phala/dcap-qvl") as { verify: DcapModule["verify"] };

/** The real verify, with collateral from the fixture (possibly tampered) instead of the network. */
const depsWith = (col: Record<string, unknown>): DcapDeps => ({
  load: async () => ({ verify: real.verify, getCollateral: async () => col }),
  nowSeconds: () => capturedAtSecs,
});

describe("DCAP check with the real verifier, offline", () => {
  it("the untouched quote and collateral verify, with real measurements", async () => {
    const r = await checkQuote(att.tdx_quote, depsWith(collateral));
    expect(["PROVEN", "RISKY"]).toContain(r.label);
    expect(r.fields!.mr_td).toMatch(/^[0-9a-f]{96}$/);
    expect(r.fields!.report_data).toMatch(/^[0-9a-f]{64}$/);
  });

  it("X12-1: a zeroed QE identity signature is NOT PROVEN", async () => {
    const sig = collateral.qe_identity_signature as number[];
    const r = await checkQuote(att.tdx_quote, depsWith({ ...collateral, qe_identity_signature: sig.map(() => 0) }));
    expect(r.label).toBe("NOT PROVEN");
    expect(r.status).toBeNull();
    expect(r.text).toMatch(/qe_identity/);
  });

  it("X12-1: a rewritten QE identity (another MRSIGNER, ISVPRODID 99) with the old signature is NOT PROVEN", async () => {
    const qi = JSON.parse(collateral.qe_identity as string);
    qi.mrsigner = "11".repeat(32);
    qi.isvprodid = 99;
    const r = await checkQuote(att.tdx_quote, depsWith({ ...collateral, qe_identity: JSON.stringify(qi) }));
    expect(r.label).toBe("NOT PROVEN");
    expect(r.text).toMatch(/qe_identity/);
  });

  it("control: a zeroed TCB info signature is NOT PROVEN too", async () => {
    const sig = collateral.tcb_info_signature as number[];
    const r = await checkQuote(att.tdx_quote, depsWith({ ...collateral, tcb_info_signature: sig.map(() => 0) }));
    expect(r.label).toBe("NOT PROVEN");
  });
});

describe.skipIf(!process.env.ARROW_E2E)("DCAP check, live PCCS", () => {
  it("a stored OutLayer testnet quote verifies against current collateral from the Phala PCCS", async () => {
    const r = await checkQuote(att.tdx_quote, { load: async () => real as unknown as DcapModule, nowSeconds: () => Date.now() / 1000 } as never);
    expect(["PROVEN", "RISKY"]).toContain(r.label);
    expect(r.source).toBe("pccs.phala.network");
  }, 60_000);
});
