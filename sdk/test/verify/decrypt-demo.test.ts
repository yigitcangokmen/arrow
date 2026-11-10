// WS4-T13: --decrypt-demo opens the demo purchase and never prints plaintext.
import { describe, expect, it } from "vitest";
import { decryptDemo } from "../../src/verify/index.ts";
import { buildWorld, fakeFetch } from "./world.ts";

const opts = (w: ReturnType<typeof buildWorld>) => ({ network: w.network, evidence: w.evidence, fetchImpl: fakeFetch(w) });

describe("decryptDemo", () => {
  it("decrypt_demo_prints_no_plaintext", async () => {
    const w = buildWorld("testnet");
    const d = await decryptDemo(opts(w));
    expect(d.purchaseId).toBe(1);
    expect(d.marker).toBe("demo:true");
    expect(d.bytes).toBe(w.plaintext.length);
    expect(Buffer.from(d.plaintext).equals(Buffer.from(w.plaintext))).toBe(true);
    const lines = d.lines("./out/demo-1.csv");
    expect(lines.at(-1)).toBe(`sha256 match ✔ · wrote ./out/demo-1.csv (${w.plaintext.length} bytes)`);
    const text = lines.join("\n");
    const firstLine = new TextDecoder().decode(w.plaintext).split("\n")[0];
    expect(text).not.toContain(firstLine);
    expect(text).not.toContain("2025-01-01");
  });

  it("falls back to demo:e2e, then to the buyer key, and says which", async () => {
    const e2e = buildWorld("testnet");
    e2e.evidence.runs.find((r) => r.id === "b1")!.observed = "ok (demo:e2e)";
    expect((await decryptDemo(opts(e2e))).marker).toBe("demo:e2e");
    const byKey = buildWorld("testnet");
    byKey.evidence.runs.find((r) => r.id === "b1")!.observed = "ok";
    expect((await decryptDemo(opts(byKey))).marker).toBe("buyer key = demo viewing key");
  });

  it("refuses a purchase that was not made with the demo key, and a blob that does not match", async () => {
    const other = buildWorld("testnet");
    other.purchases[0].buyer_pk = "04" + "ab".repeat(64);
    await expect(decryptDemo(opts(other))).rejects.toThrow("demo viewing key");
    const bad = buildWorld("testnet");
    bad.files["https://blobs.test/1.bin"] = new Uint8Array(64);
    await expect(decryptDemo(opts(bad))).rejects.toThrow("sha256 mismatch");
    const none = buildWorld("testnet");
    none.evidence.runs = none.evidence.runs.filter((r) => r.kind !== "buy");
    await expect(decryptDemo(opts(none))).rejects.toThrow("no demo purchase");
  });
});
