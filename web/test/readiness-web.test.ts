// QA-10, QA-13 and QA-14 (readiness review, 13 Nov). QA-10: a slow or failed get_config must not pin "Mainnet not live" on the badge for five minutes (a cold serverless
// instance during a recording); a success stays cached for five minutes.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

describe("mainnetContractLive cache", () => {
  it("retries a failure after 15 s and keeps a success for 5 min", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T17:00:00Z"));
    vi.resetModules();
    const { mainnetContractLive } = await import("../lib/server/mainnetLive.ts");
    const down = () => Promise.reject(new Error("HTTP 429"));
    const up = () => Promise.resolve({});
    expect(await mainnetContractLive(down)).toBe(false);
    vi.setSystemTime(new Date("2026-11-13T17:00:10Z"));
    expect(await mainnetContractLive(up)).toBe(false); // inside the 15 s failure window: no RPC storm
    vi.setSystemTime(new Date("2026-11-13T17:00:16Z"));
    expect(await mainnetContractLive(up)).toBe(true); // it used to stay false until 17:05
    vi.setSystemTime(new Date("2026-11-13T17:04:00Z"));
    expect(await mainnetContractLive(down)).toBe(true); // a success is kept for five minutes
  });
});

describe("home agent card path (QA-13)", () => {
  it("on the mainnet site, the recorded testnet listing keeps ?network=testnet; a mainnet listing needs no query", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARROW_NETWORK", "mainnet");
    vi.resetModules();
    try {
      const { agentCardPath } = await import("../lib/links.ts");
      expect(agentCardPath(undefined, "mainnet")).toBe("/l/14/data?network=testnet");
      expect(agentCardPath(3, "mainnet")).toBe("/l/3/data");
      expect(agentCardPath(14, "testnet")).toBe("/l/14/data?network=testnet");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("footer network line (QA-14)", () => {
  it("follows the page: /try and ?network=testnet read testnet on the mainnet site, everything else the deploy's network", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARROW_NETWORK", "mainnet");
    vi.resetModules();
    try {
      const { footerNetText, viewedNetwork } = await import("../lib/footerNet.ts");
      expect(viewedNetwork("/try", null)).toBe("testnet");
      expect(viewedNetwork("/try/recorded", "mainnet")).toBe("testnet");
      expect(viewedNetwork("/buy/14", "testnet")).toBe("testnet");
      expect(viewedNetwork("/", null)).toBe("mainnet");
      expect(footerNetText("testnet", true)).toBe("NEAR testnet · synthetic demo data · mainnet contract deployed");
      expect(footerNetText("mainnet", true)).toBe("NEAR mainnet");
      expect(footerNetText("mainnet", false)).toBe("NEAR mainnet · market not deployed yet");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("the footer renders the line through FooterNet, not from the build-time default", () => {
    const src = readFileSync(new URL("../components/Footer.tsx", import.meta.url), "utf8");
    expect(src).toContain("<FooterNet live={live} />");
    expect(src).not.toMatch(/DEFAULT_NETWORK === "testnet" \? `NEAR testnet/);
  });
});
