import Link from "next/link";
import { DEFAULT_NETWORK } from "../lib/config.ts";
import { Badge } from "./Badge.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import styles from "./Nav.module.css";

const LINKS = [
  ["/", "Arrow"],
  ["/sell", "Sell"],
  ["/seller", "Payouts"],
  ["/verify", "Verify"],
  ["/attack", "Attack"],
  ["/try", "Try"],
] as const;

export function Nav() {
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Main">
        <ul className={styles.links}>
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className={href === "/" ? styles.brand : undefined}>{label}</Link>
            </li>
          ))}
        </ul>
        <div className={styles.right}>
          <Badge kind={DEFAULT_NETWORK} />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
