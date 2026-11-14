import Link from "next/link";
import type { Metadata } from "next";
import { parseNetwork } from "../../lib/config.ts";
import { Note, PageHead } from "../../components/Section.tsx";
import { SellerPanel } from "./SellerPanel.tsx";
import styles from "./seller.module.css";

export const metadata: Metadata = { title: "Payouts" };

export default async function Seller({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  return (
    <div data-ready="true">
      <PageHead eyebrow="Sellers" title="Payouts.">
        Sales land on the payout account you set when you listed; withdraw them here to a Solana wallet.
      </PageHead>
      {net === "testnet" ? (
        <Note>
          <b>Read-only on testnet.</b> Payouts run on mainnet, where the market is live; it is not locked yet, so the team can still change it. <Link href="/try">Run the demo, free</Link>.
        </Note>
      ) : null}
      <details className={styles.how}>
        <summary>How payouts work</summary>
        <p>
          Sales and inspection fees land on the payout account you set when you listed (your own 0x address when you set none) inside NEAR
          Intents, a USDC balance held for your wallet on NEAR. This page withdraws that balance for the wallet you connect, as USDC to a
          Solana wallet; NEAR Intents&apos; 1Click service moves the funds to Solana.
        </p>
      </details>
      <SellerPanel network={net} readOnly={net !== "mainnet"} />
    </div>
  );
}
