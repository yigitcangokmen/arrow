// The 429 retry around signed testnet calls (WS4-T10 live finding: both public RPCs refused at once under load).
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailoverRpcError } from "near-api-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentUnclear, realTransport, retryRateLimited } from "../src/transport.ts";

const rate = () => Object.assign(new Error('{"jsonrpc":"2.0","error":{"code":-429,"message":"too many requests"}}'), { cause: 429 });
const noSleep = async () => {};

describe("retryRateLimited", () => {
  it("retries a call whose every provider answered 429 and returns the later success", async () => {
    let n = 0;
    const out = await retryRateLimited(async () => {
      if (++n < 3) throw new FailoverRpcError(2, [rate(), rate()]);
      return "ok";
    }, noSleep);
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry a contract error, a timeout, or a mix where one provider failed differently", async () => {
    let n = 0;
    await expect(retryRateLimited(async () => { n++; throw new Error("Smart contract panicked: Arrow: E08"); }, noSleep)).rejects.toThrow(/E08/);
    await expect(retryRateLimited(async () => { n++; throw new FailoverRpcError(2, [rate(), new Error("timeout")]); }, noSleep)).rejects.toBeInstanceOf(FailoverRpcError);
    expect(n).toBe(2);
  });

  it("gives up after six retries", async () => {
    let n = 0;
    const waits: number[] = [];
    await expect(retryRateLimited(async () => { n++; throw rate(); }, async (ms) => void waits.push(ms))).rejects.toThrow(/429/);
    expect(n).toBe(7);
    expect(waits).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });
});

describe("muteRateLimitNoise", () => {
  it("drops a lone 429 error and passes everything else through", async () => {
    const { muteRateLimitNoise } = await import("../src/transport.ts");
    const seen: unknown[][] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => void seen.push(a);
    try {
      muteRateLimitNoise();
      console.error(rate());
      console.error(new Error("something else"));
      console.error("plain text");
    } finally {
      console.error = real;
    }
    expect(seen.map((a) => String((a[0] as Error)?.message ?? a[0]))).toEqual(["something else", "plain text"]);
  });
});

describe("RELAY-3: the CLI never re-signs after an unclear relay answer", () => {
  const msg = (n: number) => JSON.stringify({ op: "buy", listing_id: 7, buyer_pk: "04" + String(n).repeat(128) });
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "arrow-relay3-"));
    process.env.ARROW_CONFIG_DIR = tmp;
  });
  afterEach(() => {
    delete process.env.ARROW_CONFIG_DIR;
    vi.unstubAllGlobals();
  });

  /** Relay answers in order; RPC answers current_salt and is_nonce_used. */
  function world(relayAnswers: Response[], nonceUsed = false) {
    const relayBodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/relay")) {
        relayBodies.push(JSON.parse(String(init!.body)));
        return relayAnswers.shift()!;
      }
      const method = JSON.parse(String(init!.body)).params.method_name;
      const value = method === "is_nonce_used" ? nonceUsed : "252812b3";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }));
    }));
    const evm = privateKeyToAccount(generatePrivateKey());
    const signMessage = vi.fn((a: { message: any }) => evm.signMessage(a));
    const actor = { network: "mainnet" as const, id: evm.address.toLowerCase(), evm: { ...evm, signMessage } as any, viewingKey: async () => ({ scalarHex: "", buyerPk: "" }) };
    const transport = realTransport({ network: "mainnet", relay: "hosted", env: { ARROW_RELAY_URL: "https://arrow.example" }, log: () => {} });
    return { relayBodies, signMessage, actor, transport };
  }
  const unclear = () => new Response(JSON.stringify({ error: "may or may not", code: "RELAY_UNCLEAR", unclear: true }), { status: 502 });
  const done = () => new Response(JSON.stringify({ txHash: "TX9", signerId: "arrow-relayer.arrowhq.near" }));

  it("re-sends the identical signed payload on the next run and signs only once", async () => {
    const w = world([unclear(), done()]);
    const first = await w.transport.pay({ actor: w.actor, amount: 2_000_000n, msg: msg(1) }).catch((e) => e);
    const tx = await w.transport.pay({ actor: w.actor, amount: 2_000_000n, msg: msg(2) });
    expect(tx.txHash).toBe("TX9");
    expect(w.signMessage).toHaveBeenCalledTimes(1);
    expect(w.relayBodies).toHaveLength(2);
    expect(w.relayBodies[1]).toEqual(w.relayBodies[0]);
    expect(first).toBeInstanceOf(PaymentUnclear);
    expect(readdirSync(join(tmp, "pending"))).toEqual([]); // settled: the next payment signs anew
  });

  it("stops without paying when the earlier nonce was already used", async () => {
    const w = world([unclear()]);
    const first = await w.transport.pay({ actor: w.actor, amount: 2_000_000n, msg: msg(1) }).catch((e) => e);
    expect(first.message).toMatch(/nonce \S+ .*never signs a new one/);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/relay")) throw new Error("must not relay");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result: { result: Array.from(new TextEncoder().encode("true")) } }));
    }));
    const second = await w.transport.pay({ actor: w.actor, amount: 2_000_000n, msg: msg(1) }).catch((e) => e);
    expect(second).toBeInstanceOf(PaymentUnclear);
    expect(second.message).toMatch(/already went through/);
    expect(w.signMessage).toHaveBeenCalledTimes(1);
  });

  it("a lost connection counts as unclear; a refusal before broadcast does not block the next payment", async () => {
    const w = world([new Response("nope", { status: 400 }), done()]);
    await expect(w.transport.pay({ actor: w.actor, amount: 1n, msg: msg(1) })).rejects.not.toBeInstanceOf(PaymentUnclear);
    await w.transport.pay({ actor: w.actor, amount: 1n, msg: msg(1) });
    expect(w.signMessage).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/relay")) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "arrow", result: { result: Array.from(new TextEncoder().encode('"252812b3"')) } }));
    }));
    await expect(w.transport.pay({ actor: w.actor, amount: 1n, msg: msg(1) })).rejects.toBeInstanceOf(PaymentUnclear);
  });

  it("the CLI exits 3 (pending) on an unclear payment", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { main } = await import("../src/cli.ts");
    const { fakeCtx } = await import("./helpers.ts");
    const fake = fakeCtx({ network: "mainnet" });
    fake.ctx.transport.pay = async () => {
      throw new PaymentUnclear("relay unclear. Payment nonce N0NCE (signer 0xbb).");
    };
    const code = await main(["buy", "1", "--network", "mainnet"], { ctx: () => fake.ctx, out: () => {} });
    expect(code).toBe(3);
    expect(err.mock.calls.flat().join(" ")).toContain("N0NCE");
  });
});
