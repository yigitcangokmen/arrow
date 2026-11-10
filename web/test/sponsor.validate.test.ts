import { describe, expect, it, vi } from "vitest";
import { SponsorRequest } from "@arrow/sdk/schemas";
import { handleSponsor, subAccountPrefix, type SponsorDeps, type SponsorPort } from "../lib/server/sponsor.ts";
import { dailyCounter, tokenBucket } from "../lib/ratelimit.ts";
import { post } from "./helpers.ts";

const KEY = "ed25519:" + "1".repeat(44);
const URL_ = "http://localhost/api/testnet-sponsor";

function setup(over: Partial<SponsorDeps> = {}, port: Partial<SponsorPort> = {}) {
  const created: any[] = [];
  const d: SponsorDeps = {
    limiter: tokenBucket({ capacity: 3, refillEveryMs: 1_200_000 }),
    daily: dailyCounter({ max: 20 }),
    nearPerAccount: "0.5",
    now: () => 1_762_000_000_000,
    random: () => "abcd",
    sponsor: () => ({
      accountId: "arrow-judge.arrowhq.testnet",
      balance: async () => 10n ** 25n,
      createSubAccount: async (prefix, publicKey, yocto) => (created.push({ prefix, publicKey, yocto }), { txHash: "SPTX" }),
      ...port,
    }),
    ...over,
  };
  return { d, created };
}

describe("key and prefix format", () => {
  it("accepts an ed25519 public key and nothing else", () => {
    expect(SponsorRequest.safeParse({ publicKey: KEY }).success).toBe(true);
    for (const k of ["secp256k1:" + "1".repeat(44), "ed25519:0OIl" + "1".repeat(40), "ed25519:short", KEY + "x".repeat(5)]) {
      expect(SponsorRequest.safeParse({ publicKey: k }).success).toBe(false);
    }
  });

  it("sub-account prefix is [a-z0-9] and the full id stays under 64 characters", () => {
    const p = subAccountPrefix(1_762_000_000_000, "abcd");
    expect(p).toMatch(/^j[a-z0-9]+$/);
    expect(`${p}.arrow-judge.arrowhq.testnet`.length).toBeLessThanOrEqual(64);
  });
});

describe("POST /api/testnet-sponsor", () => {
  it("200 {accountId, txHash, nearAmount: '0.5'} and funds 0.5 NEAR", async () => {
    const s = setup();
    const res = await handleSponsor(post(URL_, { publicKey: KEY }), s.d);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toEqual({ accountId: `${s.created[0].prefix}.arrow-judge.arrowhq.testnet`, txHash: "SPTX", nearAmount: "0.5" });
    expect(s.created[0]).toMatchObject({ publicKey: KEY, yocto: 5n * 10n ** 23n });
    expect(s.created[0].prefix).toMatch(/^j[a-z0-9]+$/);
  });

  it("400 BAD_KEY", async () => {
    const res = await handleSponsor(post(URL_, { publicKey: "nope" }), setup().d);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_KEY");
  });

  it("429 RATE_LIMITED on the 4th request from one IP", async () => {
    const s = setup();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await handleSponsor(post(URL_, { publicKey: KEY }, { "x-real-ip": "7.7.7.7" }), s.d)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it("429 DAILY_CAP on the 21st account of the day, with the offline fallback", async () => {
    const s = setup({ limiter: tokenBucket({ capacity: 1000, refillEveryMs: 1 }) });
    for (let i = 0; i < 20; i++) expect((await handleSponsor(post(URL_, { publicKey: KEY }), s.d)).status).toBe(200);
    const res = await handleSponsor(post(URL_, { publicKey: KEY }), s.d);
    expect(res.status).toBe(429);
    const b = await res.json();
    expect(b.code).toBe("DAILY_CAP");
    expect(b.fallback).toBe("npm run verify && npm run bench:offline");
    expect(s.created).toHaveLength(20);
  });

  it("503 SPONSOR_UNAVAILABLE with a faucet fallback when unconfigured or under 2 tNEAR", async () => {
    for (const d of [setup({ sponsor: () => null }).d, setup({}, { balance: async () => 10n ** 24n }).d]) {
      const res = await handleSponsor(post(URL_, { publicKey: KEY }), d);
      expect(res.status).toBe(503);
      const b = await res.json();
      expect(b.code).toBe("SPONSOR_UNAVAILABLE");
      expect(b.fallback).toContain("faucet");
    }
  });
});

describe("WEB-9: no cross-site or form-encoded request spends the daily sponsor cap", () => {
  it("text/plain is 415 and a foreign Origin is 403; neither touches the sponsor or the daily counter", async () => {
    const take = vi.fn(() => true);
    const sponsor = vi.fn(() => null);
    const { d } = setup({ daily: { take }, sponsor });
    const plain = new Request(URL_, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ publicKey: KEY }) });
    expect((await handleSponsor(plain, d)).status).toBe(415);
    const foreign = post(URL_, { publicKey: KEY }, { origin: "https://evil.example", host: "arrow.example" });
    expect((await handleSponsor(foreign, d)).status).toBe(403);
    expect(sponsor).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });
  it("the page's own origin still works", async () => {
    const s = setup();
    const res = await handleSponsor(post(URL_, { publicKey: KEY }, { origin: "https://arrow.example", host: "arrow.example" }), s.d);
    expect(res.status).toBe(200);
  });
});
