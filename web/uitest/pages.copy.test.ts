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
  }, 30_000);
  it("the listings page names itself", async () => {
    const { metadata } = await import("../app/listings/page.tsx");
    expect(metadata.title).toBe("Listings");
  });
  it("the root layout adds the site name to each page title", async () => {
    const { metadata } = await import("../app/layout.tsx");
    expect(metadata.title).toMatchObject({ default: "Arrow", template: "%s · Arrow" });
  });
});

describe("QA-16: the nav keeps the viewed network", () => {
  it("links that read ?network= carry it when it is not the deploy default", () => {
    // DEFAULT_NETWORK is testnet in tests, so "mainnet" is the non-default network here
    const main = Object.fromEntries(navLinks("mainnet").map((l) => [l.label, l.href]));
    expect(main.Sell).toBe("/sell?network=mainnet");
    expect(main.Payouts).toBe("/seller?network=mainnet");
    expect(main.Verify).toBe("/verify?network=mainnet");
    expect(main.Listings).toBe("/listings?network=mainnet");
    const test = Object.fromEntries(navLinks("testnet").map((l) => [l.label, l.href]));
    expect(test.Sell).toBe("/sell");
    expect(test.Listings).toBe("/listings");
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

describe("web halves of the contract group's items", () => {
  it("STATE-5: a listing sealed to another program is flagged, sorted last and has no Inspect link", async () => {
    const { toListingView } = await import("../lib/server/listingsCache.ts");
    const { markStale, sortListingViews } = await import("../lib/server/listingsPage.ts");
    const { ListingCard } = await import("../components/ListingCard.tsx");
    const { listingFixture } = await import("../test/helpers.ts");
    const views = markStale([
      toListingView(listingFixture({ id: 1, seller: "a.near", program_hash_at_list: "old", created_at_ns: 9 }), []),
      toListingView(listingFixture({ id: 2, seller: "b.near", program_hash_at_list: "aa", created_at_ns: 1 }), []),
    ], "aa");
    expect(sortListingViews(views).map((v) => v.id)).toEqual([2, 1]);
    expect(markStale(views, null).every((v) => v.stale === undefined || v === views[0])).toBe(true);
    const html = renderToStaticMarkup(h(ListingCard, { listing: views[0]!, network: "mainnet" }));
    expect(html).toMatch(/older enclave program/);
    expect(html).not.toMatch(/>Inspect</);
    expect(renderToStaticMarkup(h(ListingCard, { listing: views[1]!, network: "mainnet" }))).toMatch(/>Inspect</);
  });
  it("SCAM-7(b): an exhausted listing says it can only be bought blind", async () => {
    const { toListingView } = await import("../lib/server/listingsCache.ts");
    const { ListingCard } = await import("../components/ListingCard.tsx");
    const { listingFixture } = await import("../test/helpers.ts");
    const html = renderToStaticMarkup(h(ListingCard, { listing: toListingView(listingFixture({ evals_used: 50, max_evals: 50 }), []), network: "mainnet" }));
    expect(html).toMatch(/buying blind/);
    expect(html).not.toMatch(/buy-only/);
  });
  it("X12-U7: seller text is isolated against bidi tricks", async () => {
    const { toListingView } = await import("../lib/server/listingsCache.ts");
    const { ListingCard } = await import("../components/ListingCard.tsx");
    const { listingFixture } = await import("../test/helpers.ts");
    const html = renderToStaticMarkup(h(ListingCard, { listing: toListingView(listingFixture({ title: "Sales", public_desc: "d" }), []), network: "mainnet" }));
    expect(html).toMatch(/<h3[^>]*><a[^>]*><bdi>Sales<\/bdi><\/a><\/h3>/);
  });
  it("NUM-4 / X12-3: /sell tells the take rate with the contract's rounding and offers the encrypted file after an upload", async () => {
    const { net } = await import("../lib/format.ts");
    expect([net(50_000n, 1000), net(250_000n, 1000), net(1n, 1000), net(2_000_000n, 200)]).toEqual([45_000n, 225_000n, 1n, 1_960_000n]);
    const { SellForm } = await import("../app/sell/SellForm.tsx");
    const html = renderToStaticMarkup(h(SellForm, { network: "mainnet", programPk: "04ab", bond: "100000", limits: { minPrice: "100000", minEvalFee: "50000" }, maxEvalsCap: 500, readOnly: false, teamAccounts: [], feeBps: { eval: 1000, sale: 200 } }));
    expect(html).toContain("Arrow keeps 10% of each inspection fee and 2% of each sale.");
    expect(html).toContain("You receive 0.09 of each 0.1 inspection fee and 0.245 of each 0.25 sale.");
    expect(html).toMatch(/listing bond is a listing fee paid to Arrow; it is not given back/);
  });
});

describe("HON-1: the home page's 402 sentence says what /api/x402/<id> does", () => {
  it("describes a 402 that tells how to pay, not an address that answers once paid", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(src).not.toMatch(/asks for payment before it answers/);
    expect(src).toMatch(/always answers HTTP 402 \(payment required\) with how to inspect the listing and pay through NEAR Intents\. It takes no payment itself and never returns the file\./);
  });
});

describe("NOV-1: the second hero button leads to something watchable", () => {
  it("links the recorded-run page, not the raw audit report", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/<Link href=\{RECORDED_RUN_PATH\} className=\{styles\.second\}>Watch a recorded run<\/Link>/);
    const { RECORDED_RUN_PATH } = await import("../lib/links.ts");
    expect(RECORDED_RUN_PATH).toBe("/try/recorded");
  });
});

describe("NOV-2: one plain term for the enclave", () => {
  it("the home page defines sealed hardware once, with the technical names behind a fold; /attack uses the same term", async () => {
    const { readFileSync } = await import("node:fs");
    const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(home.match(/<b>Sealed hardware<\/b> is /g)).toHaveLength(1);
    expect(home).toMatch(/<summary>Technical detail<\/summary> <p> A trusted execution environment \(TEE, also called an enclave\)/);
    const attack = readFileSync(new URL("../app/attack/page.tsx", import.meta.url), "utf8");
    expect(attack).not.toMatch(/Ask the enclave/);
    expect(attack).toMatch(/Ask Arrow&apos;s program, in sealed hardware, to print row 1/);
  });
});
