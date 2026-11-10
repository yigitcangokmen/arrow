// X12-OPS-3: the H-23 upkeep check (balances.ts --ops) with a fake chain and a fake HTTP world.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FLOORS, runOps, secretRowProblem, wasmUrlCheck, type OpsDeps } from "../src/lib/ops.ts";

const WASM = Buffer.from("fake program wasm");
const HASH = createHash("sha256").update(WASM).digest("hex");
const URL_ = `https://fastfs.io/arrowhq.near/outlayer.near/${HASH}.wasm`;
const BLOB = Buffer.from("ciphertext");
const BLOB_SHA = createHash("sha256").update(BLOB).digest("hex");
const BLOB_URL = `https://blobs.test/${BLOB_SHA}.bin`;
const PK = "04" + "ab".repeat(64);
const yocto = (n: number) => (BigInt(Math.round(n * 1e4)) * 10n ** 20n).toString();

function world(o: { network?: "mainnet" | "testnet"; tank?: number; paused?: boolean; pk?: string | null; hash?: string; head?: number; get?: number; ai?: number; key?: boolean; relayer?: number; judge?: number; secrets?: any[]; release?: string | null; relayStatus?: number; demo?: number[]; blob?: number } = {}) {
  const network = o.network ?? "mainnet";
  const contract = network === "mainnet" ? "arrow-market.near" : "arrow-v2.arrowhq.testnet";
  const hash = o.hash ?? HASH;
  const row = { profile: "arrow", accessor: { WasmHash: { hash } }, access: { Logic: { operator: "And", conditions: [{ WasmHash: { hash } }, { Predecessor: { condition: { Whitelist: { accounts: [contract] } } } }] } } };
  const lines: string[] = [];
  const calls: string[] = [];
  const d: OpsDeps = {
    network, contract,
    env: { NEXT_PUBLIC_SITE_DOMAIN: "arrow.test", ...(o.key === false ? {} : { NEARAI_API_KEY_MAINNET: "k-main", NEARAI_API_KEY: "k-test" }) },
    fetch: (async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u === URL_) return init?.method === "HEAD" ? new Response(null, { status: o.head ?? 404 }) : new Response(WASM, { status: o.get ?? 200 });
      if (u === BLOB_URL) return new Response(BLOB, { status: o.blob ?? 200 });
      if (u.includes("cloud-api.near.ai")) return new Response("{}", { status: o.ai ?? 200 });
      if (u.endsWith("/api/relay") || u.endsWith("/api/testnet-sponsor")) return new Response("{}", { status: o.relayStatus ?? 400 });
      if (u.includes("helper.nearprotocol.com")) return new Response("{}", { status: 400 });
      return new Response("no", { status: 404 });
    }) as typeof fetch,
    nearBalance: async (id) => (id.includes("judge") ? (o.judge ?? 30) : (o.relayer ?? 1.0)),
    view: async (account, method) => {
      if (method === "get_config") return { paused: o.paused ?? false, tank_available: yocto(o.tank ?? (network === "mainnet" ? 1 : 6.5)), config: { program_wasm_hash: hash, program_wasm_url: URL_ } };
      if (method === "program_pubkey") return o.pk === undefined ? PK : o.pk;
      if (method === "get_listing") return { blob_url: BLOB_URL, blob_sha256: BLOB_SHA };
      if (method === "list_user_secrets") return o.secrets ?? [row];
      throw new Error(`unexpected view ${account} ${method}`);
    },
    releaseSha: o.release === undefined ? HASH : o.release,
    demoListings: o.demo ?? [],
    log: (l) => void lines.push(l),
  };
  return { d, lines, calls };
}

