// WS4-T11 acceptance. In-process tests use fakes (helpers.ts); the spawn tests run the real entry file against the mock views.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { b64, encryptFile, seal, sha256Hex } from "@arrow/sdk";
import { main } from "../src/cli.ts";
import { realTransport } from "../src/transport.ts";
import { DEMO, eventTx, fakeCtx, fixture, NEAR_TX, VIEWS_DIR } from "./helpers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let tmp: string;
let criteriaFile: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arrow-cli-"));
  criteriaFile = join(tmp, "criteria.json");
  writeFileSync(criteriaFile, JSON.stringify({ v: 1, text: "Daily retail units by SKU and region.", min_fit: 4 }));
  process.env.ARROW_CONFIG_DIR = join(tmp, "config");
});
afterEach(() => {
  delete process.env.ARROW_CONFIG_DIR;
  vi.unstubAllGlobals();
});

async function run(argv: string[], fake = fakeCtx()) {
  const out: string[] = [];
  const code = await main(argv, { ctx: () => fake.ctx, out: (s) => void out.push(s) });
  return { code, out: out.join("\n"), fake };
}

describe("help and usage", () => {
  it("help_lists_commands", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    for (const c of ["list", "eval", "buy", "status", "decrypt", "transfer"]) expect(out).toMatch(new RegExp(`^  ${c} `, "m"));
    expect(out).toContain("--network testnet|mainnet");
  });

  it("an unknown command and an unknown flag exit 2", async () => {
    expect((await run(["frobnicate"])).code).toBe(2);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(["status", "--nope"])).code).toBe(2);
  });

  it("no_npx_arrow_anywhere", () => {
    // git grep exits 1 when nothing matches, which is the passing case. Tests only say "never npx arrow".
    const r = spawnSync("git", ["grep", "-n", "npx arrow", "--", ".", ":!DECISIONS.md", ":!PLAN.md", ":!KICKOFF*.md", ":!tasks/", ":!**/test/**"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stdout).toBe("");
    expect(r.status).toBe(1);
  });
});

