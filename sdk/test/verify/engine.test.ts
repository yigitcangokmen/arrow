// WS4-T13 acceptance: the engine over a fake network. buildWorld() is fully PROVEN; each test breaks one fact.
import { describe, expect, it } from "vitest";
import { formatReport, runVerify, SUMMARY_RE, type VerifyOptions } from "../../src/verify/index.ts";
import { base58ToHex } from "../../src/verify/links.ts";
import type { EvidenceRun } from "../../src/index.ts";
import { buildWorld, fakeFetch, fixture, makeAttestation, secretRow, sha, type World } from "./world.ts";

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
    expect((await run(buildWorld("testnet"), { only: ["wasm"] })).rows.map((x) => x.id)).toEqual(["R1", "I3", "I5"]);
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
      w.contract = w.evidence.contract = "arrow.arrowhq.testnet"; // the market these records came from, whatever the default is
      w.evidence.runs = w.evidence.runs.filter((x) => x.id === "e1").map((x) => ({ ...x, tx: REAL_TX, contract: w.contract }));
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
    const intentsKey = buildWorld("mainnet"); // X12-3: a key registered inside intents.near survives the NEAR DeleteKey
    intentsKey.intentsKeys = ["ed25519:3666zm"];
    const ik = row(await run(intentsKey), "R6");
    expect(ik.label).toBe("NOT PROVEN");
    expect(ik.detail).toContain("ed25519:3666zm");
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

describe("STATE-8 / QA-06: get_listings pages by id", () => {
  it("reads every listing past #50 exactly once", async () => {
    const { VerifyCtx } = await import("../../src/verify/context.ts");
    const { ArrowViews } = await import("../../src/contract.ts");
    const w = buildWorld("testnet");
    w.listings = Array.from({ length: 120 }, (_, i) => ({ ...w.listings[0], id: i + 1 }));
    const ctx = new VerifyCtx({ network: w.network, evidence: w.evidence, fetchImpl: fakeFetch(w) });
    const ids = (await ctx.listings()).map((l) => Number(l.id));
    expect(ids).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    const views = new ArrowViews(w.network, w.contract, { fetchImpl: fakeFetch(w) });
    expect((await views.allListings()).map((l) => Number(l.id))).toEqual(ids);
  });
});

describe("STATE-6: R8 checks the counter against the eval records", () => {
  it("an evals_used lower than the evals the listing holds is NOT PROVEN, naming the listing", async () => {
    const w = buildWorld("testnet");
    const id = w.listings[0].id;
    const held = w.evals.filter((e) => e.listing_id === id).length;
    expect(held).toBeGreaterThan(0);
    w.evals.push({ ...w.evals.find((e) => e.listing_id === id), id: 999 }); // one more record than the counter says
    const r8 = row(await run(w), "R8");
    expect(r8.label).toBe("NOT PROVEN");
    expect(r8.detail).toContain(`listing #${id}: get_evals_by_listing has ${held + 1} evals, evals_used is ${held}`);
  });
});

