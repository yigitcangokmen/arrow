"use client";
import { useCallback, useEffect, useState } from "react";
import { intentsUsdcBalance } from "../lib/balance.ts";
import { formatUsdc } from "../lib/format.ts";
import { connectEoa, type Eoa, NoWalletError } from "../lib/wallet.ts";
import styles from "./form.module.css";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Connect button; once connected shows the address and the Intents USDC balance. `onChange` gets the wallet and balance. */
export function WalletButton({ eoa, balance, onConnect, onBalance }: {
  eoa: Eoa | null;
  balance: bigint | null;
  onConnect(e: Eoa): void;
  onBalance(b: bigint | null): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  }, [eoa, refresh]);

  if (eoa) {
    return (
      <p>
        Connected <span className="mono" title={eoa.address}>{short(eoa.address)}</span>
        {" · "}Intents USDC balance: <strong>{balance === null ? "loading" : `${formatUsdc(balance)} USDC`}</strong>{" "}
        <button type="button" onClick={() => void refresh(eoa)}>Refresh</button>
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
            onConnect(await connectEoa());
          } catch (e) {
            setError(e instanceof NoWalletError ? e.message : "The wallet did not connect. Approve the request in your wallet and try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Connect wallet
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
