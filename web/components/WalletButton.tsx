"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { intentsUsdcBalance } from "../lib/balance.ts";
import { formatUsdc } from "../lib/format.ts";
import { connectEoa, type Eoa, NoWalletError, NotEoaError, watchAccounts } from "../lib/wallet.ts";
import styles from "./form.module.css";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Connect button; once connected shows the address and the Intents USDC balance. `refreshKey` re-reads the balance when it
 * changes (after a top-up or a withdrawal). `onReset` is called when the wallet switches or drops the account, so the page can
 * forget the old address, balance and keys.
 */
export function WalletButton({ eoa, balance, onConnect, onBalance, onReset, refreshKey = 0 }: {
  eoa: Eoa | null;
  balance: bigint | null;
  onConnect(e: Eoa): void;
  onBalance(b: bigint | null): void;
  onReset?(): void;
  refreshKey?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const justConnected = useRef(false);

  const refresh = useCallback(async (e: Eoa) => {
    onBalance(null);
    try {
      onBalance(await intentsUsdcBalance(e.intentsId));
    } catch {
      setError("Could not read your NEAR Intents balance. Check the connection and reload.");
    }
  }, [onBalance]);

  useEffect(() => {
    if (eoa) void refresh(eoa);
  }, [eoa, refresh, refreshKey]);

  useEffect(() => {
    if (!eoa) return;
    return watchAccounts((next) => {
      if (next !== eoa.intentsId) onReset?.();
    });
  }, [eoa, onReset]);

  useEffect(() => {
    if (eoa && justConnected.current) {
      justConnected.current = false;
      refreshButton.current?.focus(); // the Connect button that had focus is gone
    }
  }, [eoa]);

  if (eoa) {
    return (
      <p>
        Connected <span className="mono" title={eoa.address}>{short(eoa.address)}</span>
        {" · "}Intents USDC balance: <strong>{balance === null ? "loading" : `${formatUsdc(balance)} USDC`}</strong>{" "}
        <button type="button" ref={refreshButton} onClick={() => void refresh(eoa)}>Refresh</button>
        {error ? <span className={styles.error}> {error}</span> : null}
      </p>
    );
  }
  return (
    <div>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const e = await connectEoa();
            justConnected.current = true;
            onConnect(e);
          } catch (e) {
            setError(
              e instanceof NoWalletError || e instanceof NotEoaError
                ? e.message
                : "The wallet did not connect. Approve the request in your wallet and try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Waiting for your wallet…" : "Connect wallet"}
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
