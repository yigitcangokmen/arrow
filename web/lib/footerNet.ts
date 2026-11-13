// The footer's network words follow the page being viewed, like the badge (QA-14): /try and ?network=testnet are testnet even
// on the mainnet site, so the footer never says "NEAR mainnet" under a TESTNET pill.
import { type Network, parseNetwork } from "./config.ts";

/** The network a page shows: the try pages are always testnet; elsewhere ?network= or the deploy's default. */
export function viewedNetwork(pathname: string, networkParam: string | null | undefined): Network {
  return pathname === "/try" || pathname.startsWith("/try/") ? "testnet" : parseNetwork(networkParam);
}

/** The footer's network line for that network; `live` is the same server-side view call the badge uses. */
export function footerNetText(viewed: Network, live: boolean): string {
  if (viewed === "testnet") return `NEAR testnet · synthetic demo data · ${live ? "mainnet contract deployed" : "mainnet not deployed"}`;
  return live ? "NEAR mainnet" : "NEAR mainnet · market not deployed yet";
}