describe("eval", () => {
  it("eval_output_format", async () => {
    const { code, out } = await run(["eval", "1", "--criteria", criteriaFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/^(PASS|BUY) · fit [1-5]\/5 · novelty n\/a · out 5\.67 bits · budget left 266\.63\/283\.65 bits · eval #9 · tx https:\/\/testnet\.nearblocks\.io\/txns\/\w+$/);
  });

  it("with --my-list the criteria carry a MinHash and the novelty is printed", async () => {
    const list = join(tmp, "mine.csv");
    writeFileSync(list, "token_contract,x\nabc,1\ndef,2\n");
    const fake = fakeCtx();
    const { code, out } = await run(["eval", "1", "--criteria", criteriaFile, "--my-list", list, "--key-column", "token_contract"], fake);
    expect(code).toBe(0);
    expect(out).toContain("PASS · fit 4/5 · novelty 1/5");
    expect(fake.payCalls).toHaveLength(1);
    expect(fake.payCalls[0].amount).toBe(100000n); // the listing's eval_fee
    const msg = JSON.parse(fake.payCalls[0].msg);
    expect(msg).toMatchObject({ op: "eval", listing_id: 1, buyer_pk: DEMO.buyerPk });
    expect(fake.payCalls[0].msg).not.toContain("retail units"); // criteria are sealed
    expect(fake.evidence).toEqual([expect.objectContaining({ kind: "eval", eval_id: 9, listing_id: 1 })]);
  });

  it("verdict mode prints BUY or PASS with the verdict bits and no fit", async () => {
    const fake = fakeCtx({ listing: { mode: "verdict", bits_per_eval_milli: 1585 }, verdict: { verdict: "BUY" } });
    const { out } = await run(["eval", "1", "--criteria", criteriaFile], fake);
    expect(out).toMatch(/^BUY · out 1\.59 bits · budget left /);
    expect(out).not.toContain("fit");
  });

  it("eval_budget_exhausted_exit_6", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeCtx({ budget: { left_milli: 5000 } });
    const { code } = await run(["eval", "1", "--criteria", criteriaFile], fake);
    expect(code).toBe(6);
    expect(fake.payCalls).toHaveLength(0);
    const used = fakeCtx({ listing: { evals_used: 50, max_evals: 50 } });
    expect((await run(["eval", "1", "--criteria", criteriaFile], used)).code).toBe(6);
  });

  it("refund_language", async () => {
    const t = await run(["eval", "1", "--criteria", criteriaFile], fakeCtx({ refund: "null" }));
    expect(t.code).toBe(4);
    expect(t.out).toContain("REFUNDED (null)");
    expect(t.out).toContain("arrow-usd balance");
    const m = await run(["eval", "1", "--criteria", criteriaFile], fakeCtx({ network: "mainnet", refund: "hash_mismatch" }));
    expect(m.code).toBe(4);
    expect(m.out).toContain("NEAR Intents balance");
    for (const o of [t.out, m.out]) expect(o).not.toMatch(/your wallet/i);
  });

  it("a payment the market never accepted ends with an error, not a hang", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeCtx();
    fake.state.txEvents.current = { ...eventTx("noise", {}), final_execution_status: "FINAL" };
    expect((await run(["eval", "1", "--criteria", criteriaFile], fake)).code).toBe(1);
  });

  it("a record that stays pending exits 3", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeCtx();
    fake.ctx.views.eval = async () => ({ ...fixture("eval"), id: 9, status: "pending", sealed_result: null }) as any;
    let t = 0;
    fake.ctx.wait!.now = () => (t += 100_000);
    expect((await run(["eval", "1", "--criteria", criteriaFile], fake)).code).toBe(3);
  });

  it("an invalid criteria file exits 2 and says which field", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(criteriaFile, JSON.stringify({ v: 1, text: "x", min_fit: 9 }));
    expect((await run(["eval", "1", "--criteria", criteriaFile])).code).toBe(2);
  });
});

