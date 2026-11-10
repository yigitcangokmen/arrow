// @vitest-environment happy-dom
// The /sell page in a DOM with the wallet, the upload and the chain replaced by fakes: X12-tabs-6 (a paid bond never leads to a
// second encryption, upload or bond), QA-12 (a rejected signature keeps the finished listing), A11Y-1 (the listing result is announced
// and focused), SCAM-2 (an outside wallet is not offered [team-made]).
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicKeyHex, scalarFromLabel } from "@arrow/sdk/crypto";
import type { Eoa } from "../lib/wallet.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const eoa = { address: "0xB5EF360E42056049F584FD03BF0FB9B208E28387", intentsId: "0xb5ef360e42056049f584fd03bf0fb9b208e28387" } as unknown as Eoa;
const eoaB = { address: "0x2222222222222222222222222222222222222222", intentsId: "0x2222222222222222222222222222222222222222" } as unknown as Eoa;
const world = vi.hoisted(() => ({ uploads: 0, pays: [] as string[], payError: null as Error | null, findFails: 0, findRefused: false, wallet: null as unknown, onAccounts: null as ((next: string | null) => void) | null }));

vi.mock("../lib/balance.ts", () => ({ intentsUsdcBalance: async () => 5_000_000n }));
vi.mock("../lib/wallet.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/wallet.ts")>()),
  connectEoa: async () => world.wallet,
  watchAccounts: (cb: (next: string | null) => void) => ((world.onAccounts = cb), () => undefined),
}));
vi.mock("@vercel/blob/client", () => ({ upload: async () => (world.uploads++, { url: "https://blob.test/x.bin" }) }));
vi.mock("../lib/settle.ts", async (orig) => {
  const real = await orig<typeof import("../lib/settle.ts")>();
  return {
  ...real,
  findEventId: async () => {
    if (world.findRefused) throw new real.PaymentRefused("Arrow: E10 gas tank low");
    if (world.findFails-- > 0) throw new Error("arrow_listed event is still pending");
    return 42;
  },
  };
});
vi.mock("../lib/pay.ts", async (orig) => {
  const real = await orig<typeof import("../lib/pay.ts")>();
  const { browserStorage, historyStore } = await import("../lib/pending.ts");
  return {
    ...real,
    payWithIntent: async (e: Eoa, a: { kind: "list" | "eval" | "buy"; listingId: number | null; amount: bigint; msg: string }) => {
      world.pays.push(a.msg);
      if (world.payError) throw world.payError;
      const at = Date.now() + world.pays.length;
      historyStore(browserStorage()).add("mainnet", e.intentsId, { v: 1, kind: a.kind, listingId: 0, tx: { txHash: "BOND" + world.pays.length, signerId: "r.near" }, resultId: null, at });
      return { txHash: "BOND" + world.pays.length, signerId: "r.near", at };
    },
  };
});

