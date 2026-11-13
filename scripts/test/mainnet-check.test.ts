// STATE-7 / CI-1: `mainnet-check.sh wasm` (and `pre`, which runs the same rows first) must fail when the contract source or the wire vectors
// changed after the commit that is embedded in the release wasm (NEP-330 source_code_snapshot).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../deploy/mainnet-check.sh");
let repo: string;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
const put = (rel: string, body: string) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), body);
};
const commit = (msg: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};
/** a release wasm whose NEP-330 metadata names `rev`, and the SHA256SUMS line for it */
function release(rev: string | null) {
  const meta = rev ? `{"build_info":{"source_code_snapshot":"git+https://example.test/arrow?rev=${rev}"}}` : `{"build_info":{}}`;
  put("release/contracts/arrow-mainnet.wasm", `\0asm\u0001${meta}`);
  const sha = execFileSync("shasum", ["-a", "256", join(repo, "release/contracts/arrow-mainnet.wasm")], { encoding: "utf8" }).split(" ")[0];
  put("release/contracts/SHA256SUMS", `${sha}  arrow-mainnet.wasm\n`);
}
const check = () => {
  const r = spawnSync("bash", [SCRIPT, "wasm"], { cwd: repo, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "arrow-mainnet-check-"));
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  put("contracts/arrow/src/lib.rs", "fn a() {}\n");
  put("contracts/arrow/tests/sandbox.rs", "// t\n");
  put("contracts/arrow/README.md", "# c\n");
  put("Cargo.lock", "# lock\n");
  put("rust-toolchain.toml", "[toolchain]\n");
  for (const f of ["input", "output", "msg"]) put(`fixtures/${f}-vectors.json`, "{}\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("mainnet-check.sh wasm", () => {
  it("passes when nothing that goes into the wasm changed since the embedded rev, whatever else moved", () => {
    const rev = commit("source");
    release(rev);
    commit("release");
    put("contracts/arrow/tests/sandbox.rs", "// more tests\n");
    put("contracts/arrow/README.md", "# docs\n");
    put("web/x.ts", "export {}\n");
    commit("tests, docs, web");
    const r = check();
    expect(r.out).toContain("PASS contract_wasm_fresh");
    expect(r.code).toBe(0);
  });

  it.each([
    ["the contract source", "contracts/arrow/src/lib.rs"],
    ["the lockfile", "Cargo.lock"],
    ["the toolchain", "rust-toolchain.toml"],
    ["the shared input vectors", "fixtures/input-vectors.json"],
  ])("fails contract_wasm_stale when %s changed after the embedded rev", (_what, file) => {
    const rev = commit("source");
    release(rev);
    commit("release");
    put(file, "changed\n");
    commit("change");
    const r = check();
    expect(r.out).toContain("FAIL contract_wasm_stale");
    expect(r.out).toContain(file);
    expect(r.code).toBe(1);
  });

  it("fails when the wasm carries no source rev or names a commit this clone lacks", () => {
    commit("source");
    release(null);
    commit("release without rev");
    expect(check().out).toContain("FAIL contract_wasm_stale: release/contracts/arrow-mainnet.wasm carries no NEP-330 source rev");
    release("0123456789abcdef0123456789abcdef01234567");
    const r = check();
    expect(r.out).toContain("which is not in this clone");
    expect(r.code).toBe(1);
  });
});

// ------------------------------------------------------------------ RPC rows against a fake JSON-RPC (readiness QA-03, S5)

/** a JSON-RPC that answers view_account and call_function from `state`; the script reaches it through MAINNET_RPC_URL in .env */
async function fakeRpc(state: { accounts: Record<string, { amount: string; code_hash: string }>; views: Record<string, unknown> }) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body).params;
      const send = (result: unknown) => res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      if (p.request_type === "view_account") return send(state.accounts[p.account_id]);
      const key = `${p.account_id}.${p.method_name}`;
      if (!(key in state.views)) return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "NO_VIEW", info: { key } } } }));
      send({ result: [...Buffer.from(JSON.stringify(state.views[key]))] });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}

/** runs the script without blocking the event loop (the fake RPC lives in this process) */
function runAsync(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const c = spawn("bash", [SCRIPT, ...args], { cwd: repo });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => done({ code, out }));
  });
}

const NEAR = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const EMPTY = "11111111111111111111111111111111";

