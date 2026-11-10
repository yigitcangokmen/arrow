// Network test (ARROW_E2E=1), free and read-only: the real Phala verifier wasm checks a real OutLayer TDX quote
// (sdk/test/fixtures/attestation-15850.json) against collateral fetched from the Phala PCCS. In the browser the wasm is
// loaded from /dcap/; here it is read from the package. Run: ARROW_E2E=1 npx vitest run web/test/dcap.e2e.test.ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { checkQuote, type DcapModule } from "../lib/dcap.ts";

describe.skipIf(!process.env.ARROW_E2E)("DCAP check with the real verifier", () => {
  it("a stored OutLayer testnet quote verifies; the status is a real Intel TCB status and the measurements are hex", async () => {
    const pkg = createRequire(import.meta.url).resolve("@phala/dcap-qvl-web/package.json").replace(/package\.json$/, "");
    const mod = await import("@phala/dcap-qvl-web");
    const wasm = readFileSync(`${pkg}dcap-qvl-web_bg.wasm`);
    const att = JSON.parse(readFileSync(new URL("../../sdk/test/fixtures/attestation-15850.json", import.meta.url), "utf8"));
    const r = await checkQuote(att.tdx_quote, "https://testnet-api.outlayer.ai", {
      load: async () => ({ ...mod, default: async () => mod.initSync({ module: wasm }), js_verify: mod.js_verify, js_get_collateral: mod.js_get_collateral }) as unknown as DcapModule,
      fetchJson: async () => { throw new Error("not used in this test"); },
      nowSeconds: () => Date.now() / 1000,
    });
    expect(["PROVEN", "RISKY"]).toContain(r.label);
    expect(r.source).toBe("pccs.phala.network");
    expect(r.fields!.mr_td).toMatch(/^[0-9a-f]{96}$/);
    expect(r.fields!.report_data).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
