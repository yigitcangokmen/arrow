// Acceptance tests for the team-made dataset (WS6-T02, source B, DEC K KU-10). No network.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Criteria } from "@arrow/sdk/schemas";
import {
  aggregate, checkDataset, collect, COLUMNS, CSV_NAME, makeClient, METHODS, newChunks, OUT_DIR, pct, PUBLIC_DESC,
  renderSource, RpcFailure, sampleHeights, toCsv, type Block, type Chunk, type Manifest,
} from "../src/collect-chain-stats.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const maybe = (rel: string) => {
  try { return read(rel); } catch { return null; }
};

const block = (height: number, chunks: { id: string; incl: number; used: number }[]): Block => ({
  header: { height, hash: "H" + height, timestamp_nanosec: "1794301364027510403" },
  chunks: chunks.map((c, i) => ({ chunk_hash: c.id, shard_id: i, height_included: c.incl, gas_used: c.used, gas_limit: 1_000_000_000_000_000 })),
});
const chunk = (tx: number, rc: number): Chunk => ({ transactions: Array(tx).fill(0), receipts: Array(rc).fill(0) });

describe("aggregate", () => {
  it("chain_stats_counts_only_newly_included_chunks", () => {
    const b = block(100, [{ id: "a", incl: 100, used: 5e14 }, { id: "b", incl: 99, used: 9e14 }, { id: "c", incl: 100, used: 2.5e14 }]);
    expect(newChunks(b).map((c) => c.chunk_hash)).toEqual(["a", "c"]);
    const r = aggregate(b, [chunk(3, 10), chunk(4, 20)]);
    expect(r).toMatchObject({
      block_height: "100", shards: "3", chunks_included: "2",
      gas_used: "750000000000000", gas_limit: "2000000000000000", utilization_pct: "37.50", tx_count: "7", receipt_count: "30",
    });
    expect(r.block_ts).toBe("2026-11-10T09:02:44Z");
    expect(r.block_date).toBe("2026-11-10");
  });
  it("chain_stats_aggregate_rejects_wrong_chunk_count", () => {
    expect(() => aggregate(block(1, [{ id: "a", incl: 1, used: 0 }]), [])).toThrow();
  });
  it("chain_stats_pct_is_floor_two_decimals", () => {
    expect(pct(1n, 3n)).toBe("33.33");
    expect(pct(2n, 3n)).toBe("66.66");
    expect(pct(5n, 1000n)).toBe("0.50");
    expect(pct(1n, 1n)).toBe("100.00");
  });
  it("chain_stats_sample_heights_stride", () => {
    expect(sampleHeights(1000, 4, 600)).toEqual([1000, 400, -200, -800]);
  });
});

