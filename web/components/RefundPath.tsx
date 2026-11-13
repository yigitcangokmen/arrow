import { InView } from "./InView.tsx";
import styles from "./RefundPath.module.css";

const Card = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>;
const Cross = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>;
const Tick = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;

/**
 * One recorded failed inspection: paid, the sealed hardware returned an error, paid back less Arrow's share. The amounts are that run's
 * (RECORDED_REFUND); `txHref` opens its refund transaction. The return arc draws once when it scrolls into view.
 */
export function RefundPath({ paid, back, txHref }: { paid: string; back: string; txHref: string | null }) {
  return (
    <InView className={styles.path}>
      <span className={styles.line} aria-hidden="true" />
      <span className={styles.arc} aria-hidden="true" />
      <ol className={styles.nodes} aria-label="A recorded failed inspection">
        <li><span className={styles.dot}><Card /></span><b>paid</b><span><span className="mono">{paid}</span> inspection</span></li>
        <li><span className={`${styles.dot} ${styles.x}`}><Cross /></span><b>failed</b><span>error output</span></li>
        <li>
          <span className={`${styles.dot} ${styles.ok}`}><Tick /></span>
          <b>refunded</b>
          {txHref ? (
            <a href={txHref} target="_blank" rel="noopener noreferrer"><span className="mono">{back}</span> on chain<span className="sr-only"> (opens the refund transaction in a new tab)</span></a>
          ) : (
            <span className="mono">{back}</span>
          )}
        </li>
      </ol>
    </InView>
  );
}
