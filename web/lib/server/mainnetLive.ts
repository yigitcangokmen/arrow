// The network badge may say "Live on NEAR mainnet" only when the mainnet market contract answers a view call; a flag alone is not
// enough, because CONTRACTS.mainnet has a default name whether or not anything is deployed there.
import { ArrowViews } from "@arrow/sdk/contract";
import { CONTRACTS } from "../config.ts";
import { ttlCache } from "./listingsCache.ts";

// A success is kept for five minutes; a failure only for 15 s, so one slow RPC answer on a cold instance does not pin
// "Mainnet not live" on the badge for five minutes (QA-10), and a dead RPC is still asked at most every 15 s.
const cached = ttlCache<true>(300_000, () => Date.now(), 1, { failTtlMs: 15_000 });

/** True when `get_config` on the mainnet contract answers within 2.5 s. Successes are cached for five minutes, failures for 15 s. */
export function mainnetContractLive(check: () => Promise<unknown> = () => new ArrowViews("mainnet", CONTRACTS.mainnet).config()): Promise<boolean> {
  return cached("mainnet", () =>
    Promise.race([
      check().then(() => true as const),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("get_config took over 2.5 s")), 2500)),
    ]),
  ).catch(() => false);
}
