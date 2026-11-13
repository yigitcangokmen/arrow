import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowViews } from "@arrow/sdk/contract";
import type { Listing } from "@arrow/sdk/schemas";
import type { Metadata } from "next";
import { EmptyState } from "../../../components/EmptyState.tsx";
import { ErrorBox } from "../../../components/ErrorBox.tsx";
import { RefreshSoon } from "../../../components/RefreshSoon.tsx";
import { isTeamAccount } from "@arrow/sdk/team";
import { teamAccounts } from "../../../generated/data.ts";
import { blockersFor, marketStateFrom } from "../../../lib/blockers.ts";
import { CONTRACTS, parseNetwork } from "../../../lib/config.ts";
import { toListingView } from "../../../lib/server/listingsCache.ts";
import { OpenOnHash } from "../../../components/OpenOnHash.tsx";
import { Note } from "../../../components/Section.tsx";
import { RECORDED_RUN_PATH, withNetwork } from "../../../lib/links.ts";
import { rpcBusy } from "../../../lib/rpcBusy.ts";
import styles from "./buy.module.css";
import { BuyFlow } from "./BuyFlow.tsx";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Listing ${id}` };
}

export default async function BuyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ network?: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const net = parseNetwork((await searchParams).network);
  const views = new ArrowViews(net, CONTRACTS[net]);

  let listing: Listing | null = null;
  let programPk: string | null = null;
  let config: Awaited<ReturnType<ArrowViews["config"]>> | null = null;
  let failure: string | null = null;
  try {
    [listing, programPk, config] = await Promise.all([views.listing(id), views.programPubkey(), views.config()]);
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }
  if (!failure && !listing) notFound();

  return (
    <div data-ready="true">
      <Link href={`${withNetwork("/", net)}#listings`} className={styles.back}>← All listings</Link>
      {net === "testnet" ? (
        <Note>
          <p><b>Real purchases need mainnet, which is not deployed yet.</b> The free demo runs the same steps on testnet.</p>
          <p className={styles.noteAction}><Link className={styles.demo} href="/try">Run the demo, free</Link></p>
        </Note>
      ) : null}
      {failure || !listing ? (
        <>
          <h1>Listing #{id}</h1>
          {failure && rpcBusy(failure) ? (
            <EmptyState title={`NEAR ${net} is busy right now.`}>
              <p>This listing is read again in a minute. Meanwhile: <Link href={RECORDED_RUN_PATH}>watch a recorded run</Link>.</p>
              <RefreshSoon key={Date.now()} seconds={60} />
            </EmptyState>
          ) : failure && /CodeDoesNotExist/.test(failure) ? (
            <ErrorBox title={`The ${net} market is not deployed yet`} fallback={`The demo listings live on testnet: ${withNetwork(`/buy/${id}`, "testnet")}`}>
              <p>There is no market contract on {net} yet, so this listing cannot exist there.</p>
              <details><summary>The error</summary><p className="mono">{failure}</p></details>
            </ErrorBox>
          ) : (
            <ErrorBox title={`Could not read listing ${id} on ${net}`} fallback="Reload in a minute, or inspect it from the CLI: npm run arrow -- eval --help">
              <p className="mono">{failure}</p>
            </ErrorBox>
          )}
        </>
      ) : (
        <BuyFlow
          network={net}
          listing={toListingView(listing, teamAccounts)}
          programPk={programPk}
          readOnly={net !== "mainnet"}
          team={isTeamAccount(listing.seller, teamAccounts)}
          blockers={{
            inspect: blockersFor("eval", marketStateFrom(config!, programPk), listing).map((b) => b.message),
            buy: blockersFor("buy", marketStateFrom(config!, programPk), listing).map((b) => b.message),
          }}
        />
      )}
      <OpenOnHash id="agents" />
    </div>
  );
}
