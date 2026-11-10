import { describe, expect, it } from "vitest";
import { blockersFor, marketStateFrom } from "../lib/blockers.ts";

const cv = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) =>
  ({
    paused: false,
    tank_available: "500000000000000000000000",
    payment_path: "notify",
    result_path: "chain",
    build: "mainnet",
    config: { tank_min: "50000000000000000000000", outlayer_deposit_eval: "20000000000000000000000", outlayer_deposit_release: "10000000000000000000000", program_wasm_hash: "aa", ...cfg },
    ...over,
  }) as never;

describe("blockersFor", () => {
  const ok = marketStateFrom(cv(), "04ab");
  it("nothing blocks a healthy market", () => {
    expect(blockersFor("eval", ok, { program_hash_at_list: "aa" })).toEqual([]);
  });
  it("E05 paused, E06 no program key, E13 stale listing, E10 low tank", () => {
    expect(blockersFor("eval", marketStateFrom(cv({ paused: true }), "04ab"), { program_hash_at_list: "aa" }).map((b) => b.code)).toEqual(["MARKET_PAUSED"]);
    expect(blockersFor("buy", marketStateFrom(cv(), null), { program_hash_at_list: "aa" }).map((b) => b.code)).toEqual(["PROGRAM_KEY_MISSING"]);
    expect(blockersFor("eval", ok, { program_hash_at_list: "old" }).map((b) => b.code)).toEqual(["LISTING_STALE"]);
    expect(blockersFor("eval", marketStateFrom(cv({ tank_available: "60000000000000000000000" }), "04ab"), { program_hash_at_list: "aa" }).map((b) => b.code)).toEqual(["TANK_LOW"]);
  });
  it("the tank check adds the OutLayer deposit of that op, and none for list", () => {
    const s = marketStateFrom(cv({ tank_available: "65000000000000000000000" }), "04ab"); // tank_min 0.05 + 0.015 NEAR
    expect(blockersFor("list", s)).toEqual([]);
    expect(blockersFor("buy", s, { program_hash_at_list: "aa" })).toEqual([]);
    expect(blockersFor("eval", s, { program_hash_at_list: "aa" }).map((b) => b.code)).toEqual(["TANK_LOW"]);
  });
});
