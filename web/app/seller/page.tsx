import Link from "next/link";
import type { Metadata } from "next";
import { parseNetwork } from "../../lib/config.ts";
import form from "../../components/form.module.css";
import { SellerPanel } from "./SellerPanel.tsx";
import styles from "./seller.module.css";

export const metadata: Metadata = { title: "Payouts" };

export default async function Seller({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  return (
    <div data-ready="true">
      <h1>Payouts</h1>
      <p className={styles.lead}>
        Sales and inspection fees land on the payout account you set when you listed (your own 0x address when you set none), inside
        NEAR Intents. This page withdraws the Intents balance of the wallet you connect to USDC on Solana; 1Click moves the funds.
      </p>
      {net === "testnet" ? (
        <div className={form.band} role="note">
          Payments run on mainnet; use <Link href="/try">/try</Link> for the free testnet flow. This page is read-only on testnet.
        </div>
      ) : null}
      <SellerPanel network={net} readOnly={net !== "mainnet"} />
    </div>
  );
}
