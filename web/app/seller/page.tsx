import Link from "next/link";
import { parseNetwork } from "../../lib/config.ts";
import form from "../../components/form.module.css";
import { SellerPanel } from "./SellerPanel.tsx";
import styles from "./seller.module.css";

export default async function Seller({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  return (
    <div data-ready="true">
      <h1>Payouts</h1>
      <p className={styles.lead}>
        Sales and inspection fees land on your NEAR Intents account, the same 0x address you listed with. Withdraw them to USDC on
        Solana here; 1Click moves the funds.
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
