import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // intents-sdk imports "near-api-js/lib/utils/serialize" without an extension; Node's ESM loader rejects that,
    // so vite must resolve it.
    server: { deps: { inline: [/@defuse-protocol\//] } },
  },
});
