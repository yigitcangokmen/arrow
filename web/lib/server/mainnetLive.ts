// The network badge may say "Live on NEAR mainnet" only when the mainnet market contract answers a view call; a flag alone is not
// enough, because CONTRACTS.mainnet has a default name whether or not anything is deployed there.
import { ArrowViews } from "@arrow/sdk/contract";
import { CONTRACTS } from "../config.ts";
import { ttlCache } from "./listingsCache.ts";

const cached = ttlCache<boolean>(300_000, Date.now, 1);

/** True when `get_config` on the mainnet contract answers within 2.5 s. Cached for five minutes, failures included. */
export function mainnetContractLive(check: () => Promise<unknown> = () => new ArrowViews("mainnet", CONTRACTS.mainnet).config()): Promise<boolean> {
  return cached("mainnet", () =>
    Promise.race([
      check().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]).catch(() => false),
  );
}