describe("rpc client", () => {
  const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }), { status: 200 });
  const err = (name: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", error: { name: "HANDLER_ERROR", cause: { name } } }), { status: 200 });
  const noSleep = async () => {};

  it("chain_stats_request_budget_is_block_and_chunk_only", () => {
    expect([...METHODS]).toEqual(["block", "chunk"]);
    const src = read("scripts/src/collect-chain-stats.ts");
    const called = [...src.matchAll(/call\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(["block", "chunk"]));
    expect(src).not.toMatch(/\bquery\b.*request_type|tx_status|EXPERIMENTAL/);
  });
  it("chain_stats_retries_transient_errors_then_succeeds", async () => {
    let n = 0;
    const calls: string[] = [];
    const c = makeClient({
      endpoints: ["https://one.invalid"], sleep: noSleep, paceMs: 0, retryWaits: [1, 1, 1],
      fetchImpl: async (url) => {
        calls.push(String(url));
        n++;
        return n === 1 ? new Response("", { status: 429 }) : ok({ transactions: [1], receipts: [] });
      },
    });
    const r = await c.chunk("abc");
    expect(r.transactions).toHaveLength(1);
    expect(c.stats.total).toBe(2);
    expect(c.stats.retries).toBe(1);
    expect(calls).toHaveLength(2);
  });
  it("chain_stats_falls_back_to_archival_when_block_is_missing", async () => {
    const seen: string[] = [];
    const b = block(5, [{ id: "a", incl: 5, used: 1 }]);
    const c = makeClient({
      endpoints: ["https://rpc.invalid", "https://archival.invalid"], sleep: noSleep, paceMs: 0,
      fetchImpl: async (url) => {
        seen.push(String(url));
        return String(url).startsWith("https://rpc") ? err("UNKNOWN_BLOCK") : ok(b);
      },
    });
    expect((await c.blockAt(5))?.header.height).toBe(5);
    expect(seen).toEqual(["https://rpc.invalid", "https://archival.invalid"]);
    expect(c.stats.by_endpoint["https://archival.invalid"]).toBe(1);
  });
  it("chain_stats_skipped_slot_is_null_not_an_error", async () => {
    const c = makeClient({ endpoints: ["https://a.invalid", "https://b.invalid"], sleep: noSleep, paceMs: 0, fetchImpl: async () => err("UNKNOWN_BLOCK") });
    expect(await c.blockAt(7)).toBeNull();
  });
  it("chain_stats_other_rpc_errors_throw", async () => {
    const c = makeClient({ endpoints: ["https://a.invalid", "https://b.invalid"], sleep: noSleep, paceMs: 0, fetchImpl: async () => err("INVALID_REQUEST") });
    await expect(c.blockAt(7)).rejects.toBeInstanceOf(RpcFailure);
  });
});

describe("lanes and resume", () => {
  const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }), { status: 200 });
  const noSleep = async () => {};

  it("chain_stats_spreads_requests_over_both_endpoints", async () => {
    // the sleep is stubbed, so the 1 s pacing only moves each endpoint's next free slot; the less busy one is chosen
    const c = makeClient({ endpoints: ["https://a.invalid", "https://b.invalid"], sleep: noSleep, paceMs: 1000, fetchImpl: async () => ok({ transactions: [], receipts: [] }) });
    for (let i = 0; i < 6; i++) await c.chunk("h" + i);
    expect(c.stats.by_endpoint).toEqual({ "https://a.invalid": 3, "https://b.invalid": 3 });
  });

  it("chain_stats_resume_reuses_finished_rows_and_counters", async () => {
    const mk = (h: number): Block => block(h, [{ id: "c" + h, incl: h, used: h }]);
    const stats = () => ({ total: 0, block: 0, chunk: 0, retries: 0, rate_limited: 0, by_endpoint: {} as Record<string, number> });
    const fake = (calls: string[]) => {
      const st = stats();
      return {
        stats: st,
        head: async () => (calls.push("head"), st.total++, mk(1000)),
        blockAt: async (h: number) => (calls.push("block"), st.total++, st.block++, mk(h)),
        chunk: async () => (calls.push("chunk"), st.total++, st.chunk++, chunk(2, 3)),
      };
    };
    const lines: string[] = [];
    const cache = { read: () => (lines.length ? lines.join("\n") + "\n" : null), append: (l: string) => void lines.push(l) };
    const first: string[] = [];
    const a = await collect({ rows: 5, stride: 10 }, fake(first) as never, cache);
    expect(first.filter((x) => x === "head")).toHaveLength(1);
    expect(a.manifest.rows).toBe(5);
    expect(lines.filter((l) => l.includes('"type":"row"'))).toHaveLength(5);

    // a second process finds everything in the cache and makes no request at all
    const second: string[] = [];
    const b = await collect({ rows: 5, stride: 10 }, fake(second) as never, cache);
    expect(second).toEqual([]);
    expect(b.csv).toBe(a.csv);
    expect(b.manifest.collection.started_utc).toBe(a.manifest.collection.started_utc);
    expect(b.manifest.requests.total).toBe(a.manifest.requests.total);
    expect(b.manifest.head).toEqual(a.manifest.head);

    // a smaller --rows takes the first rows of the cache (the head and stride stay)
    const third: string[] = [];
    const c = await collect({ rows: 3, stride: 10 }, fake(third) as never, cache);
    expect(third).toEqual([]);
    expect(c.manifest.rows).toBe(3);
    const heights = (csv: string) => csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[0]));
    expect(heights(c.csv)).toEqual(heights(a.csv).slice(-3));

    // a cache made with other parameters is refused
    await expect(collect({ rows: 6, stride: 10 }, fake([]) as never, cache)).rejects.toThrow(/other --rows/);
  });
});