describe("STATE-2: R1 after set_program", () => {
  /** The program moves to B; listing 1 and its evals stay under A. With `withNewEval`, listing 2 is listed and inspected under B. */
  function moved(withNewEval: boolean) {
    const w = buildWorld("testnet");
    const b = Uint8Array.from({ length: 64 }, () => 9);
    const bHash = sha(b);
    w.config.config.program_wasm_hash = bHash;
    w.files["https://wasm.test/arrow-tee.wasm"] = b;
    w.releaseSha256 = bHash;
    if (withNewEval) {
      w.listings.push({ ...w.listings[0], id: 2, program_hash_at_list: bHash });
      w.txs.EVAL3 = JSON.parse(JSON.stringify(w.txs.EVAL1).replaceAll("EVAL1", "EVAL3").replaceAll("4001", "4003"));
      w.attestations[4003] = makeAttestation({ ...w.attestations[4001], request_id: 4003, transaction_hash: "EVAL3", wasm_hash: bHash, executed_wasm_sha256: bHash });
      w.evidence.runs.push({ ...w.evidence.runs.find((r) => r.id === "e1")!, id: "e3", tx: "EVAL3", listing_id: 2, eval_id: 4 });
    }
    return w;
  }

  it("evals under the old program do not fail R1; one eval under the new program proves it", async () => {
    const r1 = row(await run(moved(true)), "R1");
    expect(r1.label, r1.detail).toBe("PROVEN");
    expect(r1.detail).toContain("equal on 1 eval (2 under older programs not compared)");
  });

  it("runs that name another contract are not read against this one", async () => {
    const w = buildWorld("testnet");
    for (const r of w.evidence.runs) r.contract = "old-market.arrowhq.testnet"; // another market
    const r = await run(w);
    expect(row(r, "R1").label).toBe("NOT PROVEN");
    expect(row(r, "R3").label).toBe("NOT PROVEN");
    w.evidence.runs.forEach((x) => (x.contract = w.contract));
    expect((await run(w)).required).toEqual({ proven: 5, total: 5 });
  });

  it("runs that name no contract are not read: their listing, eval and purchase ids may be an earlier market's", async () => {
    const w = buildWorld("testnet");
    // The 2026-11-10 runs predate the field. One is a first-contract eval (its real tx and OutLayer record) whose ids
    // arrow-v2 reuses; the others name a purchase and a refund tx this market does not have.
    const REAL_TX = "4RzSuxeo1coQZangy4inXt4yhVf9ta7G8eWFJ3M7fS2j";
    w.txs[REAL_TX] = fixture("tx-eval-15850.json");
    w.attestations[15850] = fixture("attestation-15850.json");
    const unnamed = (o: Partial<EvidenceRun>): EvidenceRun => {
      const { contract: _, ...r } = { ...w.evidence.runs[0], ...o };
      return r;
    };
    w.evidence.runs.push(
      unnamed({ id: "old-e", kind: "eval", tx: REAL_TX, listing_id: 1, eval_id: 4 }),
      unnamed({ id: "old-b", kind: "buy", tx: "OLDBUY", listing_id: 1, purchase_id: 2 }),
      unnamed({ id: "old-f", kind: "refund", tx: "OLDREFUND", listing_id: 1, eval_id: 5 }),
    );
    expect((await run(w)).required).toEqual({ proven: 5, total: 5 });
  });

  it("with only old-program evals R1 says so, instead of a hash mismatch", async () => {
    const r1 = row(await run(moved(false)), "R1");
    expect(r1.label).toBe("NOT PROVEN");
    expect(r1.detail).toContain("no eval under the current program yet");
  });
});