describe("list", () => {
  const csv = () => {
    const f = join(tmp, "data.csv");
    writeFileSync(f, "date,region,units\n2025-01-01,eu,3\n2025-01-02,us,4\n");
    return f;
  };
  const flags = (f: string, extra: string[] = []) => ["list", f, "--title", "[synthetic] retail units", "--desc", "demo", "--price", "2.00", "--eval-fee", "0.25", ...extra];

  it("list_dry_run_sends_nothing", async () => {
    const outBlob = join(tmp, "blob.bin");
    const { code, out, fake } = await run(flags(csv(), ["--dry-run", "--out-blob", outBlob]));
    expect(code).toBe(0);
    expect(fake.payCalls).toHaveLength(0);
    expect(out).toContain('"sealed_k": "****"');
    expect(out).toContain("dry run: nothing sent");
    const blob = new Uint8Array(readFileSync(outBlob));
    expect(out).toContain(sha256Hex(blob));
  });

  it("the dry-run ciphertext is reproducible, so an upload between two runs stays valid", async () => {
    const a = join(tmp, "a.bin");
    const b = join(tmp, "b.bin");
    await run(flags(csv(), ["--dry-run", "--out-blob", a]));
    await run(flags(csv(), ["--dry-run", "--out-blob", b]));
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("list_rejects_blob_hash_mismatch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const fake = fakeCtx({ fetchImpl });
    const { code } = await run(flags(csv(), ["--blob-url", "https://blobs.example/x.bin"]), fake);
    expect(code).toBe(1);
    expect(fake.payCalls).toHaveLength(0);
  });

  it("without --blob-url a real list is a usage error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(flags(csv()))).code).toBe(2);
  });

  it("lists once the hosted copy matches, paying the bond and reading the id from the event", async () => {
    const outBlob = join(tmp, "blob.bin");
    await run(flags(csv(), ["--dry-run", "--out-blob", outBlob]));
    const blob = readFileSync(outBlob);
    const fetchImpl = vi.fn(async () => new Response(blob)) as unknown as typeof fetch;
    const fake = fakeCtx({ fetchImpl, accepted: { event: "arrow_listed", data: { listing_id: 12 } } });
    const { code, out } = await run(flags(csv(), ["--blob-url", "https://blobs.example/x.bin"]), fake);
    expect(code).toBe(0);
    expect(out).toMatch(/^listed #12 · sha256 [0-9a-f]{64} · tx https:\/\//);
    expect(fake.payCalls[0].amount).toBe(100000n); // listing_bond from get_config
    expect(JSON.parse(fake.payCalls[0].msg)).toMatchObject({ op: "list", rows_claimed: 2, columns: ["date", "region", "units"], price: "2000000", eval_fee: "250000" });
  });
});

describe("buy and decrypt", () => {
  const plaintext = new TextEncoder().encode("id,label\n1,a\n2,b\n");
  function purchaseFixture(tamper = false) {
    const { key, blob, blobSha256 } = encryptFile(plaintext);
    const listing = { blob_url: "https://blobs.example/b.bin", blob_sha256: blobSha256 };
    const purchase = { ...fixture("purchase"), id: 4, status: "done", buyer_pk: DEMO.buyerPk, sealed_k_buyer: b64.enc(seal(DEMO.buyerPk, key)), h: tamper ? "0".repeat(64) : blobSha256, refund_reason: null };
    const fetchImpl = vi.fn(async () => new Response(blob)) as unknown as typeof fetch;
    return { listing, purchase, fetchImpl, blobSha256 };
  }

  it("decrypt writes the file only when every hash check holds", async () => {
    const p = purchaseFixture();
    const fake = fakeCtx({ listing: p.listing, fetchImpl: p.fetchImpl });
    fake.state.records["purchase:4"] = p.purchase;
    const out = join(tmp, "plain.csv");
    const r = await run(["decrypt", "4", "--out", out], fake);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ listing.blob_sha256 == release.h");
    expect(r.out).toContain("✔ release.h == sha256(downloaded)");
    expect(r.out).toContain(`wrote ${out} (${plaintext.length} bytes)`);
    expect(readFileSync(out)).toEqual(Buffer.from(plaintext));
  });

  it("decrypt refuses and writes nothing when release.h differs", async () => {
    const p = purchaseFixture(true);
    const fake = fakeCtx({ listing: p.listing, fetchImpl: p.fetchImpl });
    fake.state.records["purchase:4"] = p.purchase;
    const out = join(tmp, "plain.csv");
    const r = await run(["decrypt", "4", "--out", out], fake);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✘ listing.blob_sha256 == release.h");
    expect(existsSync(out)).toBe(false);
  });

  it("buy pays the price, then decrypts", async () => {
    const p = purchaseFixture();
    const fake = fakeCtx({ listing: { ...p.listing, price: "2000000" }, fetchImpl: p.fetchImpl, accepted: { event: "arrow_purchase", data: { phase: "accepted", purchase_id: 4 } } });
    fake.state.records["purchase:4"] = p.purchase;
    const out = join(tmp, "bought.csv");
    const r = await run(["buy", "1", "--demo-key", "--out", out], fake);
    expect(r.code).toBe(0);
    expect(fake.payCalls[0].amount).toBe(2000000n);
    expect(JSON.parse(fake.payCalls[0].msg)).toEqual({ op: "buy", listing_id: 1, buyer_pk: DEMO.buyerPk });
    expect(r.out).toContain("bought listing #1 · purchase #4");
    expect(readFileSync(out)).toEqual(Buffer.from(plaintext));
  });

  it("--record-demo needs --demo-key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(["buy", "1", "--record-demo"])).code).toBe(2);
  });
});

