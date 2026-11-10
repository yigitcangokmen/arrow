// A11Y-1/2/5/6: what a screen reader meets in the first render of /buy and /sell. Rendered on the server, no DOM needed.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Countdown } from "../components/Countdown.tsx";
import { BuyFlow } from "../app/buy/[id]/BuyFlow.tsx";
import { CriteriaForm } from "../app/buy/[id]/CriteriaForm.tsx";
import { SellForm } from "../app/sell/SellForm.tsx";
import { EMPTY_CRITERIA } from "../lib/buy.ts";
import { toListingView } from "../lib/server/listingsCache.ts";
import { listingFixture } from "../test/helpers.ts";

const listing = toListingView(listingFixture({ id: 7, columns: ["a", "b"] }), []);
const buy = () => renderToStaticMarkup(h(BuyFlow, { network: "mainnet", listing, programPk: "04ab", readOnly: false, blockers: { inspect: [], buy: [] } }));
const sell = () =>
  renderToStaticMarkup(h(SellForm, { network: "mainnet", programPk: "04ab", bond: "100000", limits: { minPrice: "100000", minEvalFee: "50000" }, maxEvalsCap: 500, readOnly: false, teamAccounts: [], feeBps: { eval: 1000, sale: 200 } }));

describe("A11Y-2 / QA-15: the elapsed-time counter is not a live region", () => {
  it("renders without role or aria-live, hidden from assistive technology", () => {
    const html = renderToStaticMarkup(h(Countdown, { startedAt: Date.now() }));
    expect(html).not.toMatch(/role="(status|alert|log|timer)"|aria-live=/);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("A11Y-1: one live region exists before any result does", () => {
  it("BuyFlow's first render has exactly one persistent, empty status announcer", () => {
    const html = buy();
    expect(html.match(/data-announcer/g)).toHaveLength(1);
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only" data-announcer=""><\/p>/);
  });
  it("SellForm's first render has one too", () => {
    expect(sell().match(/data-announcer/g)).toHaveLength(1);
  });
});

describe("A11Y-6: a disabled main button says why and stays reachable", () => {
  it("Inspect is aria-disabled (still in the tab order) and points at the reasons", () => {
    const html = buy();
    const btn = /<button[^>]*>Inspect · \$0\.25<\/button>/.exec(html)![0];
    expect(btn).toContain('aria-disabled="true"');
    expect(btn).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(btn).toContain('aria-describedby="b4-sign b4-why"');
    const why = /<ul id="b4-why"[^>]*>(.*?)<\/ul>/.exec(html)![1];
    expect(why).toMatch(/viewing key/);
    expect(why).toMatch(/step 3/);
  });
  it("the sell button too", () => {
    const html = sell();
    const btn = /<button[^>]*>Encrypt, upload and list<\/button>/.exec(html)![0];
    expect(btn).toContain('aria-disabled="true"');
    expect(btn).toContain('aria-describedby="sell-why"');
    expect(html).toMatch(/<ul id="sell-why"[^>]*>.*Connect a wallet/);
  });
  it("the required criteria text is marked required", () => {
    expect(buy()).toMatch(/<textarea id="crit-text"[^>]*aria-required="true"/);
  });
});

describe("A11Y-5: hints are linked to their fields", () => {
  it("the public description warning, the label hint and the criteria hint are described-by targets", () => {
    const s = sell();
    expect(s).toMatch(/<textarea id="desc"[^>]*aria-describedby="desc-hint"/);
    expect(s).toMatch(/<p id="desc-hint"[^>]*>Everyone can read this[^<]*Do not put data rows here/);
    expect(s).toMatch(/<select id="prefix"[^>]*aria-describedby="prefix-hint"/);
    const c = renderToStaticMarkup(h(CriteriaForm, { columns: ["a"], value: EMPTY_CRITERIA, onChange: () => undefined }));
    expect(c).toMatch(/<textarea id="crit-text"[^>]*aria-describedby="crit-hint"/);
    expect(c).toMatch(/<p id="crit-hint"/);
  });
});

describe("SCAM-2 / Buy page: the seller is shown", () => {
  it("the buy page names the seller with a link to an explorer", () => {
    const html = buy();
    expect(html).toMatch(/Seller <a href="https:\/\/(testnet\.)?nearblocks\.io\/address\/someone\.near"/);
  });
});

describe("QA-04 / X12-tabs-4: the Buy section is not gated on a verdict", () => {
  it("is absent before the viewing key (nothing to sign with) and its gate is covered in buy.state", () => {
    expect(buy()).not.toContain("6. Buy for");
  });
});