const { SellForm } = await import("../app/sell/SellForm.tsx");

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  localStorage.clear();
  Object.assign(world, { uploads: 0, pays: [], payError: null, findFails: 0, findRefused: false, wallet: eoa, onAccounts: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(h(SellForm, { network: "testnet", programPk: publicKeyHex(scalarFromLabel("arrow:test:program:v1")), bond: "100000", limits: { minPrice: "100000", minEvalFee: "50000" }, maxEvalsCap: 500, readOnly: false, teamAccounts: [], feeBps: { eval: 1000, sale: 200 } })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (text: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")));
const click = async (b: Element | undefined) => {
  expect(b, "button exists").toBeDefined();
  await act(async () => (b as HTMLElement).click());
};
const announcer = () => host.querySelector("[data-announcer]")!.textContent;

async function connectAndPick() {
  await click(button("Connect wallet"));
  const input = host.querySelector("#file") as HTMLInputElement;
  const file = new File(["account_id,label\na.near,x\nb.near,y\n"], "labels.csv", { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => new Promise((r) => setTimeout(r, 20))); // File.arrayBuffer
}

describe("/sell in a DOM", () => {
  it("X12-tabs-6: the bond is paid, the listing is not found at once: there is no second encryption, upload or bond, only Check listing", async () => {
    world.findFails = 1;
    await connectAndPick();
    await click(button("Encrypt, upload and list"));
    expect(world.pays).toHaveLength(1);
    expect(world.uploads).toBe(1);
    expect(button("Check listing")).toBeDefined();
    expect(button("Encrypt, upload and list")!.getAttribute("aria-disabled")).toBe("true");
    await click(button("Encrypt, upload and list")); // ignored
    expect(world.pays).toHaveLength(1);
    expect(world.uploads).toBe(1);
    await click(button("Check listing"));
    expect(world.pays).toHaveLength(1);
    expect(host.querySelector("#listed")!.textContent).toBe("Listed as #42");
    expect(announcer()).toBe("Listed as number 42.");
    expect(document.activeElement?.id).toBe("listed");
  });

  it("QA-12: a rejected signature keeps the finished listing: Retry listing pays the same msg without uploading again; the fields are locked", async () => {
    world.payError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await connectAndPick();
    await click(button("Encrypt, upload and list"));
    expect(world.pays).toHaveLength(1);
    expect((host.querySelector("#title") as HTMLInputElement).closest("fieldset")!.disabled).toBe(true);
    world.payError = null;
    await click(button("Retry listing"));
    expect(world.pays).toHaveLength(2);
    expect(world.pays[1]).toBe(world.pays[0]); // byte for byte the same list msg: same ciphertext hash, same sealed key
    expect(world.uploads).toBe(1);
    expect(host.querySelector("#listed")!.textContent).toBe("Listed as #42");
  });

  it("W2-2: after a wallet switch, Retry listing never pays from the new wallet with a key sealed to the old one", async () => {
    world.payError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await connectAndPick();
    await click(button("Encrypt, upload and list"));
    expect(world.pays).toHaveLength(1);
    world.payError = null;
    world.wallet = eoaB;
    await act(async () => world.onAccounts!(eoaB.intentsId)); // accountsChanged
    await click(button("Connect wallet"));
    await click(button("Retry listing"));
    expect(world.pays).toHaveLength(1);
    expect(host.textContent).toMatch(/sealed for wallet 0xb5ef36/i);
    world.wallet = eoa;
    await act(async () => world.onAccounts!(eoa.intentsId)); // switched back to the wallet the key was sealed for
    await click(button("Connect wallet"));
    await click(button("Retry listing"));
    expect(world.pays).toHaveLength(2);
    expect(host.querySelector("#listed")!.textContent).toBe("Listed as #42");
  });

  it("W2-9: a paid bond the market refused (no arrow_listed, tx final) offers Retry listing and Start over instead of a dead Check listing", async () => {
    world.findRefused = true;
    await connectAndPick();
    await click(button("Encrypt, upload and list"));
    expect(world.pays).toHaveLength(1);
    expect(host.textContent).toMatch(/E10 gas tank low/);
    expect(button("Check listing")).toBeUndefined();
    await click(button("Start over"));
    expect(button("Encrypt, upload and list")!.getAttribute("aria-disabled")).toBe("false");
  });

  it("A11Y-5: a rejected field is marked invalid and receives focus, and the hint stays linked to its field", async () => {
    await connectAndPick();
    const price = host.querySelector("#price") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(price, "0.05");
      price.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Encrypt, upload and list"));
    expect(world.pays).toHaveLength(0);
    expect(price.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement?.id).toBe("price");
    expect(host.querySelector("#desc")!.getAttribute("aria-describedby")).toBe("desc-hint");
  });

  it("SCAM-2: an outside wallet is not offered the [team-made] label", async () => {
    await click(button("Connect wallet"));
    const labels = [...host.querySelectorAll("#prefix option")].map((o) => o.textContent);
    expect(labels).toEqual(["none (external seller)", "[synthetic]"]);
  });
});
