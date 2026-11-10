// The 429 retry around signed testnet calls (WS4-T10 live finding: both public RPCs refused at once under load).
import { FailoverRpcError } from "near-api-js";
import { describe, expect, it } from "vitest";
import { retryRateLimited } from "../src/transport.ts";

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
