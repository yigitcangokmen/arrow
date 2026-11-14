import type { Metadata } from "next";
import Link from "next/link";
import { isTeamAccount } from "@arrow/sdk/team";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { ListingCard } from "../../components/ListingCard.tsx";
import { PageHead } from "../../components/Section.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { teamAccounts } from "../../generated/data.ts";
import { CONTRACTS, parseNetwork } from "../../lib/config.ts";
import { devState } from "../../lib/devState.ts";
import { RECORDED_RUN_PATH, withNetwork } from "../../lib/links.ts";
import { rpcBusy } from "../../lib/rpcBusy.ts";
import { lastGoodListings, loadListingViews } from "../../lib/server/listingsPage.ts";
import type { ListingView } from "../../lib/server/listingsCache.ts";
import styles from "./listings.module.css";

export const metadata: Metadata = { title: "Listings" };

/**
 * Every listing on the market, newest first, for buyers and sellers alike: the home page shows only the team's featured pair. Each card
 * links to its listing page; a seller coming from /sell lands on `#l-<id>`, which outlines their card. Nothing is hidden: stale and
 * outside listings keep the labels ListingCard gives them.
 */
export default async function Listings({ searchParams }: { searchParams: Promise<{ network?: string; state?: string }> }) {
  const sp = await searchParams;
  const net = parseNetwork(sp.network);
  const forced = devState(new URLSearchParams(sp.state ? { state: sp.state } : {}));

  let listings: ListingView[] = [];
  let failure: string | null = forced === "error" ? "Forced error state (development only)." : null;
  // While the public RPC is busy, the last listings this server read stand in, with the time they were read.
  let readAt: number | null = null;
  if (!failure && forced !== "loading" && forced !== "empty") {
    try {
      listings = await loadListingViews(net, teamAccounts);
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
      const last = rpcBusy(failure) ? lastGoodListings(net) : null;
      if (last) {
        listings = last.views;
        readAt = last.at;
        failure = null;
      }
    }
  }
  const sorted = [...listings].sort((a, b) => Number(b.id) - Number(a.id));
  const outside = sorted.filter((l) => !isTeamAccount(l.seller, teamAccounts)).length;

  return (
    <div data-ready="true">
      <PageHead eyebrow="Listings" title={`Listings on ${net}.`}>
        {sorted.length > 0 ? (
          <>
            {sorted.length} {sorted.length === 1 ? "dataset" : "datasets"} on <span className="mono">{CONTRACTS[net]}</span>, newest first.{" "}
            {outside === 0 ? "All of them so far are the team's own synthetic test files." : `${outside} from outside sellers.`} Open one to inspect it before you pay.
          </>
        ) : (
          <>Read from <span className="mono">{CONTRACTS[net]}</span>.</>
        )}
      </PageHead>
      {forced === "loading" ? (
        <div className={styles.grid}>
          <Skeleton height={260} />
          <Skeleton height={260} />
          <Skeleton height={260} />
        </div>
      ) : failure && rpcBusy(failure) ? (
        <EmptyState title={`NEAR ${net} is busy right now.`}>
          <p>The listings are back in a minute. Meanwhile: <Link href={RECORDED_RUN_PATH}>watch a recorded run</Link>.</p>
        </EmptyState>
      ) : failure && /CodeDoesNotExist|does not exist/i.test(failure) ? (
        <EmptyState title={`No market on ${net} yet.`}>
          <p>The demo listings live on testnet: <Link href={withNetwork("/listings", "testnet")}>see them</Link>.</p>
        </EmptyState>
      ) : failure ? (
        <ErrorBox title={`Could not read the listings on ${net}`} fallback="Check the contract on the explorer, or try the other network with ?network=testnet or ?network=mainnet.">
          <p className="mono">{failure}</p>
        </ErrorBox>
      ) : sorted.length === 0 ? (
        <EmptyState title={`No listings on ${net} yet.`}>
          <Link href={withNetwork("/sell", net)}>List a dataset</Link>
        </EmptyState>
      ) : (
        <>
          {readAt !== null ? (
            <p className={styles.stale} role="status">
              Last read from the chain at {new Date(readAt).toISOString().slice(11, 16)} UTC; NEAR {net} is busy right now.
            </p>
          ) : null}
          <ul className={styles.grid} aria-label="Listings">
            {sorted.map((l) => (
              <li key={String(l.id)} id={`l-${String(l.id)}`}>
                <ListingCard listing={l} network={net} team={isTeamAccount(l.seller, teamAccounts)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
