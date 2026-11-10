import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, publicKeyHex, scalarFromLabel, seal, unseal } from "@arrow/sdk/crypto";
import { prepareList } from "@arrow/sdk/flows";
import { ListMsg } from "@arrow/sdk/schemas";
import { PaymentRefused } from "../lib/settle.ts";
import {
  CAP_MESSAGE, DATASETS, mapTryError, pickDemoListing, programHashBand, realDeps, runTry, TryError, TRY_STEPS, type NearApi, type StepInfo, type TryDeps, type TryStep,
} from "../lib/try/tryFlow.ts";

const programScalar = scalarFromLabel("arrow:test:program:v1");
const config = { programPk: publicKeyHex(programScalar), bond: "100000" };
const fixture = (rel: string) => readFileSync(new URL(`../../fixtures/${rel}`, import.meta.url));
const criteriaFiles = {
  demo: JSON.parse(fixture("criteria/demo.json").toString()),
  "demo-buy": JSON.parse(fixture("criteria/demo-buy.json").toString()),
  "print-row-1": JSON.parse(fixture("criteria/print-row-1.json").toString()),
};
const BUY_STATE = 25 + 4 * 5 + 3; // BUY fit 5 novelty 4

interface Calls { near: { contractId: string; methodName: string; args: Record<string, string>; deposit?: bigint }[]; fetched: string[]; steps: [TryStep, StepInfo][] }

