// TN-4: a FastFS upload is good only when every chunk tx is FINAL and the URL serves the sha, within the wait.
import { describe, expect, it } from "vitest";
import { checkUpload, type FastfsDeps, senderOf } from "../src/fastfs-check.ts";

const SHA = "ab".repeat(32);
const URL_ = `https://fastfs.io/arrowhq.near/outlayer.near/${SHA}.wasm`;

function deps(over: Partial<FastfsDeps> & { servedAfter?: number } = {}) {
  let t = 0;
  let polls = 0;
  const lines: string[] = [];
  const d: FastfsDeps = {
    txFinal: async () => ({ ok: true, why: "FINAL, success" }),
    served: async () => polls++ >= (over.servedAfter ?? 0),
    sleep: async (ms) => void (t += ms),
    now: () => t,
    say: (l) => void lines.push(l),
    ...over,
  };
  return { d, lines, polls: () => polls };
}
const opts = { url: URL_, sha: SHA, txs: ["tx1", "tx2"], sender: "arrowhq.near", waitMinutes: 30 };

describe("fastfs-check", () => {
  it("passes when every chunk tx is FINAL and the URL serves the sha, even after the indexer lags a few minutes", async () => {
    const { d, polls } = deps({ servedAfter: 4 });
    const r = await checkUpload(d, opts);
    expect(r).toEqual({ ok: true, problems: [] });
    expect(polls()).toBe(5);
  });

  it("fails when one chunk tx never landed, although the URL serves (the CLI said Upload complete)", async () => {
    const { d } = deps({ txFinal: async (tx) => (tx === "tx2" ? { ok: false, why: "UNKNOWN_TRANSACTION" } : { ok: true, why: "FINAL, success" }) });
    const r = await checkUpload(d, opts);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(["chunk tx tx2 is not a FINAL success (UNKNOWN_TRANSACTION)"]);
  });

  it("fails after the wait when the URL stays unindexed even though every tx is FINAL", async () => {
    const { d } = deps({ served: async () => false });
    const r = await checkUpload(d, { ...opts, waitMinutes: 2 });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("does not serve");
    expect(r.problems[0]).toContain("within 2 minutes");
  });

  it("refuses an empty tx list: nothing proves the chunks landed", async () => {
    const { d } = deps();
    const r = await checkUpload(d, { ...opts, txs: [] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("no chunk tx given");
  });

  it("reads the uploader from the FastFS path", () => {
    expect(senderOf(URL_)).toBe("arrowhq.near");
    expect(senderOf(`https://test.fastfs.io/arrowhq.testnet/outlayer.testnet/${SHA}.wasm`)).toBe("arrowhq.testnet");
  });
});
