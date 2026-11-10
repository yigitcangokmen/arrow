// @vitest-environment happy-dom
// QA-09, QA-14, A11Y-3 on the real component in a DOM: the balance is read again when refreshKey changes, a switched account
// resets the page, and focus lands on Refresh after connecting (the Connect button that had it is gone).
import { createElement as h, act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Eoa } from "../lib/wallet.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const balances = vi.fn(async (_id: string) => 1_000_000n);
const handlers: Array<(a: unknown) => void> = [];
const eoa = { address: "0xB5EF360E42056049F584FD03BF0FB9B208E28387", intentsId: "0xb5ef360e42056049f584fd03bf0fb9b208e28387" } as unknown as Eoa;

vi.mock("../lib/balance.ts", () => ({ intentsUsdcBalance: (id: string) => balances(id) }));
vi.mock("../lib/wallet.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/wallet.ts")>()),
  connectEoa: async () => eoa,
  watchAccounts: (cb: (n: string | null) => void) => {
    const handler = (accts: unknown) => cb(Array.isArray(accts) && typeof accts[0] === "string" ? accts[0].toLowerCase() : null);
    handlers.push(handler);
    return () => void handlers.splice(handlers.indexOf(handler), 1);
  },
}));

const { WalletButton } = await import("../components/WalletButton.tsx");

let host: HTMLDivElement;
beforeEach(() => {
  balances.mockClear();
  handlers.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function Harness({ initial = null }: { initial?: Eoa | null }) {
  const [e, setE] = useState<Eoa | null>(initial);
  const [bal, setBal] = useState<bigint | null>(null);
  const [key, setKey] = useState(0);
  return h("div", null,
    h(WalletButton, { eoa: e, balance: bal, onConnect: setE, onBalance: setBal, onReset: () => { setE(null); setBal(null); }, refreshKey: key }),
    h("button", { id: "bump", onClick: () => setKey((k) => k + 1) }, "bump"),
    h("span", { id: "who" }, e ? "connected" : "none"));
}

describe("WalletButton in a DOM", () => {
  it("QA-09: the balance is read again when refreshKey changes (after a top-up or withdrawal), not left on 'loading'", async () => {
    const root = createRoot(host);
    await act(async () => root.render(h(Harness, { initial: eoa })));
    expect(balances).toHaveBeenCalledTimes(1);
    await act(async () => (host.querySelector("#bump") as HTMLButtonElement).click());
    expect(balances).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("1 USDC");
    await act(async () => root.unmount());
  });

  it("QA-14: when the wallet switches account the page forgets the old address; the same account changes nothing", async () => {
    const root = createRoot(host);
    await act(async () => root.render(h(Harness, { initial: eoa })));
    await act(async () => handlers[0]!([eoa.intentsId]));
    expect(host.querySelector("#who")!.textContent).toBe("connected");
    await act(async () => handlers[0]!(["0x" + "1".repeat(40)]));
    expect(host.querySelector("#who")!.textContent).toBe("none");
    expect(host.textContent).toContain("Connect wallet");
    await act(async () => root.unmount());
  });

  it("QA-14: a disconnect (no accounts) resets too", async () => {
    const root = createRoot(host);
    await act(async () => root.render(h(Harness, { initial: eoa })));
    await act(async () => handlers[0]!([]));
    expect(host.querySelector("#who")!.textContent).toBe("none");
    await act(async () => root.unmount());
  });

  it("A11Y-3: after connecting, focus is on Refresh, not on <body>", async () => {
    const root = createRoot(host);
    await act(async () => root.render(h(Harness)));
    const connect = [...host.querySelectorAll("button")].find((b) => b.textContent === "Connect wallet")!;
    await act(async () => connect.click());
    expect(host.querySelector("#who")!.textContent).toBe("connected");
    expect(document.activeElement?.textContent).toBe("Refresh");
    await act(async () => root.unmount());
  });
});
