// UI2: the network badge's two states, the /trust page that holds the trust band and table, and the links that moved there.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { netBadgeState, netBadgeText } from "../lib/netBadge.ts";

describe("NetBadge: MAINNET only when the mainnet contract answered", () => {
  it("testnet, or mainnet without a live contract, is the TESTNET state", () => {
    expect(netBadgeState("testnet", true, "/")).toBe("testnet");
    expect(netBadgeState("mainnet", false, "/")).toBe("testnet");
    expect(netBadgeText("testnet", "mainnet", "/")).toBe("Mainnet not live");
    expect(netBadgeText("testnet", "testnet", "/sell")).toBe("Testnet");
  });
  it("mainnet with a live contract says so, except on the free try pages, which always run on testnet", () => {
    expect(netBadgeState("mainnet", true, "/")).toBe("mainnet");
    expect(netBadgeText("mainnet", "mainnet", "/")).toBe("Live on NEAR mainnet");
    expect(netBadgeState("mainnet", true, "/try")).toBe("testnet");
    expect(netBadgeState("mainnet", true, "/try/recorded")).toBe("testnet");
    expect(netBadgeText("testnet", "mainnet", "/try")).toBe("Testnet");
  });
  it("a failing view call counts as not live", async () => {
    const { mainnetContractLive } = await import("../lib/server/mainnetLive.ts");
    expect(await mainnetContractLive(() => Promise.reject(new Error("CodeDoesNotExist")))).toBe(false);
  });
  it("the badge component reads the state from the helper, not from a flag", () => {
    const src = readFileSync(new URL("../components/NetBadge.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/netBadgeState\(net, mainnetLive, pathname\)/);
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/mainnetLive=\{await mainnetContractLive\(\)\}/);
  });
});

describe("/trust holds who sees what, the limits and the full trust table", () => {
  it("renders the sightlines, the trust band and the closed #trust-table", async () => {
    const { default: Trust } = await import("../app/trust/page.tsx");
    const html = renderToStaticMarkup(h("div", null, Trust()));
    expect(html).toContain("Who sees what.");
    expect(html).toMatch(/<details id="trust-table"/);
    expect(html).toContain("The honest limits.");
    expect(html).toContain("Kenneth Arrow");
    expect(html).toContain("A trusted execution environment (TEE, also called an enclave)");
  });
  it("no page links to the old /#trust or /#trust-table anchors on the home page", () => {
    const root = new URL("../", import.meta.url).pathname;
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (["node_modules", ".next", "generated", "public"].includes(f) ? [] : walk(join(d, f))) : [join(d, f)]));
    const hits = [...walk(join(root, "app")), ...walk(join(root, "components")), ...walk(join(root, "lib"))]
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /["'`]\/#trust/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("home page: honesty stays one click away", () => {
  const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  it("keeps the refund rule, the bit bound with its side channels and the attack tag", () => {
    expect(src).toMatch(/an inspection comes back less Arrow&apos;s 10% share/);
    expect(src).toMatch(/at most 5\.67 bits on that output channel; a failed run adds two more outcomes/);
    expect(src).toMatch(/Run time and work done are public and are not counted in that figure/);
    expect(src).toMatch(/offline replay · pattern check/);
  });
  it("the hero's verdicts are recorded inspections, named on the board as recorded mainnet runs and linked to their audit", () => {
    expect(src).toMatch(/word: "BUY", fit: 5, novelty: 4 \}, caption: "recorded · mainnet eval #2", href: withNetwork\("\/verify\/2", "mainnet"\)/);
    expect(src).toMatch(/word: "PASS", fit: 2, novelty: 1 \}, caption: "recorded · mainnet eval #1", href: withNetwork\("\/verify\/1", "mainnet"\)/);
    expect(src).toMatch(/The verdicts shown are recorded mainnet inspections/);
  });
  it("the refund picture is the recorded failed inspection, with its refund transaction one click away", async () => {
    const { RECORDED_REFUND } = await import("../lib/links.ts");
    const { recordedRefundTx } = await import("../lib/recorded.ts");
    const { evidence } = await import("../generated/data.ts");
    expect(RECORDED_REFUND).toMatchObject({ evalId: 3, listingId: 3, paid: "$0.25", back: "$0.225", kept: "$0.025" });
    expect(recordedRefundTx(evidence.mainnet)).toBe("7Gnw32jEcgUwmhdH2T4YtcJoUPS6hdetpTmWpoFqRcos");
    expect(recordedRefundTx(evidence.testnet)).toBeNull();
    expect(src).toMatch(/<RefundPath paid=\{RECORDED_REFUND\.paid\} back=\{RECORDED_REFUND\.back\} txHref=\{refundTx \? txUrl\("near", "mainnet", refundTx\)/);
  });
  it("who sees what keeps the side channels on every page that shows it", () => {
    const sight = readFileSync(new URL("../components/Sightlines.tsx", import.meta.url), "utf8");
    for (const chip of ["file totals", "your criteria", "column names", "row count", "run time", "who paid", "rows, after you buy"]) expect(sight).toContain(`"${chip}"`);
    expect(src).not.toMatch(/Every promise, checked from the chain/);
  });
  it("only the public chain is shown as never getting the rows; the Arrow site is its own card, flagged and linked to its trust row", async () => {
    const { Sightlines, SightLegend } = await import("../components/Sightlines.tsx");
    const html = renderToStaticMarkup(h("div", null, h(SightLegend), h(Sightlines)));
    expect(html).toMatch(/aria-label="Public chain never gets"><li[^>]*><s>rows<\/s>/);
    expect(html).not.toMatch(/Arrow site never gets/);
    expect(html).toMatch(/href="\/trust#trust-row-arrow-web-app-served-javascript"/);
    expect(html).toContain("never gets");
  });
});

describe("/try: the machine follows the real run, never ahead of it", () => {
  it("shows Sample only once the inspection is paid, not while the run waits for a slow queue", async () => {
    const { machinePhase } = await import("../app/try/TryFlow.tsx");
    const base = { account: "todo", mint: "todo", list: "todo", eval: "todo", result: "todo", buy: "todo", decrypt: "todo" } as const;
    expect(machinePhase({ ...base })).toBe(0);
    expect(machinePhase({ ...base, account: "done", mint: "done", list: "done", eval: "doing" })).toBe(1);
    expect(machinePhase({ ...base, account: "done", mint: "done", list: "done", eval: "done", result: "doing" })).toBe(2);
    expect(machinePhase({ ...base, account: "done", mint: "done", list: "done", eval: "done", result: "done" })).toBe(3);
    expect(machinePhase({ ...base, account: "done", mint: "done", list: "done", eval: "done", result: "done", buy: "doing" })).toBe(4);
    expect(machinePhase({ ...base, account: "done", mint: "done", list: "done", eval: "done", result: "done", buy: "skipped" })).toBe(4);
  });
});

describe("a busy RPC is not an error", () => {
  it("rate limits, 5xx and timeouts are busy; a missing contract is not", async () => {
    const { rpcBusy } = await import("../lib/rpcBusy.ts");
    expect(rpcBusy("https://rpc.testnet.near.org: HTTP 429")).toBe(true);
    expect(rpcBusy("https://rpc.testnet.fastnear.com: HTTP 503")).toBe(true);
    expect(rpcBusy("The operation was aborted due to timeout")).toBe(true);
    expect(rpcBusy("CodeDoesNotExist { contract_id: arrow-market.near }")).toBe(false);
  });
  it("/verify says 'could not check' only when every open REQUIRED row failed on the RPC, and still never counts it as passed", async () => {
    const { summaryView } = await import("../lib/verifyView.ts");
    const row = (id: string, label: "PROVEN" | "NOT PROVEN", detail: string) => ({ id, label, required: true, title: id, detail, links: [] });
    const base = { network: "testnet" as const, contract: "c", generatedAt: "t", preLock: true, exitCode: 1 as const, required: { proven: 1, total: 2 } };
    const busy = summaryView({ ...base, rows: [row("R1", "PROVEN", "ok"), row("R8", "NOT PROVEN", "check could not run: https://archival-rpc.testnet.fastnear.com: HTTP 429")] });
    expect(busy).toMatchObject({ passed: false, busy: true });
    expect(busy.failure).toMatch(/^Could not check 1 of 2 REQUIRED rows right now/);
    const real = summaryView({ ...base, rows: [row("R1", "PROVEN", "ok"), row("R8", "NOT PROVEN", "the release hash does not match")] });
    expect(real).toMatchObject({ passed: false, busy: false, failure: "FAIL: 1 of 2 REQUIRED rows are not PROVEN" });
  });
});
