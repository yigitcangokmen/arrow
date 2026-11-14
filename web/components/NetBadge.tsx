"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { CONTRACTS, type Network } from "../lib/config.ts";
import { addressUrl, pinnedNetwork, shortHash, TRUST_PATH, txUrl, withNetwork } from "../lib/links.ts";
import { netBadgeState, netBadgeText } from "../lib/netBadge.ts";
import styles from "./NetBadge.module.css";

/**
 * The network badge: a <details> pill with a small panel, no inline handlers. TESTNET (amber dot) on testnet and always on the free try pages;
 * MAINNET (green dot, "Live on NEAR mainnet") only when the mainnet contract answered a server-side view call. When the evidence file also
 * holds the lock tx, the pill says "Locked on mainnet: 0 access keys, not even ours" on wide screens and shortens to "Live on NEAR mainnet ·
 * Locked", "Mainnet · Locked" and then "Locked" on narrower ones so the nav still fits.
 * The dot never pulses. Closes on Escape and on a tap outside.
 */
export function NetBadge({ net, mainnetLive, pathname, lockTx = null }: { net: Network; mainnetLive: boolean; pathname: string; lockTx?: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const state = netBadgeState(net, mainnetLive, pathname);
  const locked = state === "mainnet" && lockTx !== null;
  const shown: Network = state === "mainnet" ? "mainnet" : (pinnedNetwork(pathname) ?? net);
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
      ? `Live on NEAR mainnet${locked ? ". Locked: 0 access keys, not even ours" : ""}. Open for details.`
      : shown === "mainnet"
        ? "NEAR mainnet: the market is not deployed there yet. Open for details."
        : "NEAR testnet. Synthetic data, test money only. The market is live and locked on mainnet. Open for details.";
  return (
    <details ref={ref} className={styles.net} data-state={state} data-locked={locked ? "" : undefined}>
      <summary aria-label={label}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>
          {locked ? (
            <>
              <span className={styles.full}>Locked on mainnet: 0 access keys, not even ours</span>
              <span className={styles.short}>
                <span className={styles.wide}>Live on NEAR </span>
                <span className={styles.mid}>mainnet · </span>Locked
              </span>
            </>
          ) : (
            netBadgeText(state, net, pathname)
          )}
        </span>
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
          {locked ? (
            <>
              <dt>Lock</dt>
              <dd>
                <a href={txUrl("near", "mainnet", lockTx!)} target="_blank" rel="noopener noreferrer">{shortHash(lockTx!)}<span className="sr-only"> (lock transaction, opens in a new tab)</span></a>
              </dd>
            </>
          ) : null}
        </dl>
        {state === "mainnet" ? (
          <p>{locked ? "Locked: the contract has no access keys, not even ours. " : null}Refunds go to your Intents balance.</p>
        ) : shown === "mainnet" ? (
          <p>The market contract is not deployed on mainnet yet. The demo runs on testnet.</p>
        ) : (
          <p>Synthetic demo data. The market is live on mainnet and locked: its contract has no access keys, so the team cannot change it.</p>
        )}
        <p className={styles.acts}>
          {state === "mainnet" ? (
            <Link href={withNetwork("/verify", "mainnet")} onClick={close}>Verify</Link>
          ) : (
            <Link href={withNetwork("/listings", "mainnet")} onClick={close}>See the listings</Link>
          )}
          <Link href={TRUST_PATH} onClick={close}>Who sees what →</Link>
        </p>
      </div>
    </details>
  );
}
