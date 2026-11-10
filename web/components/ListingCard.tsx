import Link from "next/link";
import type { Network } from "../lib/config.ts";
import { formatUsdc } from "../lib/format.ts";
import { addressUrl, listingLinks } from "../lib/links.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";
import { Badge } from "./Badge.tsx";
import { BitCounter } from "./BitCounter.tsx";
import styles from "./ListingCard.module.css";

export function ListingCard({ listing: l, network }: { listing: ListingView; network: Network }) {
  const shown = l.columns.slice(0, 4);
  const more = l.columns.length - shown.length;
  const links = listingLinks(l.id, network);
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h3 className={styles.title}><bdi>{l.displayTitle}</bdi></h3>
        <Badge kind={l.label} />
        {l.stale ? <span className={styles.spent}>Sealed to an older enclave program: it can no longer be inspected or bought</span> : null}
        {l.budget.leftBits === 0 ? <span className={styles.spent}>No inspection possible: you would be buying blind</span> : null}
      </header>
      <p className={styles.meta}>
        Seller <a href={addressUrl(l.seller, network)} target="_blank" rel="noopener noreferrer" className="mono" title={l.seller}>{l.seller.length > 16 ? `${l.seller.slice(0, 6)}…${l.seller.slice(-4)}` : l.seller}</a>
      </p>
      {l.public_desc ? <p className={styles.desc}><bdi>{l.public_desc}</bdi></p> : null}
      <p className={styles.meta}>
        {l.columns.length} columns: <bdi className="mono">{shown.join(", ")}{more > 0 ? `, +${more} more` : ""}</bdi>
        {" · "}~{String(l.rows_claimed)} rows claimed by the seller · {l.mode} mode
      </p>
      <div title="Counts every eval, including refunded ones.">
        <BitCounter spentBits={l.budget.spentBits} budgetBits={l.budget.budgetBits} />
      </div>
      <p className={styles.price}>
        Inspect · ${formatUsdc(l.eval_fee)} <span aria-hidden="true">/</span> Buy · ${formatUsdc(l.price)}
      </p>
      <div className={styles.actions}>
        {l.stale ? <Link href={links.buy}>Details</Link> : <Link className={styles.primary} href={links.buy}>Inspect</Link>}
        <a className={styles.small} href={links.x402}>x402</a>
      </div>
    </article>
  );
}
