import type { NextConfig } from "next";

const config: NextConfig = {
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
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
