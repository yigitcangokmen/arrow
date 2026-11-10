// WS4-T09 acceptance: the FunctionCall key rules (RPC-shaped permissions) and the printed command.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { addKeyCommand, balanceWarnings, ESCROW_METHODS, INTENTS_METHODS, keyProblems, okLine } from "../src/lib/relayer.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INTENTS = { receiver: "intents.near", methods: INTENTS_METHODS };
const ESCROW = { receiver: "arrow-market.near", methods: ESCROW_METHODS };
const fc = (receiver_id: string, method_names: string[], allowance: string | null = null) => ({ FunctionCall: { allowance, receiver_id, method_names } });

describe("keyProblems", () => {
  it("check_accepts_unlimited", () => {
    expect(keyProblems(fc("intents.near", ["execute_intents"]), INTENTS)).toEqual([]);
    expect(okLine(INTENTS)).toBe("FunctionCall key OK · allowance unlimited (null) · receiver intents.near · methods [execute_intents]");
  });

  it("check_rejects_finite_allowance", () => {
    const p = keyProblems(fc("intents.near", ["execute_intents"], "250000000000000000000000"), INTENTS);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("allowance is 250000000000000000000000");
  });

  it("check_rejects_extra_methods", () => {
    expect(keyProblems(fc("intents.near", ["execute_intents", "ft_transfer"]), INTENTS)[0]).toContain("expected exactly [execute_intents]");
    expect(keyProblems(fc("intents.near", []), INTENTS)[0]).toContain("methods are []"); // an empty list means every method
  });

  it("rejects a wrong receiver, a full-access key and a missing key", () => {
    expect(keyProblems(fc("arrow-market.near", ["execute_intents"]), INTENTS)[0]).toContain("receiver is arrow-market.near");
    expect(keyProblems("FullAccess", INTENTS)[0]).toContain("FullAccess");
    expect(keyProblems(undefined, INTENTS)[0]).toContain("not found");
  });

  it("check_escrow_second_key", () => {
    expect(keyProblems(fc("arrow-market.near", ["request_release", "request_eval"]), ESCROW)).toEqual([]);
    expect(keyProblems(undefined, ESCROW)).toHaveLength(1); // second key not added
    expect(keyProblems(fc("arrow-market.near", ["request_eval"]), ESCROW)[0]).toContain("expected exactly [request_eval, request_release]");
    expect(keyProblems(fc("intents.near", ["request_eval", "request_release"]), ESCROW)[0]).toContain("receiver is intents.near");
    expect(keyProblems(fc("arrow-market.near", ["request_eval", "request_release"], "1"), ESCROW)[0]).toContain("allowance");
  });
});

describe("balanceWarnings", () => {
  const near = (n: number) => (BigInt(Math.round(n * 1e4)) * 10n ** 20n).toString();
  it("warns above 1 NEAR and below 0.3 NEAR, not in between", () => {
    expect(balanceWarnings(near(0.9))).toEqual([]);
    expect(balanceWarnings(near(0.3))).toEqual([]);
    expect(balanceWarnings(near(1.5))[0]).toContain("> 1");
    expect(balanceWarnings(near(0.1))[0]).toContain("< 0.3");
  });
});

describe("addKeyCommand", () => {
  it("builds the mainnet and testnet commands from the card", () => {
    expect(addKeyCommand({ network: "mainnet", account: "arrow-relayer.arrowhq.near", publicKey: "ed25519:PK", spec: INTENTS })).toBe(
      "near account add-key arrow-relayer.arrowhq.near grant-function-call-access --allowance unlimited --contract-account-id intents.near --function-names execute_intents use-manually-provided-public-key ed25519:PK network-config mainnet sign-with-keychain send",
    );
    expect(addKeyCommand({ network: "testnet", account: "r.arrowhq.testnet", publicKey: "ed25519:PK", spec: ESCROW })).toContain(
      "--function-names request_eval,request_release use-manually-provided-public-key ed25519:PK network-config testnet sign-with-legacy-keychain send",
    );
  });
});

describe("setup-relayer.ts", () => {
  it("printed_command_has_no_secret", () => {
    const kp = KeyPair.fromRandom("ed25519");
    const dir = mkdtempSync(join(tmpdir(), "arrow-relayer-"));
    writeFileSync(join(dir, ".env"), `RELAYER_PRIVATE_KEY=${kp.toString()}\n`);
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "scripts/src/setup-relayer.ts"), "--network", "mainnet"], {
      env: { ...process.env, ARROW_ENV_PATH: join(dir, ".env"), RELAYER_PRIVATE_KEY: undefined },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    const pk = kp.getPublicKey().toString();
    expect(out).toContain(`use-manually-provided-public-key ${pk} network-config mainnet sign-with-keychain send`);
    for (const m of out.matchAll(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g)) expect(m[0]).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(out).not.toContain(kp.toString().slice("ed25519:".length));
  }, 30_000);

  it("fails clearly when the mainnet key is not generated yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "arrow-relayer-"));
    writeFileSync(join(dir, ".env"), "RELAYER_PRIVATE_KEY=\n");
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "scripts/src/setup-relayer.ts")], {
      env: { ...process.env, ARROW_ENV_PATH: join(dir, ".env"), RELAYER_PRIVATE_KEY: undefined },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("RELAYER_PRIVATE_KEY is empty");
  }, 30_000);
});
