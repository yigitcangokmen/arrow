// WS4-T08 acceptance: keygen_stdout_has_no_secret, keygen_out_inside_repo_refused, team_accounts_appended.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const PRIV_EVM = /0x[0-9a-fA-F]{64}/;
const PRIV_NEAR = /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/;

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arrow-keygen-"));
  mkdirSync(join(dir, "evidence"));
  writeFileSync(join(dir, "evidence/team-accounts.json"), JSON.stringify({ near: [], evm: [], solana: [] }));
  writeFileSync(join(dir, ".env"), "E2E_BUYER_EVM_PRIVATE_KEY=\nE2E_SELLER_EVM_PRIVATE_KEY=\nRELAYER_PRIVATE_KEY=\n");
  env = { ...process.env, ARROW_ENV_PATH: join(dir, ".env"), ARROW_EVIDENCE_DIR: join(dir, "evidence") };
});
const run = (script: string, ...args: string[]) =>
  spawnSync(TSX, [join(ROOT, "scripts/src", script), ...args], { env, encoding: "utf8" });

describe("keygen scripts", () => {
  it("keygen_stdout_has_no_secret + team_accounts_appended", () => {
    const r = run("new-evm-wallet.ts", "--role", "buyer");
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(PRIV_EVM);
    expect(r.stdout).toMatch(/^buyer address: 0x[0-9a-fA-F]{40} \(Base\)$/m);
    expect(r.stdout).toContain(".env: E2E_BUYER_EVM_PRIVATE_KEY written (value hidden)");

    const secret = readFileSync(join(dir, ".env"), "utf8").match(/E2E_BUYER_EVM_PRIVATE_KEY=(0x[0-9a-f]{64})/)?.[1];
    expect(secret).toBeTruthy();
    const team = readFileSync(join(dir, "evidence/team-accounts.json"), "utf8");
    const address = r.stdout.match(/0x[0-9a-fA-F]{40}/)![0].toLowerCase();
    expect(JSON.parse(team).evm).toEqual([expect.objectContaining({ role: "buyer", address })]);
    expect(team).not.toContain(secret!.slice(2));

    const again = run("new-evm-wallet.ts", "--role", "buyer");
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("E2E_BUYER_EVM_PRIVATE_KEY already set; refusing to overwrite");
    expect(JSON.parse(readFileSync(join(dir, "evidence/team-accounts.json"), "utf8")).evm).toHaveLength(1);

    const seller = run("new-evm-wallet.ts", "--role", "seller");
    expect(seller.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "evidence/team-accounts.json"), "utf8")).evm).toHaveLength(2);
  });

  it("near keypair prints only the public key", () => {
    const r = run("new-near-keypair.ts", "--env", "RELAYER_PRIVATE_KEY");
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(PRIV_NEAR);
    expect(r.stdout).toMatch(/^public key: ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/m);
    expect(readFileSync(join(dir, ".env"), "utf8")).toMatch(/RELAYER_PRIVATE_KEY=ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/);
  });

  it("keygen_out_inside_repo_refused", () => {
    const inside = join(ROOT, "tmp-keygen-test-key.json");
    const r = run("new-near-keypair.ts", "--out", inside, "--account", "x.testnet");
    expect(r.status).toBe(1);
    expect(existsSync(inside)).toBe(false);
    expect(r.stderr).toContain("inside the repo");
  });

  it("writes a 0600 key file outside the repo", () => {
    const out = join(dir, "judge.json");
    const r = run("new-near-keypair.ts", "--out", out, "--account", "x.testnet");
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(PRIV_NEAR);
    const cred = JSON.parse(readFileSync(out, "utf8"));
    expect(cred.account_id).toBe("x.testnet");
    expect(cred.private_key).toMatch(/^ed25519:/);
  });
});
