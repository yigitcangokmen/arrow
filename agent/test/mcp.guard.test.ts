// MCP-1 / MCP-2: the buy tool's file sink and the spend guards, driven in-process through the SDK's in-memory transport.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64, encryptFile, seal } from "@arrow/sdk";
import { decryptCommand } from "../src/commands.ts";
import { createServer } from "../src/mcp.ts";
import { DEMO, eventTx, fakeCtx, fixture } from "./helpers.ts";

const plaintext = new TextEncoder().encode("id,label\n1,a\n2,b\n");
let tmp: string;
let outDir: string;
let clients: Client[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arrow-mcpguard-"));
  outDir = join(tmp, "purchases");
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
});

/** A fake market where purchase #4 is done and decryptable, plus a connected in-memory MCP client. */
async function setup(env: Record<string, string> = {}, listing: object = {}) {
  const { key, blob, blobSha256 } = encryptFile(plaintext);
  const fetchImpl = vi.fn(async () => new Response(blob)) as unknown as typeof fetch;
  const fake = fakeCtx({
    listing: { blob_url: "https://blobs.example/b.bin", blob_sha256: blobSha256, price: "250000", eval_fee: "100000", ...listing },
    fetchImpl,
  });
  // the accepted event the settle step looks for depends on what was just paid: an eval or a purchase
  fake.ctx.wait!.txStatusImpl = (async () =>
    fake.payCalls.at(-1) && JSON.parse(fake.payCalls.at(-1)!.msg).op === "buy"
      ? eventTx("arrow_purchase", { phase: "accepted", listing_id: 1, purchase_id: 4 })
      : eventTx("arrow_eval", { phase: "accepted", listing_id: 1, eval_id: 9, buyer: "x", fee: "100000", spent_milli: 0, left_milli: 0 })) as any;
  fake.state.records["purchase:4"] = { ...fixture("purchase"), id: 4, status: "done", buyer_pk: DEMO.buyerPk, sealed_k_buyer: b64.enc(seal(DEMO.buyerPk, key)), h: blobSha256, refund_reason: null };
  const server = createServer({ env: { ARROW_MCP_OUT_DIR: outDir, ...env }, ctx: () => fake.ctx });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      const r: any = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: String(r.content?.[0]?.text) };
    } catch (e) {
      return { isError: true, text: (e as Error).message };
    }
  };
  return { fake, call, blob };
}

const ALLOW = { ARROW_MCP_ALLOW_BUY: "1" };
const buy = { listing_id: "1" };

describe("MCP-1: the buy tool writes only under the fixed output folder", () => {
  it("rejects path traversal, absolute paths and hidden names before anything is paid", async () => {
    const { fake, call } = await setup(ALLOW);
    for (const out_path of ["../escape.csv", "/tmp/escape.csv", "sub/dir.csv", "..", ".zshrc", "a\\b.csv", "", "x\0y"]) {
      const r = await call("buy", { ...buy, out_path });
      expect(r.isError, out_path).toBe(true);
    }
    expect(fake.payCalls).toHaveLength(0);
    expect(existsSync(join(tmp, "escape.csv"))).toBe(false);
    expect(existsSync("/tmp/escape.csv")).toBe(false);
  });

  it("refuses an existing file (and a symlink), leaves it untouched, and pays nothing", async () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "mine.csv"), "precious");
    const victim = join(tmp, "victim");
    writeFileSync(victim, "victim");
    symlinkSync(victim, join(outDir, "link.csv"));
    const { fake, call } = await setup(ALLOW);
    for (const out_path of ["mine.csv", "link.csv"]) {
      const r = await call("buy", { ...buy, out_path });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("already exists");
    }
    expect(readFileSync(join(outDir, "mine.csv"), "utf8")).toBe("precious");
    expect(readFileSync(victim, "utf8")).toBe("victim");
    expect(fake.payCalls).toHaveLength(0);
  });

  it("writes the decrypted file inside the output folder, with the default name or a plain file name", async () => {
    const { call, fake } = await setup(ALLOW);
    const named = await call("buy", { ...buy, out_path: "bought.csv" });
    expect(named.isError, named.text).toBe(false);
    expect(JSON.parse(named.text).out_path).toBe(join(outDir, "bought.csv"));
    expect(readFileSync(join(outDir, "bought.csv"))).toEqual(Buffer.from(plaintext));
    const dflt = await call("buy", buy);
    expect(dflt.isError, dflt.text).toBe(false);
    expect(JSON.parse(dflt.text).out_path.startsWith(outDir)).toBe(true);
    expect(fake.payCalls).toHaveLength(2);
  });

  it("decryptCommand with exclusive never overwrites a file that appeared after the check", async () => {
    const { fake } = await setup();
    const out = join(tmp, "race.csv");
    writeFileSync(out, "attacker");
    await expect(decryptCommand(fake.ctx, { purchaseId: 4, demoKey: true, out, exclusive: true })).rejects.toThrow(/EEXIST/);
    expect(readFileSync(out, "utf8")).toBe("attacker");
    expect(lstatSync(out).isFile()).toBe(true);
  });
});