describe("I5 (CRY-4): the program secret row", () => {
  const i5 = async (w: World) => row(await run(w), "I5");

  it("is PROVEN for one row tied to this wasm and this contract, never moved, created after the set_program, and never REQUIRED", async () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const w = buildWorld(network);
      const r = await run(w, network === "mainnet" ? { preLock: true } : {});
      expect(row(r, "I5"), `${network}: ${row(r, "I5")?.detail}`).toMatchObject({ label: "PROVEN", required: false });
      expect(r.required.proven).toBe(r.required.total);
    }
  });

  it("a moved row (updated_at after created_at) is NOT PROVEN", async () => {
    const w = buildWorld();
    w.secrets[0].updated_at = 1763000200000000000;
    expect(await i5(w)).toMatchObject({ label: "NOT PROVEN", required: false });
    expect((await i5(w)).detail).toContain("updated_at");
  });

  it("an access rule that names another wasm, drops the caller rule or names another caller is NOT PROVEN", async () => {
    const hash = buildWorld().config.config.program_wasm_hash;
    for (const access of [
      { Logic: { operator: "And", conditions: [{ WasmHash: { hash: "0".repeat(64) } }, { Predecessor: { condition: { Whitelist: { accounts: ["arrow-v2.arrowhq.testnet"] } } } }] } },
      { WasmHash: { hash } },
      { Logic: { operator: "Or", conditions: [{ WasmHash: { hash } }, { Predecessor: { condition: { Whitelist: { accounts: ["arrow-v2.arrowhq.testnet"] } } } }] } },
      { Logic: { operator: "And", conditions: [{ WasmHash: { hash } }, { Predecessor: { condition: { Whitelist: { accounts: ["arrow-v2.arrowhq.testnet", "evil.testnet"] } } } }] } },
      "AllowAll",
    ]) {
      const w = buildWorld();
      w.secrets[0].access = access;
      expect(await i5(w), JSON.stringify(access)).toMatchObject({ label: "NOT PROVEN", required: false });
    }
  });

  it("no row, or two rows for the current wasm, is NOT PROVEN; a row for an older wasm is ignored", async () => {
    const w = buildWorld();
    const { contract } = w;
    w.secrets = [];
    expect((await i5(w)).label).toBe("NOT PROVEN");
    w.secrets = [secretRow(w.config.config.program_wasm_hash, contract), secretRow(w.config.config.program_wasm_hash, contract)];
    expect((await i5(w)).label).toBe("NOT PROVEN");
    w.secrets = [secretRow("ab".repeat(32), contract, { created_at: 1, updated_at: 2 }), secretRow(w.config.config.program_wasm_hash, contract)];
    expect((await i5(w)).label).toBe("PROVEN");
  });

  it("a row created before the last set_program of this wasm is NOT PROVEN", async () => {
    const w = buildWorld();
    w.secrets[0] = secretRow(w.config.config.program_wasm_hash, w.contract, { created_at: 1762999999000000000, updated_at: 1762999999000000000 });
    expect(await i5(w)).toMatchObject({ label: "NOT PROVEN" });
    expect((await i5(w)).detail).toContain("set_program");
  });

  /** A second set_program tx in block LATERBLOCK, after the secret row was made, setting `hash` (url moved). */
  const resetProgram = (w: World, hash: string, id: string, block: string, ns: string) => {
    const tx = JSON.parse(JSON.stringify(w.txs.SETPROG1));
    tx.transaction.hash = id;
    tx.transaction_outcome = { ...tx.transaction_outcome, id, block_hash: block };
    tx.transaction.actions[0].FunctionCall.args = Buffer.from(JSON.stringify({ url: "https://moved.test/arrow-tee.wasm", hash })).toString("base64");
    w.txs[id] = tx;
    w.blockTimes = { ...(w.blockTimes ?? {}), [block]: ns };
    w.evidence.runs.push({ ...w.evidence.runs.find((r) => r.id === "d1")!, id: `d-${id}`, tx: id });
  };

  it("a later set_program that only moves the url (same hash) keeps a row made for this program PROVEN", async () => {
    const w = buildWorld();
    resetProgram(w, w.config.config.program_wasm_hash, "SETPROG2", "LATERBLOCK", "1763000200000000000");
    expect(await i5(w), (await i5(w)).detail).toMatchObject({ label: "PROVEN" });
  });

  it("a row made before a switch to another wasm and back is NOT PROVEN", async () => {
    const w = buildWorld();
    const hash = w.config.config.program_wasm_hash;
    resetProgram(w, "cd".repeat(32), "SETPROGB", "BLOCKB", "1763000200000000000");
    resetProgram(w, hash, "SETPROG3", "BLOCKC", "1763000300000000000");
    expect(await i5(w)).toMatchObject({ label: "NOT PROVEN" });
  });

  it("without a recorded set_program of this wasm it is NOT PROVEN", async () => {
    const w = buildWorld();
    w.evidence.runs = w.evidence.runs.filter((r) => r.kind !== "deploy");
    expect((await i5(w)).label).toBe("NOT PROVEN");
    const v = buildWorld();
    v.txs.SETPROG1.transaction.actions[0].FunctionCall.args = Buffer.from(JSON.stringify({ url: "x", hash: "cd".repeat(32) })).toString("base64");
    expect((await i5(v)).label).toBe("NOT PROVEN");
  });
});
