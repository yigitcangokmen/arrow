import Link from "next/link";
import { teamAccounts } from "../generated/data.ts";
import { DEFAULT_NETWORK } from "../lib/config.ts";
import { REPO_URL } from "../lib/links.ts";
import { loadListingViews } from "../lib/server/listingsPage.ts";
import styles from "./Footer.module.css";

/** Outside sellers on the deploy's network, read from the chain (30 s cache). Null when the listings cannot be read: the clause is then left out. */
async function outsideSellers(): Promise<number | null> {
  try {
    const views = await loadListingViews(DEFAULT_NETWORK, teamAccounts);
    return new Set(views.filter((v) => v.label === "external").map((v) => v.seller)).size;
  } catch {
    return null;
  }
}

export async function Footer() {
  const outside = await outsideSellers();
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div>
          <p className={styles.brand}>Arrow</p>
          <p className={styles.fine}>
            {DEFAULT_NETWORK === "testnet" ? "NEAR testnet · synthetic demo data · mainnet not deployed" : "NEAR mainnet"}{outside !== null ? <> · outside sellers of real data so far: <span className="mono">{outside}</span></> : null}
          </p>
        </div>
        <ul className={styles.links} aria-label="Footer">
          <li><Link href="/try">Try it free</Link></li>
          <li><a href="/#trust-table">Trust table</a></li>
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