describe("MCP-2: spend guards", () => {
  it("buy needs the operator's ARROW_MCP_ALLOW_BUY=1; a confirm argument from the model is not consent", async () => {
    const { fake, call } = await setup();
    for (const args of [buy, { ...buy, confirm: true }]) {
      const r = await call("buy", args);
      expect(r.isError).toBe(true);
      expect(r.text).toContain("ARROW_MCP_ALLOW_BUY=1 required");
    }
    expect(fake.payCalls).toHaveLength(0);
  });

  it("stops paying once the session total would be passed, across inspect and buy", async () => {
    // eval fee 0.10 + price 0.25 per round; total cap 0.50
    const { fake, call } = await setup({ ...ALLOW, ARROW_MCP_MAX_USDC_TOTAL: "0.50" });
    const criteria = { v: 1, text: "Daily retail units by SKU and region." };
    expect((await call("inspect_before_buy", { listing_id: "1", criteria })).isError).toBe(false); // 0.10
    expect((await call("buy", { ...buy, out_path: "a.csv" })).isError).toBe(false); // 0.35
    const over = await call("buy", { ...buy, out_path: "b.csv" }); // 0.60 > 0.50
    expect(over.isError).toBe(true);
    expect(over.text).toContain("session cap 0.5 USDC");
    expect(over.text).toContain("ARROW_MCP_MAX_USDC_TOTAL");
    expect((await call("inspect_before_buy", { listing_id: "1", criteria })).isError).toBe(false); // 0.45, still fits
    expect(fake.payCalls.map((p) => p.amount)).toEqual([100000n, 250000n, 100000n]);
    expect(existsSync(join(outDir, "b.csv"))).toBe(false);
  });

  it("the per-call cap is enforced where the payment is made, not only on the listing read before it", async () => {
    const { fake, call } = await setup({ ...ALLOW, ARROW_MCP_MAX_USDC: "0.20" });
    // the listing the precheck sees is cheap; the one the command re-reads is not (a seller raising the price in between)
    let reads = 0;
    const real = fake.ctx.views.listing;
    fake.ctx.views.listing = async (id) => {
      const l: any = await real(id);
      return l && ++reads > 1 ? { ...l, price: "900000" } : l;
    };
    const r = await call("buy", { ...buy, out_path: "c.csv" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("per-call cap");
    expect(fake.payCalls).toHaveLength(0);
  });

  it("the default session total is 5 USDC", async () => {
    const { fake, call } = await setup({ ...ALLOW, ARROW_MCP_MAX_USDC: "3.00" }, { price: "2000000" });
    for (const n of ["a", "b"]) expect((await call("buy", { ...buy, out_path: `${n}.csv` })).isError).toBe(false); // 4.00
    const r = await call("buy", { ...buy, out_path: "c.csv" }); // 6.00
    expect(r.isError).toBe(true);
    expect(r.text).toContain("session cap 5 USDC");
    expect(fake.payCalls).toHaveLength(2);
  });

  it("labels seller-written text as untrusted in the read tools", async () => {
    const { call } = await setup();
    const r = await call("get_listing", buy);
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).untrusted_seller_text_notice).toMatch(/untrusted/i);
  });
});
