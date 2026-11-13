import Link from "next/link";
import type { Metadata } from "next";
import { parseNetwork } from "../../lib/config.ts";
import { Note, PageHead } from "../../components/Section.tsx";
import { SellerPanel } from "./SellerPanel.tsx";

export const metadata: Metadata = { title: "Payouts" };

export default async function Seller({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  return (
    <div data-ready="true">
      <PageHead eyebrow="Payouts" title="Your payouts.">
        Withdraw what buyers paid you to a Solana wallet, as USDC. How it works: sales and inspection fees land on the payout account you
        set when you listed (your own 0x address when you set none) inside NEAR Intents, a USDC balance held for your wallet on NEAR.
        This page withdraws that balance for the wallet you connect; NEAR Intents&apos; 1Click service moves the funds to Solana.
      </PageHead>
      {net === "testnet" ? (
        <Note>
          <b>Read-only on testnet.</b> Payouts run on mainnet, which is not deployed yet. To watch the buyer and seller flow for free,{" "}
          <Link href="/try">try it on testnet</Link>.
        </Note>
      ) : null}
      <SellerPanel network={net} readOnly={net !== "mainnet"} />
    </div>
  );
}
