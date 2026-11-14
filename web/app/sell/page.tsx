import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import type { Metadata } from "next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { RefreshSoon } from "../../components/RefreshSoon.tsx";
import { RECORDED_RUN_PATH } from "../../lib/links.ts";
import { rpcBusy } from "../../lib/rpcBusy.ts";
import { teamAccounts } from "../../generated/data.ts";
import { CONTRACTS, parseNetwork } from "../../lib/config.ts";
import { formatUsdc } from "../../lib/format.ts";
import { sellerConfig } from "../../lib/server/config.ts";
import { SellForm } from "./SellForm.tsx";
import styles from "./sell.module.css";
import { Note, PageHead } from "../../components/Section.tsx";

export const metadata: Metadata = { title: "Sell data" };

export default async function Sell({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  let cfg: Awaited<ReturnType<typeof sellerConfig>> | null = null;
  let failure: string | null = null;
  try {
    cfg = await sellerConfig(new ArrowViews(net, CONTRACTS[net]));
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }
  return (
    <div data-ready="true">
      <PageHead eyebrow="Sellers" title="Sell data.">
        Your browser encrypts the file; an AI in sealed hardware reads a 40-row sample; buyers get a verdict, not rows.
      </PageHead>
      {net === "testnet" ? (
        <Note>
          <p><b>Read-only on testnet.</b> Listing with real payouts needs mainnet, where the market is live and locked: its contract has no access keys, so the team cannot change it.</p>
          <p className={styles.noteAction}><Link className={styles.demo} href="/try">Run the demo, free</Link></p>
        </Note>
      ) : null}
      <details className={styles.need}>
        <summary>What you need to list, and who holds the key</summary>
        <p>
          Your file is encrypted in this tab before anything is uploaded. Buyers pay you to have an AI inspect it, and pay you again when they
          buy. Only the encrypted file is uploaded, and its key is sealed to Arrow&apos;s enclave program, which releases it to a buyer who pays;
          the two exceptions are in <Link href="/trust">who sees what</Link>. To list you need an Ethereum-style wallet (such as MetaMask) and{" "}
          {cfg ? formatUsdc(BigInt(cfg.bond)) : "the listing bond in"} USDC for the listing bond, in a NEAR Intents balance (a USDC balance held
          for your wallet on NEAR, topped up from Base); no NEAR account. The AI that inspects for buyers reads a 40-row sample.
        </p>
      </details>
      {failure && rpcBusy(failure) ? (
        <EmptyState title={`NEAR ${net} is busy right now.`}>
          <p>The market settings are read again in a minute. Meanwhile: <Link href={RECORDED_RUN_PATH}>watch a recorded run</Link>.</p>
          <RefreshSoon key={Date.now()} seconds={60} />
        </EmptyState>
      ) : failure || !cfg ? (
        <ErrorBox title={`Could not read the market contract on ${net}`} fallback="Reload in a minute, or use the CLI: npm run arrow -- list --help">
          <p className="mono">{failure}</p>
        </ErrorBox>
      ) : (
        <SellForm
          network={net}
          programPk={cfg.programPk}
          bond={cfg.bond}
          limits={cfg.limits}
          maxEvalsCap={cfg.maxEvalsCap}
          readOnly={net !== "mainnet"}
          teamAccounts={teamAccounts}
          feeBps={cfg.feeBps}
        />
      )}
    </div>
  );
}
