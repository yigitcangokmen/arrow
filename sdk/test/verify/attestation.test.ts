// WS4-T13: report_data recomputation and the output/input hash helpers, on real OutLayer records.
import { describe, expect, it } from "vitest";
import { expectedReportData, inputHashOf, outputHashOrder, quoteReportData, reportDataVersion } from "../../src/verify/attestation.ts";
import { fixture, sha } from "./world.ts";

describe("report_data", () => {
  it("report_data_v1_matches_fixture_4000", () => {
    const a = fixture("attestation-4000.json");
    expect(expectedReportData(a, "V1")).toBe(quoteReportData(a.tdx_quote));
    expect(expectedReportData(a, "V0")).not.toBe(quoteReportData(a.tdx_quote));
    expect(reportDataVersion(a)).toBe("V1");
  });

  it("report_data_v0_matches_fixture_100", () => {
    const a = fixture("attestation-100.json");
    expect(expectedReportData(a, "V0")).toBe(quoteReportData(a.tdx_quote));
    expect(reportDataVersion(a)).toBe("V0");
  });

  it("a changed field breaks both versions", () => {
    const a = { ...fixture("attestation-4000.json"), wasm_hash: "0".repeat(64) };
    expect(reportDataVersion(a)).toBeNull();
  });

  it("rejects a quote that is too short", () => {
    expect(() => quoteReportData(Buffer.alloc(100).toString("base64"))).toThrow("too short");
  });
});

describe("output and input hashes", () => {
  const r = "A".repeat(132);
  const h = "ab".repeat(32);

  it("output_hash_both_orders", () => {
    const written = { output_hash: sha(JSON.stringify({ v: 1, ok: true, r, h })) };
    const sorted = { output_hash: sha(JSON.stringify({ h, ok: true, r, v: 1 })) };
    expect(outputHashOrder(written, r, h)).toBe("written");
    expect(outputHashOrder(sorted, r, h)).toBe("sorted");
    expect(outputHashOrder({ output_hash: "0".repeat(64) }, r, h)).toBeNull();
    expect(outputHashOrder(written, r, "cd".repeat(32))).toBeNull();
  });

  it("input hash is sha256 of the input string", () => {
    expect(inputHashOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
