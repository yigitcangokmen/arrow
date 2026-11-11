import { describe, expect, it } from "vitest";
import config from "../next.config.ts";

describe("WEB-8: response headers", () => {
  it("every route forbids framing and plugin content, and the server does not announce Next.js", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/(.*)")!;
    const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).toContain("base-uri 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(config.poweredByHeader).toBe(false);
  });
});

describe("WEB-8: script-src", () => {
  it("every page response carries a fresh nonce, strict-dynamic, and no unsafe-inline or unsafe-eval in script-src", async () => {
    const { proxy } = await import("../proxy.ts");
    const { NextRequest } = await import("next/server.js");
    const a = proxy(new NextRequest("https://arrow.test/buy/1")).headers.get("Content-Security-Policy")!;
    const b = proxy(new NextRequest("https://arrow.test/buy/1")).headers.get("Content-Security-Policy")!;
    const scriptSrc = (p: string) => p.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc(a)).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'$/);
    expect(scriptSrc(a)).not.toBe(scriptSrc(b));
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "connect-src 'self' https:"]) expect(a).toContain(d);
  });
});
