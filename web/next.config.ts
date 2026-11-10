import type { NextConfig } from "next";

// No page may be framed (a framed /seller or /buy is a clickjacking target for a wallet prompt), no plugin content, no <base> rewrite,
// forms post only to this site. A script-src needs a nonce setup that has to be checked in a real browser, so it is not set here.
const CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@arrow/sdk"],
  async rewrites() {
    return [{ source: "/l/:id/data", destination: "/api/x402/:id" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
