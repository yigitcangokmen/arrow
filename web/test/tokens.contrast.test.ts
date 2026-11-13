// A11Y-4: the edge of a form field must reach 3:1 against what it sits on (WCAG 1.4.11); text tokens keep 4.5:1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/tokens.css", import.meta.url), "utf8");

/** The declarations of the light block (:root), the explicit dark block and the system-dark block. */
function tokens(block: "light" | "dark"): Record<string, string> {
  const re = block === "light" ? /^:root \{([^}]*)\}/m : /^:root\[data-theme="dark"\] \{([^}]*)\}/m;
  const body = re.exec(css)?.[1] ?? "";
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  const t = tokens(theme);
  it("form field edges are 3:1 against the page and against the panel", () => {
    expect(t["control-border"], "--control-border is defined").toBeDefined();
    expect(contrast(t["control-border"]!, t.bg!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t["control-border"]!, t.surface!)).toBeGreaterThanOrEqual(3);
  });
  it("text tokens stay at 4.5:1 on both backgrounds", () => {
    for (const k of ["text", "muted", "accent", "proven", "notproven", "risky", "danger"]) {
      for (const bg of ["bg", "surface"]) expect(contrast(t[k]!, t[bg]!), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the dark band, the filled button and the sunken panels keep 4.5:1", () => {
    for (const [fg, bg] of [["ink-text", "ink"], ["ink-muted", "ink"], ["accent-ink", "accent"], ["text", "sunken"], ["muted", "sunken"], ["proven", "sunken"], ["notproven", "sunken"]]) {
      expect(t[fg], `--${fg} is defined`).toBeDefined();
      expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it("the system-dark media block carries the same control border as the explicit dark theme", () => {
  const media = /@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/.exec(css)?.[0] ?? "";
  expect(media).toContain(`--control-border: ${tokens("dark")["control-border"]}`);
});

it("form fields use the control border, not the decorative one", () => {
  const form = readFileSync(new URL("../components/form.module.css", import.meta.url), "utf8");
  expect(/\.field input[^{]*\{[^}]*border: 1px solid var\(--control-border\)/.test(form)).toBe(true);
});
