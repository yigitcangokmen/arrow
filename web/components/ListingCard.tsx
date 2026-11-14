import Link from "next/link";
import type { Network } from "../lib/config.ts";
import { formatBits, formatUsdc } from "../lib/format.ts";
import { addressUrl, listingLinks } from "../lib/links.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";
import { Badge } from "./Badge.tsx";
import { BitCounter } from "./BitCounter.tsx";
import styles from "./ListingCard.module.css";

/** On testnet the buy page is read-only, so the card's main action is the free demo run of the matching scene. */
function tryHref(title: string): string {
  if (/wallet/i.test(title)) return "/try?criteria=demo-buy";
  if (/unlock/i.test(title)) return "/try?criteria=demo";
  return "/try";
}

/**
 * The home page's short card: labels, title, three column names, the row count and the two prices. On testnet, where real purchases
 * are switched off, the whole card opens the free demo run of its scene; on mainnet it opens the listing page, which holds the seller,
 * the leak budget and the rest. Only for listings the page knows a team account made.
 */
function CompactCard({ listing: l, network }: { listing: ListingView; network: Network }) {
  const links = listingLinks(l.id, network);
  return (
    <Link
      href={network === "testnet" ? tryHref(l.displayTitle) : links.buy}
      className={`${styles.card} ${styles.compact}`}
      title={network === "testnet" ? `Opens the free demo, which lists a fresh copy of this synthetic file. Listing #${String(l.id)} itself: ${links.buy}` : undefined}
    >
      <div className={styles.top}>
        <span className={styles.badges}>
          <Badge kind={l.label} />
          {l.label !== "team-made" ? <Badge kind="team-made" /> : null}
        </span>
        <span className="mono">#{String(l.id)}</span>
      </div>
      <h3 className={styles.title}><bdi>{l.displayTitle}</bdi></h3>
      <ul className={styles.cols} aria-label="Columns">
        {l.columns.slice(0, 3).map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p className={styles.compactFoot}>
        {/rows/i.test(l.displayTitle) ? <span /> : <span><b className="mono">{Number(l.rows_claimed).toLocaleString("en-US")}</b> rows</span>}
        <span>inspect <b className="mono">${formatUsdc(l.eval_fee)}</b> · buy <b className="mono">${formatUsdc(l.price)}</b></span>
      </p>
    </Link>
  );
}

/**
 * `team` is set by a page that knows the seller is a team account; the card then names the team next to the account. `compact` (team
 * listings only) is the home page's short card.
 */
export function ListingCard({ listing: l, network, team = false, compact = false }: { listing: ListingView; network: Network; team?: boolean; compact?: boolean }) {
  if (compact && team && !l.stale) return <CompactCard listing={l} network={network} />;
  const links = listingLinks(l.id, network);
  const demo = network === "testnet" && !l.stale;
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <Badge kind={l.label} />
        <span className="mono">#{String(l.id)}</span>
      </div>
      <h3 className={styles.title}><Link href={links.buy} className={styles.titleLink}><bdi>{l.displayTitle}</bdi></Link></h3>
      {l.stale ? <p className={styles.spent}>Sealed to an older enclave program: it can no longer be inspected or bought</p> : null}
      {l.budget.leftBits === 0 ? <p className={styles.spent}>No inspection possible: you would be buying blind</p> : null}
      <p className={styles.meta}>
        Seller{" "}
        {team ? (
          <a href={addressUrl(l.seller, network)} target="_blank" rel="noopener noreferrer" title={l.seller}>the Arrow team<span className="sr-only"> (account {l.seller}, opens in a new tab)</span></a>
        ) : (
          <a href={addressUrl(l.seller, network)} target="_blank" rel="noopener noreferrer" className="mono" title={l.seller}>{l.seller.length > 16 ? `${l.seller.slice(0, 6)}…${l.seller.slice(-4)}` : l.seller}</a>
        )}
      </p>
      {l.public_desc ? <p className={styles.desc}><bdi>{l.public_desc}</bdi></p> : null}
      <ul className={styles.facts} aria-label="Listing facts">
        <li><b className="mono">{Number(l.rows_claimed).toLocaleString("en-US")}</b> rows (seller&apos;s claim)</li>
        <li><b className="mono">{l.columns.length}</b> columns</li>
        <li title="Each listing allows a fixed number of inspections, because every answer tells a little about the file."><b className="mono">{l.budget.evalsUsed}/{l.budget.maxEvals}</b> inspections used</li>
        <li>{l.mode === "scored" ? "BUY/PASS + scores" : "BUY/PASS only"}</li>
      </ul>
      <details className={styles.reveal}>
        <summary>What one inspection can reveal</summary>
        <p>
          {l.mode === "scored" ? "One of 51 possible answers" : "One of 3 possible answers"}, never a row. Measured as information (one bit is one yes/no
          answer): at most {formatBits(l.bits_per_eval_milli)} bits per inspection, {formatBits(l.max_evals * l.bits_per_eval_milli)} bits over all {l.max_evals}. Run time and
          instruction count are public too and can hint at the data.
        </p>
        <div title="Counts every eval, including refunded ones.">
          <BitCounter spentBits={l.budget.spentBits} budgetBits={l.budget.budgetBits} />
        </div>
      </details>
      <div className={styles.foot}>
        <p className={styles.price}>
          Inspect <b>${formatUsdc(l.eval_fee)}</b> <span aria-hidden="true">·</span> Buy <b>${formatUsdc(l.price)}</b>
        </p>
        <div className={styles.actions}>
          {l.stale ? (
            <Link href={links.buy}>Details</Link>
          ) : demo ? (
            <>
              <Link href={links.buy}>View listing</Link>
              <Link className={styles.primary} href={tryHref(l.displayTitle)} title="The free demo lists a fresh copy of this synthetic file with a throwaway account and inspects it">Try a fresh copy free</Link>
            </>
          ) : (
            <Link className={styles.primary} href={links.buy}>Inspect</Link>
          )}
        </div>
      </div>
    </article>
  );
}