/** A small fake chain: it records what the page sends and answers views from those msgs. */
function world(o: { faucet?: number; sponsor?: { status: number; body: object }; uploadFails?: boolean; evidence?: unknown; storage?: string | null; balance?: bigint; tamper?: boolean; evalPanic?: boolean; evalRefund?: boolean; verdictIdx?: number } = {}) {
  const calls: Calls = { near: [], fetched: [], steps: [] };
  let listMsg: ListMsg | null = null;
  let evalMsg: { buyer_pk: string } | null = null;
  let blob: Uint8Array | null = null;
  const stored = { value: o.storage ?? null };
  let n = 0;
  if (o.uploadFails && o.evidence && (o.evidence as { runs: unknown[] }).runs.length > 0) {
    // the recorded demo listing already sits on the fake chain
    const seed = prepareList({
      plaintext: new Uint8Array(fixture("demo/wallet-labels-1000.csv")), title: "[synthetic] seeded", publicDesc: "", columns: ["account_id"], rowsClaimed: 1000,
      blobUrl: "https://blob.test/b.bin", price: "250000", evalFee: "100000", mode: "scored", programPk: config.programPk,
    });
    listMsg = ListMsg.parse(JSON.parse(seed.msg));
    blob = seed.blob;
  }

  const near: NearApi = {
    KeyPair: { fromRandom: () => ({ toString: () => "ed25519:SECRET", getPublicKey: () => ({ toString: () => "ed25519:PUBLIC" }) }) },
    JsonRpcProvider: class { constructor(public o: { url: string }) {} },
    Account: class {
      constructor(public id: string) {}
      async getState() { return {}; }
      async callFunctionRaw(a: Calls["near"][number]) {
        calls.near.push(a);
        if (a.methodName === "ft_transfer_call") {
          const msg = JSON.parse(a.args.msg);
          if (msg.op === "list") listMsg = ListMsg.parse(msg);
          if (msg.op === "eval") evalMsg = msg;
        }
        return { transaction: { hash: `tx${++n}` } };
      }
    },
  } as unknown as NearApi;

  const fetchFake = (async (url: string, init?: RequestInit) => {
    calls.fetched.push(url);
    if (url.startsWith("https://helper.nearprotocol.com")) return new Response("{}", { status: o.faucet ?? 200 });
    if (url === "/api/testnet-sponsor") {
      const s = o.sponsor ?? { status: 200, body: { accountId: "j1.arrow-judge.arrowhq.testnet", txHash: "t", nearAmount: "0.5" } };
      return new Response(JSON.stringify(s.body), { status: s.status });
    }
    if (url.startsWith("/demo/")) return new Response(fixture(`demo/${url.slice(6)}`));
    if (url === "https://blob.test/b.bin") {
      const bytes = blob ? blob.slice() : new Uint8Array();
      if (o.tamper) bytes[bytes.length - 1] ^= 1;
      return new Response(bytes);
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
  }) as typeof fetch;

  const listingRec = () => ({ id: 7, blob_url: "https://blob.test/b.bin", blob_sha256: listMsg?.blob_sha256 ?? "00".repeat(32), eval_fee: "100000", price: "250000", mode: "scored" as const });
  const deps: TryDeps = {
    loadNear: async () => near,
    fetch: fetchFake,
    uploadBlob: async (_p, bytes) => {
      if (o.uploadFails) throw new Error("Failed to retrieve the client token: BLOB_NOT_CONFIGURED");
      blob = bytes;
      return "https://blob.test/b.bin";
    },
    views: {
      listing: async () => listingRec(),
      eval: async () => ({
        id: 3, status: o.evalRefund ? "refunded" : "done", refund_reason: o.evalRefund ? "bad_output" : null,
        sealed_result: b64.enc(seal(evalMsg!.buyer_pk, Uint8Array.of(o.verdictIdx ?? BUY_STATE))), h: listMsg?.blob_sha256 ?? null,
      }),
      purchase: async () => {
        const payload = unseal(programScalar, b64.dec(listMsg!.sealed_k)); // K || sha, as the enclave would read it
        const buyerPk = (JSON.parse(calls.near.filter((c) => c.methodName === "ft_transfer_call").at(-1)!.args.msg) as { buyer_pk: string }).buyer_pk;
        return { id: 5, status: "done", sealed_k_buyer: b64.enc(seal(buyerPk, payload.subarray(0, 32))), h: listMsg?.blob_sha256 ?? null };
      },
    } as unknown as TryDeps["views"],
    ftBalance: async () => o.balance ?? 0n,
    findEvent: (async (_n: string, _tx: unknown, name: string) => {
      if (name === "arrow_eval" && o.evalPanic) throw new PaymentRefused("Arrow: E11 daily eval cap reached for account");
      return name === "arrow_listed" ? { listing_id: 7 } : name === "arrow_eval" ? { eval_id: 3, left_milli: 1 } : { purchase_id: 5 };
    }) as TryDeps["findEvent"],
    waitForRecord: (async (_what: string, read: () => Promise<unknown>) => read()) as TryDeps["waitForRecord"],
    storage: { get: () => stored.value, set: (v) => void (stored.value = v) },
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1000); })(),
    evidence: o.evidence ?? null,
    criteria: criteriaFiles,
  };
  const run = (criteria: keyof typeof criteriaFiles = "demo-buy") =>
    runTry({ criteria, config, deps, signal: new AbortController().signal, onStep: (s, i) => calls.steps.push([s, i]) });
  return { calls, run, stored, plainOf: () => fixture(`demo/${DATASETS["demo-buy"].file}`) };
}

const evidenceWith = (listingId: number | null) => ({
  network: "testnet", contract: "arrow.arrowhq.testnet", contract_wasm_sha256: null, program_wasm_sha256: null, program_wasm_url: null,
  lock: { tx: null, block_height: null, timestamp_utc: null }, accounts: {}, corrections: [],
  runs: listingId === null ? [] : [{ id: "w1", kind: "list", tx: "h", chain: "near", block_height: null, timestamp_utc: "t", listing_id: listingId, eval_id: null, purchase_id: null, oneclick_deposit: null, expect: "e", observed: "o", script: "s", commit: "c" }],
});

const order = (c: Calls) => c.steps.filter(([, i]) => i.state === "doing").map(([s]) => s);

