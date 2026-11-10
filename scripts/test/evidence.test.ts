// WS1-T05 acceptance: evidence_add_file_flag, duplicate id refused, secret field refused, accounts written.
// Runs the CLI against a temp evidence dir (ARROW_EVIDENCE_DIR); no network (every run carries block_height or no tx).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TSX = join(ROOT, "node_modules/.bin/tsx");

let dir: string;
const cli = (...args: string[]) =>
  spawnSync(TSX, [join(ROOT, "scripts/src/evidence-add.ts"), ...args], {
    env: { ...process.env, ARROW_EVIDENCE_DIR: dir },
    encoding: "utf8",
  });
const testnet = () => JSON.parse(readFileSync(join(dir, "testnet.json"), "utf8"));

const RUN = {
  id: "s2-001",
  kind: "deploy",
  tx: "DKcmuQZfqyXg4MprUqKqqJL9XADcL4hrCeWcTQ2LG7sL",
  block_height: 123,
  expect: "token deployed",
  observed: "deployed",
  script: "spikes/s2/run-testnet.sh",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arrow-evidence-"));
});

describe("evidence-add", { timeout: 20_000 }, () => {
  it("evidence_add_file_flag: appends a run from a file and refuses the same id again", () => {
    const f = join(dir, "run.json");
    writeFileSync(f, JSON.stringify(RUN));
    const r = cli("--network", "testnet", "--file", f);
    expect(r.status, r.stderr).toBe(0);
    const ev = testnet();
    expect(ev.runs).toHaveLength(1);
    expect(ev.runs[0]).toMatchObject({ ...RUN, chain: "near", listing_id: null, eval_id: null, purchase_id: null, oneclick_deposit: null });
    expect(ev.runs[0].commit).toMatch(/^[0-9a-f]{40}$|^uncommitted$/);

    const again = cli("--network", "testnet", "--file", f);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("s2-001 already exists");
    expect(testnet().runs).toHaveLength(1);
  });

  it("reads JSON Lines files and generates <script>-NNN ids when id is missing", () => {
    const f = join(dir, "runs.jsonl");
    const { id: _id, ...noId } = RUN;
    writeFileSync(f, [JSON.stringify(noId), "", JSON.stringify({ ...noId, tx: null, block_height: null })].join("\n"));
    const r = cli("--network", "testnet", "--file", f);
    expect(r.status, r.stderr).toBe(0);
    expect(testnet().runs.map((x: { id: string }) => x.id)).toEqual(["run-testnet-001", "run-testnet-002"]);
  });

  it("--run appends one inline run", () => {
    const r = cli("--network", "testnet", "--run", JSON.stringify({ ...RUN, id: "x-1", tx: null, block_height: null }));
    expect(r.status, r.stderr).toBe(0);
    expect(testnet().runs[0]).toMatchObject({ id: "x-1", tx: null, block_height: null });
  });

  it("refuses any field whose name contains key, secret or private, and writes nothing", () => {
    for (const bad of [{ private_key: "x" }, { observed_detail: { apiKey: "x" } }, { Secret: "x" }]) {
      const r = cli("--network", "testnet", "--run", JSON.stringify({ ...RUN, ...bad }));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/secret-like field/);
    }
    const acct = cli("--network", "testnet", "--account", "relayer_key=x.testnet");
    expect(acct.status).toBe(1);
    expect(() => testnet()).toThrow();
  });

  it("rejects a run that does not match the evidence schema", () => {
    const r = cli("--network", "testnet", "--run", JSON.stringify({ ...RUN, kind: "mint" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/kind/);
  });

  it("near tx without block_height needs --sender (it fills height and time from the archival RPC)", () => {
    const r = cli("--network", "testnet", "--run", JSON.stringify({ ...RUN, block_height: undefined }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--sender");
  });

  it("--account and --set merge into the top level", () => {
    expect(cli("--network", "testnet", "--account", "parent=arrowhq.testnet", "--account", "spike=spike.arrowhq.testnet").status).toBe(0);
    expect(cli("--network", "testnet", "--account", "token=arrow-usd.arrowhq.testnet", "--set", "program_wasm_url=https://x/y.wasm").status).toBe(0);
    const ev = testnet();
    expect(ev.accounts).toEqual({ parent: "arrowhq.testnet", spike: "spike.arrowhq.testnet", token: "arrow-usd.arrowhq.testnet" });
    expect(ev.program_wasm_url).toBe("https://x/y.wasm");
    const bad = cli("--network", "testnet", "--set", "contract_wasm_sha256=nothex");
    expect(bad.status).toBe(1);
    const unknown = cli("--network", "testnet", "--set", "runs=[]");
    expect(unknown.status).toBe(1);
  });
});
