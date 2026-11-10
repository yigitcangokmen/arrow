// WS4-T13 acceptance: the engine over a fake network. buildWorld() is fully PROVEN; each test breaks one fact.
import { describe, expect, it } from "vitest";
import { formatReport, runVerify, SUMMARY_RE, type VerifyOptions } from "../../src/verify/index.ts";
import { base58ToHex } from "../../src/verify/links.ts";
import { buildWorld, fakeFetch, fixture, type World } from "./world.ts";

const run = (w: World, extra: Partial<VerifyOptions> = {}) =>
  runVerify({ network: w.network, evidence: w.evidence, releaseSha256: w.releaseSha256, fetchImpl: fakeFetch(w), now: new Date("2026-11-12T13:00:00Z"), ...extra });
const row = (r: Awaited<ReturnType<typeof run>>, id: string) => r.rows.find((x) => x.id === id)!;

describe("testnet", () => {
  it("is 5/5 REQUIRED PROVEN: R1 R2 R3 R5 R8", async () => {
    const w = buildWorld("testnet");
    const r = await run(w);
    for (const id of ["R1", "R2", "R3", "R5", "R8"]) expect(row(r, id), `${id}: ${row(r, id)?.detail}`).toMatchObject({ label: "PROVEN", required: true });
    expect(r.required).toEqual({ proven: 5, total: 5 });
    expect(r.exitCode).toBe(0);
    expect(formatReport(r).at(-1)).toBe("verify: 5/5 REQUIRED PROVEN · exit 0");
  });

  it("testnet_omits_r4_r6_r7", async () => {
    const r = await run(buildWorld("testnet"));
    expect(r.rows.map((x) => x.id)).toEqual(expect.not.arrayContaining(["R4", "R6", "R7"]));
    expect(r.rows.map((x) => x.id).slice(0, 5)).toEqual(["R1", "R2", "R3", "R5", "R8"]);
  });

  it("labels_only_three", async () => {
    const lines = formatReport(await run(buildWorld("testnet")));
    const tags = lines.filter((l) => l.startsWith("[")).map((l) => l.match(/^\[([^\]]+)\]/)![1]);
    expect(tags.length).toBeGreaterThan(10);
    expect(new Set(tags)).toEqual(new Set(["PROVEN", "NOT PROVEN", "RISKY"]));
    expect(lines.filter((l) => /^\[(PROVEN|NOT PROVEN|RISKY)\] /.test(l)).length).toBe(tags.length);
  });

  it("summary_line_format", async () => {
    const lines = formatReport(await run(buildWorld("testnet")));
    expect(lines.at(-1)).toMatch(SUMMARY_RE);
    expect(lines.filter((l) => SUMMARY_RE.test(l))).toHaveLength(1);
  });

  it("n1_always_not_proven, and the K rows are always RISKY", async () => {
    const r = await run(buildWorld("testnet"));
    expect(row(r, "N1")).toMatchObject({ label: "NOT PROVEN", required: false });
    expect(row(r, "N1").title).toContain("current endpoint state only");
    expect(row(r, "N2")).toMatchObject({ label: "NOT PROVEN", required: false });
    const k = r.rows.filter((x) => x.id.startsWith("K"));
    expect(k.map((x) => x.id)).toEqual(["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"]);
    expect(k.every((x) => x.label === "RISKY" && !x.required)).toBe(true);
  });

  it("k8_mainnet_inference_key_is_risky", async () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const k8 = row(await run(buildWorld(network)), "K8");
      expect(k8, network).toMatchObject({ label: "RISKY", required: false });
      expect(k8.title).toContain("NEAR Builders");
      expect(k8.detail).toContain("cannot be topped up");
      expect(k8.detail).toContain("expiry is not published");
      expect(k8.detail).toContain("refund by design");
    }
  });

  it("k5 names the instruction count as a buyer-steerable side channel", async () => {
    const k5 = row(await run(buildWorld("testnet")), "K5");
    expect(k5.detail).toContain("instruction count");
    expect(k5.detail).toContain("key and date column");
  });

  it("n1 stays NOT PROVEN when the endpoint is down", async () => {
    const w = buildWorld("testnet");
    const f = fakeFetch(w);
    const r = await run(w, { fetchImpl: (async (u: any, i: any) => (String(u).includes("cloud-api.near.ai") ? new Response("", { status: 503 }) : f(u, i))) as typeof fetch });
    expect(row(r, "N1")).toMatchObject({ label: "NOT PROVEN" });
  });

  it("I1 I2 I3: output hash, report_data and code hash are checked but not REQUIRED", async () => {
    const w = buildWorld("testnet");
    w.evidence.contract_wasm_sha256 = base58ToHex(w.codeHash);
    const r = await run(w);
    expect(row(r, "I1")).toMatchObject({ label: "PROVEN", required: false });
    expect(row(r, "I1").detail).toContain("written");
    expect(row(r, "I2")).toMatchObject({ label: "PROVEN", required: false });
    expect(row(r, "I3")).toMatchObject({ label: "PROVEN", required: false });
  });

  it("I1 becomes REQUIRED when the hash semantics are confirmed", async () => {
    const r = await run(buildWorld("testnet"), { semantics: "confirmed-s1b" });
    expect(row(r, "I1").required).toBe(true);
    expect(r.required).toEqual({ proven: 6, total: 6 });
  });

  it("I3 is NOT PROVEN when the code hash differs", async () => {
    const w = buildWorld("testnet");
    w.evidence.contract_wasm_sha256 = "ab".repeat(32);
    expect(row(await run(w), "I3").label).toBe("NOT PROVEN");
  });

  it("archival_used_for_tx_status", async () => {
    const w = buildWorld("testnet");
    await run(w, { only: ["g3"] });
    const txCalls = w.calls.filter(([, m]) => m === "EXPERIMENTAL_tx_status");
    expect(txCalls.length).toBeGreaterThan(0);
    // every tx lookup goes to the archival node first
    expect(txCalls[0][0]).toBe("https://archival-rpc.testnet.fastnear.com");
  });

  it("--only selects rows", async () => {
    const r = await run(buildWorld("testnet"), { only: ["g1"] });
    expect(r.rows.map((x) => x.id)).toEqual(["R8"]);
    expect(formatReport(r).at(-1)).toBe("verify: 1/1 REQUIRED PROVEN · exit 0");
    expect((await run(buildWorld("testnet"), { only: ["wasm"] })).rows.map((x) => x.id)).toEqual(["R1", "I3"]);
  });
});

