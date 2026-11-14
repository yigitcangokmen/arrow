"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { CONTRACTS, type Network } from "../lib/config.ts";
import { addressUrl, TRUST_PATH, withNetwork } from "../lib/links.ts";
import { netBadgeState, netBadgeText } from "../lib/netBadge.ts";
import styles from "./NetBadge.module.css";

/**
 * The network badge: a <details> pill with a small panel, no inline handlers. TESTNET (amber dot) today and always on the try pages;
 * MAINNET (green dot, "Live on NEAR mainnet") only when the mainnet contract answered a server-side view call. The dot never pulses.
 * Closes on Escape and on a tap outside.
 */
export function NetBadge({ net, mainnetLive, pathname }: { net: Network; mainnetLive: boolean; pathname: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const state = netBadgeState(net, mainnetLive, pathname);
  const shown: Network = state === "mainnet" ? "mainnet" : pathname.startsWith("/try") ? "testnet" : net;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key !== "Escape" || !d?.open) return;
      d.open = false;
      d.querySelector("summary")?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  const label =
    state === "mainnet"
      ? "Live on NEAR mainnet. Open for details."
      : shown === "mainnet"
        ? "NEAR mainnet: the market is not deployed there yet. Open for details."
        : "NEAR testnet. Synthetic data, test money only. The market is live on mainnet, not locked yet. Open for details.";
  return (
    <details ref={ref} className={styles.net} data-state={state}>
      <summary aria-label={label}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>{netBadgeText(state, net, pathname)}</span>
      </summary>
      <div className={styles.panel}>
        <dl>
          <dt>Network</dt>
          <dd>NEAR {shown}</dd>
          <dt>Contract</dt>
          <dd>
            {state === "mainnet" || shown === "testnet" ? (
              <a href={addressUrl(CONTRACTS[shown], shown)} target="_blank" rel="noopener noreferrer">{CONTRACTS[shown]}<span className="sr-only"> (opens in a new tab)</span></a>
            ) : (
              CONTRACTS[shown]
            )}
          </dd>
          <dt>Money</dt>
          <dd>{state === "mainnet" ? "USDC via NEAR Intents" : "test USDC only"}</dd>
        </dl>
        {state === "mainnet" ? (
          <p>Refunds go to your Intents balance.</p>
        ) : shown === "mainnet" ? (
          <p>The market contract is not deployed on mainnet yet. The demo runs on testnet.</p>
        ) : (
          <p>Synthetic demo data. The market is live on mainnet; not locked yet, so the team can still change it.</p>
        )}
        <p className={styles.acts}>
          {state === "mainnet" ? (
            <Link href={withNetwork("/verify", "mainnet")} onClick={close}>Verify</Link>
          ) : (
            <Link href="/try" onClick={close}>Run the demo, free</Link>
          )}
          <Link href={TRUST_PATH} onClick={close}>Who sees what →</Link>
        </p>
      </div>
    </details>
  );
}