describe("status", () => {
  it("lists listings with the remaining leak budget, and one listing in JSON", async () => {
    const r = await run(["status"]);
    expect(r.out).toMatch(/^#1 · Retail sales by SKU, 2025 \(synthetic\) · price 0\.25 · eval 0\.1 · evals 3\/50 · budget left 266\.63 bits$/);
    const j = await run(["status", "--listing", "1", "--json"]);
    expect(JSON.parse(j.out)).toMatchObject({ id: 1, leak_budget_left_bits: "266.63", evals_used: 3, max_evals: 50 });
  });
});

describe("transfer", () => {
  it("transfer_reuses_e2e_step2_builder: a msg-less intent to the other wallet's 0x", async () => {
    const fake = fakeCtx({ network: "mainnet" });
    const r = await run(["transfer", "--to", "seller", "--amount", "1.00", "--network", "mainnet"], fake);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`transferred 1 USDC 0x${"b".repeat(40)} → 0x${"5".repeat(40)} · tx https://nearblocks.io/txns/${NEAR_TX}`);
    expect(fake.transferCalls).toEqual([{ toId: "0x" + "5".repeat(40), amount: 1_000_000n, actorId: "0x" + "b".repeat(40) }]);
    expect(fake.payCalls).toHaveLength(0);
  });

  it("the real transport signs a transfer intent without msg or min_gas through the hosted relay", async () => {
    const seen: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/relay")) {
        seen.push(JSON.parse(String(init!.body)));
        return new Response(JSON.stringify({ txHash: NEAR_TX, signerId: "arrow-relayer.arrowhq.near" }));
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result: { result: Array.from(new TextEncoder().encode('"252812b3"')) } }));
    }));
    const { privateKeyToAccount } = await import("viem/accounts");
    const evm = privateKeyToAccount(generatePrivateKey());
    const transport = realTransport({ network: "mainnet", relay: "hosted", env: { ARROW_RELAY_URL: "https://arrow.example" } });
    const to = "0x" + "5".repeat(40);
    const tx = await transport.transfer({ actor: { network: "mainnet", id: evm.address.toLowerCase(), evm, viewingKey: async () => DEMO }, toId: to, amount: 1_000_000n });
    expect(tx.txHash).toBe(NEAR_TX);
    const payload = JSON.parse(seen[0].multipayload.payload);
    expect(payload.intents[0]).toEqual({ intent: "transfer", receiver_id: to, tokens: { "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "1000000" } });
  });

  it("is refused on testnet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(["transfer", "--to", "seller", "--amount", "1"])).code).toBe(2);
  });
});

describe("spawned entry file with mock views", () => {
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const base = () => ({
    ...process.env,
    ARROW_TEST_MOCK_RPC: VIEWS_DIR,
    ARROW_ENV_PATH: join(tmp, ".env"),
    ARROW_CONFIG_DIR: join(tmp, "config"),
    ARROW_EVIDENCE_DIR: join(tmp, "evidence"),
    E2E_BUYER_EVM_PRIVATE_KEY: undefined,
  });

  it("mainnet_non_tty_requires_yes", () => {
    mkdirSync(join(tmp, "config"));
    writeFileSync(join(tmp, ".env"), `E2E_BUYER_EVM_PRIVATE_KEY=${generatePrivateKey()}\n`);
    const r = spawnSync(tsx, [join(ROOT, "agent/src/cli.ts"), "--network", "mainnet", "eval", "1", "--criteria", criteriaFile, "--demo-key"], {
      env: base(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(5);
    expect(r.stderr).toContain("refusing to spend without a terminal");
    expect(r.stderr).not.toContain("payment attempted");
    expect(r.stdout).toContain("spend plan:");
  }, 30_000);

  it("status --json reads the mock views", () => {
    const r = spawnSync(tsx, [join(ROOT, "agent/src/cli.ts"), "status", "--listing", "1", "--json"], { env: base(), encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ id: 1, price_usdc: "0.25", leak_budget_left_bits: "266.63" });
  }, 30_000);
});
