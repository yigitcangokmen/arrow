import Link from "next/link";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ListingCard } from "../components/ListingCard.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { TrustTable } from "../components/TrustTable.tsx";
import { teamAccounts } from "../generated/data.ts";
import { CONTRACTS, parseNetwork } from "../lib/config.ts";
import { devState } from "../lib/devState.ts";
import { withNetwork } from "../lib/links.ts";
import { loadListingViews } from "../lib/server/listingsPage.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";
import styles from "./page.module.css";

export default async function Home({ searchParams }: { searchParams: Promise<{ network?: string; state?: string }> }) {
  const sp = await searchParams;
  const net = parseNetwork(sp.network);
  const forced = devState(new URLSearchParams(sp.state ? { state: sp.state } : {}));

  let listings: ListingView[] = [];
  let failure: string | null = forced === "error" ? "Forced error state (development only)." : null;
  if (!failure && forced !== "loading" && forced !== "empty") {
    try {
      listings = await loadListingViews(net, teamAccounts);
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    }
  }

  return (
    <div data-ready="true">
      <section className={styles.hero}>
        <h1>Inspect before you pay.</h1>
        <p className={styles.lead}>
          The buyer&apos;s AI reads the sealed data inside a TEE, and only a capped verdict (≤5.67 bits) comes back to the buyer.
        </p>
        <p className={styles.sub}>
          Sellers list encrypted data. Buyers pay a small inspection fee to let their own AI inspect it inside an Intel TDX
          enclave. Only BUY/PASS (and optionally fit/novelty) comes out.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primary} href="/sell">Sell data</Link>
          <Link className={styles.secondary} href="/try">Try it free on testnet</Link>
        </div>
      </section>

      <section id="listings" className={styles.listings} aria-labelledby="listings-title">
        <h2 id="listings-title">Listings on {net}</h2>
        <p className={styles.note}>Contract <span className="mono">{CONTRACTS[net]}</span></p>
        {forced === "loading" ? (
          <div className={styles.grid}>
            <Skeleton height={220} />
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
        ) : failure ? (
          <ErrorBox title={`Could not read the listings on ${net}`} fallback="Check the contract on the explorer, or try the other network with ?network=testnet or ?network=mainnet.">
            <p className="mono">{failure}</p>
          </ErrorBox>
        ) : listings.length === 0 ? (
          <EmptyState title={`No listings on ${net} yet.`}>
            <Link href={withNetwork("/sell", net)}>List a dataset</Link>
          </EmptyState>
        ) : (
          <div className={styles.grid}>
            {listings.map((l) => (
              <ListingCard key={String(l.id)} listing={l} network={net} />
            ))}
          </div>
        )}
      </section>

      <TrustTable />
    </div>
  );
}
