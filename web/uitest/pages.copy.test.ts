// Page titles (A11Y-7), the nav that follows ?network= (QA-16) and the payout copy (QA-17).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navLinks, addressUrl } from "../lib/links.ts";

describe("A11Y-7: every page names itself", () => {
  it("sell, payouts, verify, attack and try export a title; buy and verify/[evalId] name their listing and eval", async () => {
    const [sell, seller, verify, attack, tryPage, buy, evalPage] = await Promise.all([
      import("../app/sell/page.tsx"),
      import("../app/seller/page.tsx"),
      import("../app/verify/page.tsx"),
      import("../app/attack/page.tsx"),
      import("../app/try/page.tsx"),
      import("../app/buy/[id]/page.tsx"),
      import("../app/verify/[evalId]/page.tsx"),
    ]);
    expect(sell.metadata.title).toBe("Sell data");
    expect(seller.metadata.title).toBe("Payouts");
    expect(verify.metadata.title).toBe("Verify");
    expect(attack.metadata.title).toBe("Attack");
    expect(tryPage.metadata.title).toBe("Try on testnet");
    expect(String((await buy.generateMetadata({ params: Promise.resolve({ id: "7" }) })).title)).toContain("Listing 7");
    expect(String((await evalPage.generateMetadata({ params: Promise.resolve({ evalId: "12" }) })).title)).toContain("12");
  });
  it("the root layout adds the site name to each page title", async () => {
    const { metadata } = await import("../app/layout.tsx");
    expect(metadata.title).toMatchObject({ default: "Arrow", template: "%s · Arrow" });
  });
});

describe("QA-16: the nav keeps the viewed network", () => {
  it("links that read ?network= carry it when it is not the deploy default; /attack and /try do not", () => {
    // DEFAULT_NETWORK is testnet in tests, so "mainnet" is the non-default network here
    const main = Object.fromEntries(navLinks("mainnet").map((l) => [l.label, l.href]));
    expect(main.Sell).toBe("/sell?network=mainnet");
    expect(main.Payouts).toBe("/seller?network=mainnet");
    expect(main.Verify).toBe("/verify?network=mainnet");
    expect(main.Try).toBe("/try");
    const test = Object.fromEntries(navLinks("testnet").map((l) => [l.label, l.href]));
    expect(test.Sell).toBe("/sell");
  });
});

describe("QA-17: payouts copy", () => {
  it("does not say the money always lands on the 0x you listed with", async () => {
    const { default: Seller } = await import("../app/seller/page.tsx");
    const html = renderToStaticMarkup(h("div", null, await Seller({ searchParams: Promise.resolve({}) })));
    expect(html).not.toMatch(/the same 0x address you listed with/);
    expect(html).toMatch(/payout account you set when you listed/);
  });
});

describe("SCAM-2: seller links", () => {
  it("an EVM seller goes to Basescan, a NEAR seller to NearBlocks", () => {
    expect(addressUrl("0xb5ef360e42056049f584fd03bf0fb9b208e28387", "mainnet")).toBe("https://basescan.org/address/0xb5ef360e42056049f584fd03bf0fb9b208e28387");
    expect(addressUrl("arrowhq.near", "mainnet")).toBe("https://nearblocks.io/address/arrowhq.near");
    expect(addressUrl("a.testnet", "testnet")).toBe("https://testnet.nearblocks.io/address/a.testnet");
  });
});

describe("SCAM-2: the card shows who the seller is", () => {
  it("an outside seller with a [team-made] title gets the external badge, the tag stays in the title and the address is linked", async () => {
    const { ListingCard } = await import("../components/ListingCard.tsx");
    const { toListingView } = await import("../lib/server/listingsCache.ts");
    const { listingFixture } = await import("../test/helpers.ts");
    const view = toListingView(listingFixture({ title: "[team-made] NEAR DeFi wallet labels (official)", seller: "0xbad0000000000000000000000000000000000001" }), ["arrowhq.near"]);
    const html = renderToStaticMarkup(h(ListingCard, { listing: view, network: "mainnet" }));
    expect(html).toContain("external seller");
    expect(html).not.toMatch(/>team-made</);
    expect(html).toContain("[team-made] NEAR DeFi wallet labels (official)");
    expect(html).toContain("https://basescan.org/address/0xbad0000000000000000000000000000000000001");
  });
});

describe("CLM-3: no absolute-privacy wording in the web app", () => {
  it("the criteria form says the seller cannot read the criteria and that the column choice is a public side channel", async () => {
    const { CriteriaForm } = await import("../app/buy/[id]/CriteriaForm.tsx");
    const { EMPTY_CRITERIA } = await import("../lib/buy.ts");
    const html = renderToStaticMarkup(h(CriteriaForm, { columns: ["a"], value: EMPTY_CRITERIA, onChange: () => undefined }));
    expect(html).not.toMatch(/never sees|nobody can (look|see)|can see into/i);
    expect(html).toMatch(/the seller cannot read them/);
    expect(html).toMatch(/instruction count/);
  });
  it("no source file of the web app uses the absolute wording", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (["node_modules", ".next", "generated", "public"].includes(f) ? [] : walk(join(d, f))) : [join(d, f)]));
    const root = new URL("../", import.meta.url).pathname;
    const hits = walk(join(root, "app")).concat(walk(join(root, "components")), walk(join(root, "lib"))).filter((f) => /\.(tsx?|css)$/.test(f)).filter((f) => /never sees|nobody can (look|see)|can see into/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