describe("runTry, the BUY scene", () => {
  it("runs account, mint, list, eval, result, buy, decrypt in that order and ends with a matching hash chain", async () => {
    const w = world();
    const r = await w.run("demo-buy");
    expect(order(w.calls)).toEqual([...TRY_STEPS]);
    expect(w.calls.steps.every(([, i]) => i.state !== "failed")).toBe(true);
    expect(r.state).toEqual({ verdict: "BUY", fit: 5, novelty: 4 });
    expect(r.hashes?.match).toBe(true);
    expect(r.usedDemoListing).toBe(false);
    expect(r.accountId).toMatch(/^try[0-9a-f]{10}\.testnet$/);
    expect(new TextDecoder().decode(r.file!.bytes)).toBe(w.plainOf().toString());
    expect(r.file!.name).toBe("arrow-listing-7.csv");
    expect(r.elapsedMs).toBeGreaterThan(0);
  });

  it("sends mint with 5 test USDC, then three ft_transfer_call payments of bond, eval fee and price with 1 yocto", async () => {
    const w = world();
    await w.run("demo-buy");
    const calls = w.calls.near;
    expect(calls.map((c) => c.methodName)).toEqual(["mint", "ft_transfer_call", "ft_transfer_call", "ft_transfer_call"]);
    expect(calls[0]).toMatchObject({ contractId: "arrow-usd.arrowhq.testnet", args: { amount: "5000000" } });
    expect(calls.slice(1).map((c) => c.args.amount)).toEqual(["100000", "100000", "250000"]);
    expect(calls.slice(1).every((c) => c.deposit === 1n && c.args.receiver_id === "arrow.arrowhq.testnet")).toBe(true);
    expect(calls.slice(1).map((c) => JSON.parse(c.args.msg).op)).toEqual(["list", "eval", "buy"]);
  });

  it("skips the mint when the balance is already enough and reuses the stored account without the faucet", async () => {
    const w = world({ balance: 5_000_000n, storage: JSON.stringify({ accountId: "kept.testnet", secret: "ed25519:SECRET" }) });
    const r = await w.run("demo");
    expect(w.calls.near.map((c) => c.methodName)).not.toContain("mint");
    expect(w.calls.fetched.some((u) => u.includes("helper.nearprotocol.com"))).toBe(false);
    expect(r.accountId).toBe("kept.testnet");
  });

  it("falls back to a recorded demo listing when the upload is not available", async () => {
    const w = world({ uploadFails: true, evidence: evidenceWith(2) });
    const r = await w.run("demo-buy");
    const listStep = w.calls.steps.find(([s, i]) => s === "list" && i.state === "done");
    expect(listStep?.[1].detail).toBe("using pre-listed demo listing #2");
    expect(r).toMatchObject({ usedDemoListing: true, listingId: 2 });
    expect(w.calls.near.filter((c) => c.methodName === "ft_transfer_call").map((c) => JSON.parse(c.args.msg).op)).toEqual(["eval", "buy"]); // no listing bond
    expect(r.hashes?.match).toBe(true); // the buyer key opens K of a listing somebody else made
  });

  it("reports NO_DEMO_LISTING when neither upload nor a recorded listing exists", async () => {
    const w = world({ uploadFails: true, evidence: evidenceWith(null) });
    await expect(w.run()).rejects.toMatchObject({ code: "NO_DEMO_LISTING" });
  });
});

describe("runTry, the PASS scenes", () => {
  it("print-row-1 stops after the verdict and never buys", async () => {
    const w = world({ verdictIdx: 0 });
    const r = await w.run("print-row-1");
    expect(r.state).toEqual({ verdict: "PASS", fit: 1, novelty: 1 });
    expect(r.file).toBeUndefined();
    expect(w.calls.near.filter((c) => c.methodName === "ft_transfer_call")).toHaveLength(2);
    expect(w.calls.steps.filter(([s, i]) => (s === "buy" || s === "decrypt") && i.state === "skipped")).toHaveLength(2);
  });
});

