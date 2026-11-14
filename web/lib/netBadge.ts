// The network badge (components/NetBadge.tsx): one component, two states.
import type { Network } from "./config.ts";
import { pinnedNetwork } from "./links.ts";

export type NetBadgeState = "mainnet" | "testnet";

/**
 * MAINNET only when the viewed network is mainnet and the mainnet contract answered a view call. The free try pages always run on
 * testnet, so they always show TESTNET; the recorded run (/try/recorded) replays a mainnet run, so it reads as mainnet.
 */
export function netBadgeState(net: Network, mainnetLive: boolean, pathname: string): NetBadgeState {
  return (pinnedNetwork(pathname) ?? net) === "mainnet" && mainnetLive ? "mainnet" : "testnet";
}

/** The pill's words: "Testnet", or "Live on NEAR mainnet", or, when mainnet is viewed but not deployed, "Mainnet not live". */
export function netBadgeText(state: NetBadgeState, net: Network, pathname: string): string {
  if (state === "mainnet") return "Live on NEAR mainnet";
  return (pinnedNetwork(pathname) ?? net) === "mainnet" ? "Mainnet not live" : "Testnet";
}