describe("balances --ops", () => {
  it("a healthy mainnet passes, including the FastFS URL that answers HEAD 404 and GET 200", async () => {
    const w = world({ head: 404, get: 200 });
    expect(await runOps(w.d)).toEqual([]);
    expect(w.lines.join("\n")).toContain("GET 200");
    expect(w.lines.join("\n")).toContain("HEAD 404, informational");
  });

  it("wasmUrlCheck: HEAD 404 + GET 200 + matching sha is ok; a wrong sha or a GET 404 is not", async () => {
    const f = (head: number, get: number) => (async (_u: string, i?: RequestInit) => new Response(i?.method === "HEAD" ? null : WASM, { status: i?.method === "HEAD" ? head : get })) as unknown as typeof fetch;
    expect(await wasmUrlCheck(f(404, 200), URL_, HASH, () => {})).toBe(true);
    expect(await wasmUrlCheck(f(200, 200), URL_, "00".repeat(32), () => {})).toBe(false);
    expect(await wasmUrlCheck(f(200, 404), URL_, HASH, () => {})).toBe(false);
  });

  it("testnet reads tank_available, not the account balance: 1.8 available with 5.1 on the account fails", async () => {
    const w = world({ network: "testnet", tank: 1.8 });
    const p = await runOps(w.d);
    expect(p).toEqual([expect.stringContaining("tank_available 1.8000 NEAR < 5 NEAR")]);
    expect(await runOps(world({ network: "testnet", tank: 6.52 }).d)).toEqual([]);
  });

  it("fails on a paused contract and on a missing program_pubkey", async () => {
    expect(await runOps(world({ paused: true }).d)).toEqual([expect.stringContaining("is paused")]);
    expect(await runOps(world({ pk: null }).d)).toEqual([expect.stringContaining("program_pubkey is null")]);
  });

  it("fails when the program hash differs from the release file, and on mainnet when there is no release file", async () => {
    expect(await runOps(world({ release: "cd".repeat(32) }).d)).toEqual(expect.arrayContaining([expect.stringContaining("!= release cdcdcdcdcdcd")]));
    expect(await runOps(world({ release: null }).d)).toEqual([expect.stringContaining("release/sha256.txt is missing")]);
    expect(await runOps(world({ network: "testnet", release: null }).d)).toEqual([]);
  });

  it("fails when the OutLayer secret row is missing or has the wrong access rule", async () => {
    expect(await runOps(world({ secrets: [] }).d)).toEqual([expect.stringContaining("no OutLayer secret row")]);
    const other = { profile: "arrow", accessor: { WasmHash: { hash: HASH } }, access: { Logic: { operator: "And", conditions: [{ WasmHash: { hash: HASH } }, { Predecessor: { condition: { Whitelist: { accounts: ["someone.near"] } } } }] } } };
    expect(await runOps(world({ secrets: [other] }).d)).toEqual([expect.stringContaining("not And[WasmHash, Predecessor whitelist [arrow-market.near]]")]);
    expect(secretRowProblem([], HASH, "m.near")).toContain("no OutLayer secret row");
  });

  it("fails when the NEAR AI probe is refused or the key is missing, and never prints the key", async () => {
    const dead = world({ ai: 401 });
    expect(await runOps(dead.d)).toEqual([expect.stringContaining("NEAR AI probe: HTTP 401")]);
    expect(await runOps(world({ key: false }).d)).toEqual([expect.stringContaining("NEARAI_API_KEY_MAINNET is not set")]);
    const ok = world();
    await runOps(ok.d);
    expect(ok.lines.join("\n")).not.toContain("k-main");
  });

  it(`fails a relayer below ${FLOORS.relayer} NEAR (0.5 cannot carry one 600 TGas payment) and a dead hosted relay route`, async () => {
    expect(await runOps(world({ relayer: 0.5 }).d)).toEqual([expect.stringContaining("relayer arrow-relayer.arrowhq.near 0.5000 NEAR < 0.65")]);
    expect(await runOps(world({ relayStatus: 404 }).d)).toEqual([expect.stringContaining("hosted relay route returned 404")]);
  });

  it("fails when the ciphertext host of a demo listing stops serving it", async () => {
    expect(await runOps(world({ demo: [1, 2] }).d)).toEqual([]);
    expect(await runOps(world({ demo: [1, 2], blob: 404 }).d)).toEqual([expect.stringContaining("demo listing #1: ciphertext not served"), expect.stringContaining("demo listing #2: ciphertext not served")]);
  });

  it("testnet keeps the judge-account floor", async () => {
    expect(await runOps(world({ network: "testnet", judge: 5.49 }).d)).toEqual([expect.stringContaining("arrow-judge.arrowhq.testnet 5.4900 NEAR < 20 tNEAR")]);
  });
});