describe("mainnet-check.sh guard (QA-03: steps 2 and 4 must not send twice)", () => {
  it.each([
    [{ amount: NEAR(0.1), code_hash: EMPTY }, 0, "PASS guard_storage: m.near holds 0.1000 NEAR and no code: send step 2 once"],
    [{ amount: NEAR(3.8), code_hash: EMPTY }, 1, "FAIL guard_storage: m.near holds 3.8000 NEAR (> 1): step 2 already landed, do not send it again"],
    [{ amount: NEAR(0.6), code_hash: "HXohArFy" }, 1, "FAIL guard_storage: m.near already has code: step 2 is done, do not send it again"],
  ])("storage %#", async (acct, code, line) => {
    const rpc = await fakeRpc({ accounts: { "m.near": acct }, views: {} });
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      const r = await runAsync(["guard", "storage", "m.near", "mainnet"]);
      expect(r.out).toContain(line);
      expect(r.code).toBe(code);
    } finally {
      rpc.close();
    }
  });

  it.each([
    [NEAR(0.605), 0, "PASS guard_tank: tank_available 0.6050 NEAR: send step 4 once"],
    [NEAR(1.105), 1, "FAIL guard_tank: tank_available 1.1050 NEAR (>= 0.9): step 4 already landed, do not send it again"],
  ])("tank %#", async (tank, code, line) => {
    const rpc = await fakeRpc({ accounts: {}, views: { "m.near.get_config": { tank_available: tank } } });
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      const r = await runAsync(["guard", "tank", "m.near", "mainnet"]);
      expect(r.out).toContain(line);
      expect(r.code).toBe(code);
    } finally {
      rpc.close();
    }
  });

  it("an unreadable market blocks the send instead of passing", async () => {
    const rpc = await fakeRpc({ accounts: {}, views: {} });
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      expect((await runAsync(["guard", "tank", "m.near", "mainnet"])).out).toContain("FAIL guard_tank: cannot read get_config of m.near");
      const s = await runAsync(["guard", "storage", "m.near", "mainnet"]);
      expect(s.out).toContain("FAIL guard_storage: cannot read m.near");
      expect(s.code).toBe(1);
    } finally {
      rpc.close();
    }
  });
});

describe("mainnet-check.sh post (S5: what the lock would freeze)", () => {
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const setupPost = (keys: unknown, balance: string, tank = 1.09) => {
    put("scripts/deploy/render-init.sh", "#!/usr/bin/env bash\necho '{\"cfg\":{}}'\n");
    put("release/contracts/arrow-mainnet.wasm", "\0asm");
    return fakeRpc({
      accounts: { "m.near": { amount: NEAR(3.8), code_hash: EMPTY } },
      views: {
        "m.near.get_config": { build: "mainnet", payment_path: "notify", result_path: "chain", paused: false, tank_available: NEAR(tank), config: { usdc_token_id: USDC, program_wasm_hash: "ab".repeat(32) } },
        "outlayer.near.list_user_secrets": [],
        "m.near.program_pubkey": "04" + "11".repeat(64),
        "intents.near.public_keys_of": keys,
        "intents.near.mt_balance_of": balance,
      },
    });
  };

  it("passes when intents.near holds no key and no USDC for the market", async () => {
    const rpc = await setupPost([], "0");
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      const r = await runAsync(["post", "m.near", "mainnet"]);
      expect(r.out).toContain("PASS intents_keys_empty intents.near public_keys_of m.near = []");
      expect(r.out).toContain("PASS market_usdc_idle intents.near USDC on m.near = 0");
    } finally {
      rpc.close();
    }
  });

  it("fails a tank below the listing reserve (tank_min + 10 x 0.05 eval deposit = 0.55 NEAR)", async () => {
    const rpc = await setupPost([], "0", 0.5);
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      const r = await runAsync(["post", "m.near", "mainnet"]);
      expect(r.out).toContain("FAIL tank_available 0.5000 NEAR < 0.6");
      expect(r.code).toBe(1);
    } finally {
      rpc.close();
    }
  });

  it("fails on an intents.near key or USDC parked on the market", async () => {
    const rpc = await setupPost(["ed25519:Evil"], "250000");
    try {
      put(".env", `MAINNET_RPC_URL=${rpc.url}\n`);
      const r = await runAsync(["post", "m.near", "mainnet"]);
      expect(r.out).toContain('FAIL intents_keys_empty: intents.near public_keys_of m.near = ["ed25519:Evil"]');
      expect(r.out).toContain("FAIL market_usdc_idle: m.near holds 250000 USDC base units on intents.near");
      expect(r.code).toBe(1);
    } finally {
      rpc.close();
    }
  });
});