describe("committed dataset", () => {
  const csv = read(`${OUT_DIR}/${CSV_NAME}`);
  const manifest = JSON.parse(read(`${OUT_DIR}/manifest.json`)) as Manifest;
  const source = read(`${OUT_DIR}/SOURCE.md`);

  it("chain_stats_check_passes_offline", () => {
    expect(checkDataset(maybe)).toEqual({ ok: true, problems: [], rows: manifest.rows });
  });
  it("chain_stats_has_the_card_columns_and_at_least_150_rows", () => {
    expect(csv.split("\n")[0]).toBe(COLUMNS.join(","));
    expect(manifest.rows).toBeGreaterThanOrEqual(150);
    expect(csv.split("\n").length - 2).toBe(manifest.rows);
  });
  it("chain_stats_source_names_rpc_heights_and_utc_time", () => {
    expect(source).toBe(renderSource(manifest));
    expect(source).toMatch(/https:\/\/rpc\.mainnet\.fastnear\.com/);
    expect(source).toMatch(/Collection started: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \(UTC\)/);
    expect(source).toContain(`height ${manifest.head.height}`);
    expect(source).toContain(`Block heights ${manifest.first.height}`);
    expect(source).toContain(manifest.csv.sha256);
    expect(source.split("\n")[0]).toBe("# [team-made] NEAR mainnet chain stats, Nov 2026 (computed from public RPC)");
  });
  it("chain_stats_public_desc_le_280_and_matches_the_time_span", () => {
    expect(PUBLIC_DESC.length).toBeLessThanOrEqual(280);
    const hours = (Date.parse(manifest.last.ts_utc) - Date.parse(manifest.first.ts_utc)) / 3_600_000;
    expect(PUBLIC_DESC).toContain(`over about ${Math.round(hours)} hours`);
  });
  it("chain_stats_check_detects_tampering", () => {
    const bad = (rel: string) => (rel.endsWith(".csv") ? csv.replace(/\n(\d+),/, "\n1,") : maybe(rel));
    expect(checkDataset(bad).ok).toBe(false);
  });
  it("chain_stats_is_real_data_with_no_third_party_site_or_personal_data", () => {
    expect(csv).not.toMatch(/[@]|https?:|\.near\b|\.testnet\b/);
    expect(source).not.toMatch(/market\.near\.ai|agent market/i);
    expect(read("scripts/src/collect-chain-stats.ts")).not.toMatch(/market\.near\.ai/i);
  });
  it("chain_stats_no_agent_market_files_left", () => {
    expect(maybe(`${OUT_DIR}/agent-market-2026-11.csv`)).toBeNull();
    expect(maybe("scripts/src/collect-team-made.ts")).toBeNull();
  });
  it("chain_stats_toCsv_roundtrip_shape", () => {
    const r = aggregate(block(1, [{ id: "a", incl: 1, used: 0 }]), [chunk(0, 0)]);
    const out = toCsv([r]);
    expect(out.split("\n")).toHaveLength(3);
    expect(out.endsWith("\n")).toBe(true);
  });
  it("chain_stats_criteria_valid", () => {
    const c = JSON.parse(read("fixtures/criteria/team-made.json"));
    expect(() => Criteria.parse(c)).not.toThrow();
    for (const col of c.required_columns) expect(COLUMNS).toContain(col);
  });
});
