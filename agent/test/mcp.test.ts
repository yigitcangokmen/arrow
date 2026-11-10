// WS4-T12 acceptance: the server is started as a child process and spoken to over stdio, like an MCP client would.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VIEWS_DIR } from "./helpers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = join(ROOT, "agent/src/mcp.ts");
let tmp: string;
let mock: string;
let clients: Client[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arrow-mcp-"));
  mock = join(tmp, "views");
  cpSync(VIEWS_DIR, mock, { recursive: true });
  writeFileSync(join(tmp, ".env"), "");
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
});

const serverEnv = (extra: Record<string, string> = {}) => ({
  ...getDefaultEnvironment(),
  ARROW_NETWORK: "testnet",
  ARROW_TEST_MOCK_RPC: mock,
  ARROW_ENV_PATH: join(tmp, ".env"),
  ARROW_CONFIG_DIR: join(tmp, "config"),
  ARROW_EVIDENCE_DIR: join(tmp, "evidence"),
  NEAR_KEY_E2E_BUYER_ARROWHQ_TESTNET: KeyPair.fromRandom("ed25519").toString(), // a throwaway key: the mock transport never signs
  ...extra,
});

async function connect(extra: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "arrow-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", SERVER], cwd: ROOT, env: serverEnv(extra), stderr: "ignore" }));
  clients.push(client);
  return client;
}

const call = async (c: Client, name: string, args: Record<string, unknown>) => {
  try {
    const r: any = await c.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: r.content?.[0]?.text as string };
  } catch (e) {
    return { isError: true, text: (e as Error).message }; // schema rejection comes back as a protocol error
  }
};

describe("arrow MCP server", () => {
  it("tools_list_exactly_four", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["buy", "get_listing", "inspect_before_buy", "list_listings"]);
    for (const t of tools) {
      expect(t.description && t.description.length > 20).toBe(true);
      expect(t.inputSchema.type).toBe("object");
      expect(t.name).not.toContain(".");
    }
  }, 60_000);

  it("stdout_is_pure_jsonrpc", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", SERVER], { cwd: ROOT, env: serverEnv(), stdio: ["pipe", "pipe", "ignore"] });
    const lines: string[] = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      lines.push(...parts.filter(Boolean));
    });
    const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    await waitFor(() => lines.length >= 1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_listings", arguments: {} } });
    await waitFor(() => lines.length >= 2);
    child.kill();
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(JSON.parse(l)).toMatchObject({ jsonrpc: "2.0" });
  }, 60_000);

  it("mainnet_blocked_without_env", async () => {
    const c = await connect();
    const r = await call(c, "inspect_before_buy", { listing_id: "1", criteria: { v: 1, text: "x" }, network: "mainnet" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("ARROW_MCP_ALLOW_MAINNET=1 required");
    const b = await call(c, "buy", { listing_id: "1", confirm: true, network: "mainnet" });
    expect(b.isError).toBe(true);
    expect(b.text).toContain("ARROW_MCP_ALLOW_MAINNET=1 required");
    // reads stay open on mainnet
    expect((await call(c, "list_listings", { network: "mainnet" })).isError).toBe(false);
  }, 60_000);

  it("max_usdc_cap", async () => {
    const listing = JSON.parse(readFileSync(join(mock, "listing.json"), "utf8"));
    writeFileSync(join(mock, "listing.json"), JSON.stringify({ ...listing, eval_fee: "2000000", price: "5000000" }));
    const c = await connect();
    const e = await call(c, "inspect_before_buy", { listing_id: "1", criteria: { v: 1, text: "x" } });
    expect(e.isError).toBe(true);
    expect(e.text).toContain("eval fee 2 USDC exceeds the per-call cap 1 USDC");
    const b = await call(c, "buy", { listing_id: "1", confirm: true });
    expect(b.text).toContain("price 5 USDC exceeds the per-call cap");
    const raised = await connect({ ARROW_MCP_MAX_USDC: "3.00" });
    const e2 = await call(raised, "inspect_before_buy", { listing_id: "1", criteria: { v: 1, text: "x" } });
    expect(e2.text).not.toContain("exceeds"); // passes the cap, then stops at the mock transport, which refuses to pay
    expect(e2.text).toContain("payment attempted in ARROW_TEST_MOCK_RPC mode");
  }, 90_000);

  it("buy_requires_confirm_true", async () => {
    const c = await connect();
    const r = await call(c, "buy", { listing_id: "1", confirm: false });
    expect(r.isError).toBe(true);
    const missing = await call(c, "buy", { listing_id: "1" });
    expect(missing.isError).toBe(true);
  }, 60_000);

  it("get_listing_mock", async () => {
    const c = await connect();
    const r = await call(c, "get_listing", { listing_id: "1" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({ id: 1, title: "Retail sales by SKU, 2025 (synthetic)", price_usdc: "0.25", eval_fee_usdc: "0.1", leak_budget_left_bits: "266.63", mode: "scored" });
    const list = JSON.parse((await call(c, "list_listings", { limit: 5 })).text);
    expect(list).toHaveLength(1);
    expect((await call(c, "get_listing", { listing_id: "99" })).isError).toBe(true);
  }, 60_000);
});

// Needs the testnet deployment (WS1-T15) and a funded testnet buyer key; never part of CI.
describe.skipIf(!process.env.ARROW_E2E)("live", () => {
  it("live_inspect_before_buy", async () => {
    mock = "";
    const client = new Client({ name: "arrow-live", version: "0.0.0" });
    const env: Record<string, string> = { ...getDefaultEnvironment(), ARROW_NETWORK: "testnet" };
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", SERVER], cwd: ROOT, env, stderr: "ignore" }));
    clients.push(client);
    const r = await call(client, "inspect_before_buy", { listing_id: process.env.ARROW_E2E_LISTING_ID ?? "1", criteria: JSON.parse(readFileSync(join(ROOT, "fixtures/criteria/demo.json"), "utf8")) });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({ eval_id: expect.any(Number), bits_out: expect.any(Number) });
  }, 300_000);
});

async function waitFor(cond: () => boolean, ms = 40_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for server output");
    await new Promise((r) => setTimeout(r, 50));
  }
}