describe("runTry, failures", () => {
  it("maps the daily cap panic to the DEC P-03 message and marks the eval step failed", async () => {
    const w = world({ evalPanic: true });
    await expect(w.run()).rejects.toMatchObject({ code: "CAP", message: CAP_MESSAGE });
    expect(w.calls.steps.at(-1)).toEqual(["eval", { state: "failed", detail: CAP_MESSAGE }]);
  });

  it("explains a refunded inspection and points to bench:offline", async () => {
    const w = world({ evalRefund: true });
    await expect(w.run()).rejects.toThrow(/refunded \(bad_output\).*bench:offline/);
  });

  it("refuses to decrypt when the downloaded bytes do not match the chain hash", async () => {
    const w = world({ tamper: true });
    const err = await w.run().catch((e) => e);
    expect(err).toBeInstanceOf(TryError);
    expect(err.code).toBe("HASH_MISMATCH");
    expect(err.message).toMatch(/sha256\(downloaded blob\)/);
  });

  it("says account creation failed, with the CLI command, when the faucet and the sponsor both fail", async () => {
    const w = world({ faucet: 400, sponsor: { status: 503, body: { error: "Sponsor is down.", code: "SPONSOR_UNAVAILABLE", fallback: "npm run verify" } } });
    const err = await w.run().catch((e) => e);
    expect(err.code).toBe("ACCOUNT_FAILED");
    expect(err.message).toMatch(/Account creation failed: Sponsor is down\./);
    expect(err.message).toContain("npm run try:testnet");
    expect(w.calls.near).toHaveLength(0);
  });

  it("uses the sponsor account when only the faucet fails", async () => {
    const w = world({ faucet: 400 });
    expect((await w.run()).accountId).toBe("j1.arrow-judge.arrowhq.testnet");
  });

  it("passes an abort through unchanged", async () => {
    const steps: string[] = [];
    const deps = { ...realDeps({ evidence: null, criteria: {} }), loadNear: async (): Promise<NearApi> => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } };
    await expect(runTry({ criteria: "demo", config, deps, signal: new AbortController().signal, onStep: (s, i) => steps.push(`${s}:${i.state}`) })).rejects.toMatchObject({ name: "AbortError" });
    expect(steps).toEqual(["account:doing"]); // an abort is not reported as a failed step
  });
});

describe("helpers", () => {
  it("pickDemoListing takes the newest list run, or null", () => {
    expect(pickDemoListing(evidenceWith(2))).toBe(2);
    expect(pickDemoListing(evidenceWith(null))).toBeNull();
    expect(pickDemoListing(null)).toBeNull();
    expect(pickDemoListing({ nonsense: true })).toBeNull();
  });
  it("mapTryError turns both cap panics into the P-03 message and keeps other text", () => {
    expect(mapTryError(new Error("Smart contract panicked: Arrow: E11 daily eval cap reached for account")).message).toBe(CAP_MESSAGE);
    expect(mapTryError(new PaymentRefused("Arrow: E12 daily global eval cap reached")).code).toBe("CAP");
    expect(mapTryError(new Error("socket hang up"))).toEqual({ message: "socket hang up", code: "OTHER" });
  });
  it("programHashBand claims 'same as mainnet' only when both hashes are known and equal", () => {
    const h = "ab12cd34".repeat(8);
    expect(programHashBand(h, h)).toBe("Free testnet run. Same wasm hash as mainnet (ab12cd34).");
    expect(programHashBand(h, "ff".repeat(32))).toContain("mainnet runs ffffffff");
    expect(programHashBand(h, null)).toContain("not published yet");
    expect(programHashBand(null, h)).toContain("could not be read");
  });
  it("the demo datasets exist next to the criteria they belong to", () => {
    for (const d of Object.values(DATASETS)) expect(fixture(`demo/${d.file}`).length).toBeGreaterThan(100);
  });
});
