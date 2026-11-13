import type { ReactNode } from "react";
import styles from "./Section.module.css";

/** Every section opens the same way: a mono eyebrow, an H2 ending in a period, one muted lede. */
export function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: ReactNode }) {
  return (
    <div className={styles.head}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={id} className={styles.h2}>{title}</h2>
      {children ? <p className={styles.lede}>{children}</p> : null}
    </div>
  );
}

/** The eyebrow and H1 of an app page, with its plain lede. */
export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className={styles.page}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.h1}>{title}</h1>
      {children ? <p className={styles.lede}>{children}</p> : null}
    </div>
  );
}

/** Dot-separated facts, the first one bold. */
export function HonestyLine({ items }: { items: string[] }) {
  return (
    <ul className={styles.honesty} aria-label="What this demo is">
      {items.map((t, i) => (
        <li key={t}>{i === 0 ? <b>{t}</b> : t}</li>
      ))}
    </ul>
  );
}

/** A calm notice with a left rule, for the read-only and testnet notes. */
export function Note({ children }: { children: ReactNode }) {
  return <div className={styles.note} role="note">{children}</div>;
}