describe("failures", () => {
  it("exit_code_rules: any REQUIRED row that is not PROVEN gives exit 1", async () => {
    const w = buildWorld("testnet");
    w.leak[1].spent_milli = 1;
    const r = await run(w);
    expect(row(r, "R8").label).toBe("NOT PROVEN");
    expect(r.required).toEqual({ proven: 4, total: 5 });
    expect(r.exitCode).toBe(1);
    expect(formatReport(r).at(-1)).toBe("verify: 4/5 REQUIRED PROVEN · exit 1");
  });

  it("not_proven_never_counts: RISKY and NOT PROVEN rows do not change the count, a thrown check is NOT PROVEN", async () => {
    const w = buildWorld("testnet");
    const f = fakeFetch(w);
    // the contract views stop answering: every row that needs them is NOT PROVEN, none throws out of runVerify
    const down = (async (u: any, i: any) => (i?.body && String(i.body).includes("call_function") ? new Response("down", { status: 500 }) : f(u, i))) as typeof fetch;
    const r = await run(w, { fetchImpl: down });
    for (const id of ["R1", "R3", "R5", "R8"]) expect(row(r, id).label, id).toBe("NOT PROVEN");
    expect(r.exitCode).toBe(1);
  }, 30_000);

  it("no REQUIRED row ran: exit 1, not a pass", async () => {
    const r = await run(buildWorld("testnet"), { only: ["oneclick"] }); // R4 does not exist on testnet
    expect(r.required.total).toBe(0);
    expect(r.exitCode).toBe(1);
  });

  it("R1: the release hash must equal the contract hash", async () => {
    const r = await run(buildWorld("testnet"), { releaseSha256: "cd".repeat(32) });
    expect(row(r, "R1")).toMatchObject({ label: "NOT PROVEN" });
    expect(row(r, "R1").detail).toContain("hash chain differs");
    expect((await run(buildWorld("testnet"), { releaseSha256: undefined })).rows[0].detail).toContain("release/sha256.txt not provided");
  });

  it("R1: the wasm behind the URL must hash to the contract hash", async () => {
    const w = buildWorld("testnet");
    w.files[w.wasmUrl] = new Uint8Array([1, 2, 3]);
    expect(row(await run(w), "R1").label).toBe("NOT PROVEN");
  });

  it("R1: a stored attestation with another wasm_hash is a contradiction", async () => {
    const w = buildWorld("testnet");
    w.attestations[4001] = { ...w.attestations[4001], wasm_hash: "ee".repeat(32) };
    const r = row(await run(w), "R1");
    expect(r.label).toBe("NOT PROVEN");
    expect(r.detail).toContain("differs");
  });

  it("R1 and R2: no stored attestation at all means NOT PROVEN, never PROVEN", async () => {
    const w = buildWorld("testnet");
    w.attestations = {};
    const r = await run(w);
    expect(row(r, "R1").label).toBe("NOT PROVEN");
    expect(row(r, "R2")).toMatchObject({ label: "NOT PROVEN" });
    expect(row(r, "R2").detail).toContain("attestation not stored");
    expect(r.exitCode).toBe(1);
  });

  it("R1 and R2 still prove when only one of two attestations is missing", async () => {
    const w = buildWorld("testnet");
    delete w.attestations[4002];
    const r = await run(w);
    expect(row(r, "R1").label).toBe("PROVEN");
    expect(row(r, "R2").label).toBe("PROVEN");
  });

  it("R2: attestation for another tx or another caller", async () => {
    const w = buildWorld("testnet");
    w.attestations[4001] = { ...w.attestations[4001], transaction_hash: "OTHER" };
    expect(row(await run(w), "R2").label).toBe("NOT PROVEN");
    const w2 = buildWorld("testnet");
    w2.attestations[4001] = { ...w2.attestations[4001], caller_account_id: "someone.testnet" };
    expect(row(await run(w2), "R2").label).toBe("NOT PROVEN");
  });

  it("r2_caller_is_the_tx_signer_not_the_contract", async () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const w = buildWorld(network);
      const signer = w.txs.EVAL1.transaction.signer_id;
      expect(signer).not.toBe(w.contract);
      expect(w.attestations[4001].caller_account_id).toBe(signer);
      expect(row(await run(w), "R2"), network).toMatchObject({ label: "PROVEN", required: true });
      // the old rule (caller == contract) must not prove anything
      const old = buildWorld(network);
      old.attestations[4001] = { ...old.attestations[4001], caller_account_id: old.contract };
      const r = row(await run(old), "R2");
      expect(r.label).toBe("NOT PROVEN");
      expect(r.detail).toContain("is not the tx signer");
    }
  });

  it("r2_needs_the_request_to_come_through_the_contract", async () => {
    const w = buildWorld("testnet");
    w.txs.EVAL1.receipts[0].predecessor_id = "someone-else.testnet";
    const r = row(await run(w), "R2");
    expect(r.label).toBe("NOT PROVEN");
    expect(r.detail).toContain(`no request_execution from ${w.contract}`);

    const w2 = buildWorld("testnet");
    w2.txs.EVAL1.receipts[0].receipt.Action.actions[0].FunctionCall.method_name = "other_method";
    expect(row(await run(w2), "R2").label).toBe("NOT PROVEN");

    const w3 = buildWorld("testnet");
    w3.txs.EVAL1.receipts_outcome[0].outcome.logs = [w3.txs.EVAL1.receipts_outcome[0].outcome.logs[0].replace(w3.contract, "someone-else.testnet")];
    expect(row(await run(w3), "R2").detail).toContain("execution_requested predecessor is someone-else.testnet");
  });

  describe("on real testnet records (request 15850, e2e eval, tx 4RzSuxeo…fS2j)", () => {
    const REAL_TX = "4RzSuxeo1coQZangy4inXt4yhVf9ta7G8eWFJ3M7fS2j";
    /** One real eval: the archived tx and the attestation OutLayer served for it, nothing else in the world. */
    const realWorld = (att: unknown = fixture("attestation-15850.json")) => {
      const w = buildWorld("testnet");
      w.evidence.runs = w.evidence.runs.filter((x) => x.id === "e1").map((x) => ({ ...x, tx: REAL_TX }));
      w.txs = { [REAL_TX]: fixture("tx-eval-15850.json") };
      w.attestations = { 15850: att };
      return w;
    };

    it("the record's caller is the buyer who signed, and R2 is PROVEN on it", async () => {
      const w = realWorld();
      expect(w.attestations[15850].caller_account_id).toBe("e2e-buyer.arrowhq.testnet");
      expect(w.attestations[15850].caller_account_id).not.toBe(w.contract);
      const r = row(await run(w, { only: ["attestation"] }), "R2");
      expect(r, r.detail).toMatchObject({ label: "PROVEN" });
      expect(r.detail).toContain("request 15850, signed by e2e-buyer.arrowhq.testnet");
    });

    it("the record of another request (15846) is NOT PROVEN for this tx", async () => {
      const r = row(await run(realWorld(fixture("attestation-15846.json")), { only: ["attestation"] }), "R2");
      expect(r.label).toBe("NOT PROVEN");
      expect(r.detail).toContain("attestation names tx 6fSU8y8U");
    });

    it("the same tx with the contract removed from the receipts is NOT PROVEN", async () => {
      const w = realWorld();
      for (const rc of w.txs[REAL_TX].receipts) if (rc.predecessor_id === w.contract) rc.predecessor_id = "mallory.testnet";
      const r = row(await run(w, { only: ["attestation"] }), "R2");
      expect(r.label).toBe("NOT PROVEN");
      expect(r.detail).toContain(`no request_execution from ${w.contract}`);
    });
  });

  it("r3_fails_on_any_mismatch", async () => {
    const mutations: [string, (w: World) => void][] = [
      ["purchase.h", (w) => (w.purchases[0].h = "11".repeat(32))],
      ["eval.h", (w) => (w.evals[1].h = "22".repeat(32))],
      ["listing.blob_sha256", (w) => (w.listings[0].blob_sha256 = "33".repeat(32))],
      ["download", (w) => (w.files["https://blobs.test/1.bin"] = new Uint8Array([9, 9, 9]))],
      ["enclave input", (w) => {
        const tx = w.txs.EVAL1;
        tx.receipts[0].receipt.Action.actions[0].FunctionCall.args = Buffer.from(JSON.stringify({ input_data: JSON.stringify({ listing: { blob_sha256: "44".repeat(32) } }) })).toString("base64");
      }],
    ];
    for (const [name, mutate] of mutations) {
      const w = buildWorld("testnet");
      mutate(w);
      const r = row(await run(w), "R3");
      expect(r.label, name).toBe("NOT PROVEN");
    }
    const ok = await run(buildWorld("testnet"));
    expect(row(ok, "R3").detail).toContain("enclave input hash == attestation.input_hash");
  });

  it("R3: input_hash mismatch is a detail while the semantics are unconfirmed and a failure once confirmed", async () => {
    const mk = () => {
      const w = buildWorld("testnet");
      w.attestations[4001] = { ...w.attestations[4001], input_hash: "55".repeat(32) };
      return w;
    };
    expect(row(await run(mk()), "R3")).toMatchObject({ label: "PROVEN" });
    expect(row(await run(mk()), "R3").detail).toContain("detail only");
    expect(row(await run(mk(), { semantics: "confirmed-s1b" }), "R3").label).toBe("NOT PROVEN");
  });

  it("R3: no purchase, or only a refunded one, is not a proof", async () => {
    const w = buildWorld("testnet");
    w.evidence.runs = w.evidence.runs.filter((x) => x.kind !== "buy");
    expect(row(await run(w), "R3").label).toBe("NOT PROVEN");
    const w2 = buildWorld("testnet");
    w2.purchases[0].status = "refunded";
    expect(row(await run(w2), "R3").detail).toContain("no completed purchase");
  });

  it("r5_requires_both_events", async () => {
    const strip = (w: World, standard: string) => {
      w.txs.REFUND1.receipts_outcome = w.txs.REFUND1.receipts_outcome.filter((o: any) => !o.outcome.logs.some((l: string) => l.includes(`"standard":"${standard}"`)));
    };
    const noRefundEvent = buildWorld("testnet");
    strip(noRefundEvent, "arrow");
    expect(row(await run(noRefundEvent), "R5").label).toBe("NOT PROVEN");
    const noTransfer = buildWorld("testnet");
    strip(noTransfer, "nep141");
    expect(row(await run(noTransfer), "R5").label).toBe("NOT PROVEN");
    const wrongAmount = buildWorld("testnet");
    wrongAmount.txs.REFUND1.receipts_outcome[1].outcome.logs[0] = wrongAmount.txs.REFUND1.receipts_outcome[1].outcome.logs[0].replace('"amount":"100000"', '"amount":"99999"');
    expect(row(await run(wrongAmount), "R5").label).toBe("NOT PROVEN");
    const wrongBuyer = buildWorld("testnet");
    wrongBuyer.evals[2].buyer = "someone-else.testnet";
    expect(row(await run(wrongBuyer), "R5").label).toBe("NOT PROVEN");
    const none = buildWorld("testnet");
    none.evidence.runs = none.evidence.runs.filter((x) => x.kind !== "refund");
    expect(row(await run(none), "R5").detail).toContain("no refund run");
  });

  it("r8_detects_wrong_spent", async () => {
    const cases: [string, (w: World) => void][] = [
      ["spent", (w) => (w.leak[1].spent_milli = 17018)],
      ["budget", (w) => (w.leak[1].budget_milli = 1)],
      ["left", (w) => (w.leak[1].left_milli = 0)],
      ["rate vs mode", (w) => { w.listings[0].mode = "verdict"; }],
      ["evidence has more evals than the contract counted", (w) => { w.leak[1] = { ...w.leak[1], evals_used: 2, spent_milli: 11346, left_milli: 272304 }; w.listings[0].evals_used = 2; }],
      ["no listings", (w) => { w.listings = []; }],
    ];
    for (const [name, mutate] of cases) {
      const w = buildWorld("testnet");
      mutate(w);
      expect((await run(w)).rows.find((x) => x.id === "R8")!.label, name).toBe("NOT PROVEN");
    }
  });

  it("I1 and I2 are NOT PROVEN when the attestation does not match", async () => {
    const w = buildWorld("testnet");
    w.attestations[4001] = { ...w.attestations[4001], output_hash: "66".repeat(32) };
    expect(row(await run(w), "I1").label).toBe("NOT PROVEN");
    const w2 = buildWorld("testnet");
    w2.attestations[4001] = { ...w2.attestations[4001], timestamp: 1 };
    expect(row(await run(w2), "I2").label).toBe("NOT PROVEN");
  });
});

