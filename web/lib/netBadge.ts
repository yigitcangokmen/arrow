// The network badge (components/NetBadge.tsx): one component, two states.
import type { Network } from "./config.ts";

export type NetBadgeState = "mainnet" | "testnet";

/**
 * MAINNET only when the viewed network is mainnet and the mainnet contract answered a view call. The free try pages always run on
 * testnet, so they always show TESTNET.
 */
export function netBadgeState(net: Network, mainnetLive: boolean, pathname: string): NetBadgeState {
  if (pathname === "/try" || pathname.startsWith("/try/")) return "testnet";
  return net === "mainnet" && mainnetLive ? "mainnet" : "testnet";
}

/** The pill's words: "Testnet", or "Live on NEAR mainnet", or, when mainnet is viewed but not deployed, "Mainnet not live". */
export function netBadgeText(state: NetBadgeState, net: Network, pathname: string): string {
  if (state === "mainnet") return "Live on NEAR mainnet";
  return net === "mainnet" && !(pathname === "/try" || pathname.startsWith("/try/")) ? "Mainnet not live" : "Testnet";
}
