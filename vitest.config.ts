import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // intents-sdk imports "near-api-js/lib/utils/serialize" without an extension; Node's ESM loader rejects that,
    // so vite must resolve it.
    server: { deps: { inline: [/@defuse-protocol\//] } },
    // The ECIES-heavy cases (secp256k1 in pure JS) take 3-14 s on a loaded machine; the 5 s default makes them flaky.
    testTimeout: 20_000,
  },
});
