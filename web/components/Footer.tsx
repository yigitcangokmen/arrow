import Link from "next/link";
import { teamAccounts } from "../generated/data.ts";
import { DEFAULT_NETWORK } from "../lib/config.ts";
import { REPO_URL } from "../lib/links.ts";
import { lastGoodListings, loadListingViews } from "../lib/server/listingsPage.ts";
import { mainnetContractLive } from "../lib/server/mainnetLive.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";
import { FooterNet } from "./FooterNet.tsx";
import styles from "./Footer.module.css";

/**
 * Outside sellers on the deploy's network, read from the chain (30 s cache; the last good read while the RPC is busy). Null when the
 * listings have never been read: the clause is then left out.
 */
async function outsideSellers(): Promise<number | null> {
  const count = (views: ListingView[]) => new Set(views.filter((v) => v.label === "external").map((v) => v.seller)).size;
  try {
    return count(await loadListingViews(DEFAULT_NETWORK, teamAccounts));
  } catch {
    const last = lastGoodListings(DEFAULT_NETWORK);
    return last ? count(last.views) : null;
  }
}

export async function Footer() {
  // The same check as the network badge, so the footer never says "not deployed" while the badge says the contract is live.
  const [outside, live] = await Promise.all([outsideSellers(), mainnetContractLive()]);
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div>
          <p className={styles.brand}>Arrow</p>
          <p className={styles.fine}>
            <FooterNet live={live} />{outside !== null ? <> · outside sellers of real data so far: <span className="mono">{outside}</span></> : null}
          </p>
        </div>
        <ul className={styles.links} aria-label="Footer">
          <li><Link href="/listings">Listings</Link></li>
          <li><Link href="/trust#trust-table">Trust table</Link></li>
          <li><Link href="/verify">Verify</Link></li>
          <li><Link href="/attack">Attack</Link></li>
          <li><Link href="/sell">Sell</Link></li>
          <li><Link href="/seller">Payouts</Link></li>
          {REPO_URL ? <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub<span className="sr-only"> (opens in a new tab)</span></a></li> : null}
        </ul>
      </div>
    </footer>
  );
}
