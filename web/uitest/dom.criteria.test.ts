// @vitest-environment happy-dom
// QA-05 / X12-U4 in the real form: the buyer's own list is hashed on the key column, and again whenever the column changes; a
// list that has no such column gives a message and no signature instead of hashing whole CSV lines.
import { createElement as h, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CriteriaForm } from "../app/buy/[id]/CriteriaForm.tsx";
import { EMPTY_CRITERIA, type CriteriaFormState } from "../lib/buy.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest: CriteriaFormState = EMPTY_CRITERIA;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  latest = EMPTY_CRITERIA;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness() {
  const [v, setV] = useState(EMPTY_CRITERIA);
  latest = v;
  return h(CriteriaForm, { columns: ["wallet", "label"], value: v, onChange: setV });
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const setValue = async (el: HTMLElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};

describe("buyer's own list", () => {
  it("the list inputs are off until a key column is chosen", async () => {
    await act(async () => root.render(h(Harness)));
    expect((host.querySelector("#own-paste") as HTMLTextAreaElement).disabled).toBe(true);
    expect((host.querySelector("#own-file") as HTMLInputElement).disabled).toBe(true);
  });

  it("the signature follows the key column: choosing another column after pasting hashes the new column", async () => {
    await act(async () => root.render(h(Harness)));
    await setValue(host.querySelector("#key-col")!, "wallet");
    const paste = host.querySelector("#own-paste") as HTMLTextAreaElement;
    await setValue(paste, "wallet,label\na,b\nc,d\n");
    await act(async () => paste.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await settle();
    const first = latest.minhash;
    expect(first).toMatch(/^[0-9a-f]{2048}$/);
    await setValue(host.querySelector("#key-col")!, "label");
    await settle();
    expect(latest.minhash).toMatch(/^[0-9a-f]{2048}$/);
    expect(latest.minhash).not.toBe(first);
    expect(host.textContent).toContain("2 keys turned into 128 numbers");
  });

  it("a list without the chosen column gives a message and no signature, never whole-line hashing", async () => {
    await act(async () => root.render(h(Harness)));
    await setValue(host.querySelector("#key-col")!, "label");
    const paste = host.querySelector("#own-paste") as HTMLTextAreaElement;
    await setValue(paste, "addr,x\n0xA,1\n");
    await act(async () => paste.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await settle();
    expect(latest.minhash).toBe("");
    expect(host.textContent).toContain('Your list has no column "label"');
  });
});