describe("mainnet", () => {
  it("--pre-lock: R1 R2 R3 R4 R5 R7 R8 are 7/7, R6 is pending and not counted", async () => {
    const w = buildWorld("mainnet");
    w.evidence.lock = { tx: null, block_height: null, timestamp_utc: null };
    w.accessKeys = [{ public_key: "ed25519:x" }];
    const r = await run(w, { preLock: true });
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R7", "R8"]) expect(row(r, id), `${id}: ${row(r, id)?.detail}`).toMatchObject({ label: "PROVEN", required: true });
    expect(row(r, "R6")).toMatchObject({ label: "NOT PROVEN", required: false });
    expect(row(r, "R6").detail).toContain("lock pending (H-16)");
    expect(r.required).toEqual({ proven: 7, total: 7 });
    const lines = formatReport(r);
    expect(lines.at(-2)).toBe("PRE-LOCK RUN · R6 pending (H-16)");
    expect(lines.at(-1)).toBe("verify: 7/7 REQUIRED PROVEN · exit 0");
  });

  it("prelock_excludes_r6: pre-lock does not hide a bad R7", async () => {
    const w = buildWorld("mainnet");
    w.listings = [];
    const r = await run(w, { preLock: true });
    expect(row(r, "R7").label).toBe("NOT PROVEN");
    expect(r.exitCode).toBe(1);
  });

  it("after the lock: 8/8 including R6 and R7 labels", async () => {
    const r = await run(buildWorld("mainnet"));
    expect(row(r, "R6")).toMatchObject({ label: "PROVEN", required: true });
    expect(row(r, "R7").detail).toContain("pre-lock");
    expect(r.required).toEqual({ proven: 8, total: 8 });
    expect(formatReport(r).at(-1)).toBe("verify: 8/8 REQUIRED PROVEN · exit 0");
    expect(r.rows.find((x) => x.id === "K2")!.title).toContain("code hash");
  });

  it("R6: a remaining access key, a lock tx by someone else, or no lock tx", async () => {
    const keys = buildWorld("mainnet");
    keys.accessKeys = [{ public_key: "ed25519:x" }];
    expect(row(await run(keys), "R6").label).toBe("NOT PROVEN");
    const signer = buildWorld("mainnet");
    signer.txs.LOCK1.transaction.signer_id = "someone.near";
    expect(row(await run(signer), "R6").label).toBe("NOT PROVEN");
    const notDelete = buildWorld("mainnet");
    notDelete.txs.LOCK1.transaction.actions = [{ Transfer: { deposit: "1" } }];
    expect(row(await run(notDelete), "R6").label).toBe("NOT PROVEN");
    const noCode = buildWorld("mainnet");
    noCode.codeHash = "11111111111111111111111111111111"; // account without a contract: no keys proves nothing
    expect(row(await run(noCode), "R6").label).toBe("NOT PROVEN");
    const none = buildWorld("mainnet");
    none.evidence.lock = { tx: null, block_height: null, timestamp_utc: null };
    const r = await run(none);
    expect(row(r, "R6").label).toBe("NOT PROVEN");
    expect(row(r, "R7").label).toBe("NOT PROVEN"); // lock time unknown without --pre-lock
  });

  it("R7: a listing created after the lock is labelled post-lock", async () => {
    const w = buildWorld("mainnet");
    w.listings.push({ ...w.listings[0], id: 2, created_at_ns: 1_763_999_999_000_000_000 });
    w.leak[2] = { ...w.leak[1], listing_id: 2, evals_used: 0, spent_milli: 0, left_milli: 283650 };
    w.listings[1].evals_used = 0;
    const r = await run(w);
    expect(row(r, "R7").detail).toContain("1 pre-lock · 1 post-lock");
  });

  it("unlocked_submission_r6_risky: R6 and R7 are RISKY and leave the REQUIRED count", async () => {
    const w = buildWorld("mainnet");
    w.evidence.lock = { tx: null, block_height: null, timestamp_utc: null };
    w.accessKeys = [{ public_key: "ed25519:x" }];
    const r = await run(w, { unlockedReason: "lock key could not be removed in time" });
    expect(row(r, "R6")).toMatchObject({ label: "RISKY", required: false });
    expect(row(r, "R6").title).toContain("contract not locked");
    expect(row(r, "R7")).toMatchObject({ label: "RISKY", required: false });
    expect(r.required).toEqual({ proven: 6, total: 6 });
    expect(r.exitCode).toBe(0);
  });

  it("R4: needs one inbound and one outbound SUCCESS", async () => {
    const w = buildWorld("mainnet");
    w.oneclick["dep-out"] = { ...w.oneclick["dep-out"], status: "REFUNDED" };
    expect(row(await run(w), "R4").label).toBe("NOT PROVEN");
    const w2 = buildWorld("mainnet");
    delete w2.oneclick["dep-in"]; // 1Click answers 404
    const r = row(await run(w2), "R4");
    expect(r.label).toBe("NOT PROVEN");
    expect(r.links.length).toBeGreaterThan(0); // explorer links are printed anyway
    const ok = row(await run(buildWorld("mainnet")), "R4");
    expect(ok.links).toEqual(expect.arrayContaining(["https://basescan.org/tx/0xbase1", "https://solscan.io/tx/solsig1"]));
  });

  it("R5 on mainnet needs the NEP-245 transfer with memo refund to the buyer", async () => {
    const w = buildWorld("mainnet");
    w.txs.REFUND1.receipts_outcome[1].outcome.logs[0] = w.txs.REFUND1.receipts_outcome[1].outcome.logs[0].replace('"memo":"refund"', '"memo":"payout"');
    expect(row(await run(w), "R5").label).toBe("NOT PROVEN");
  });
});
