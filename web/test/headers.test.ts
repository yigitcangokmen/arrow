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
