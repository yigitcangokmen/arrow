"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseNetwork } from "../lib/config.ts";
import { navLinks } from "../lib/links.ts";
import { Badge } from "./Badge.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import styles from "./Nav.module.css";

/** Reads ?network= so the badge and the links follow the network being viewed (QA-16). Render it inside <Suspense>. */
export function Nav() {
  const net = parseNetwork(useSearchParams().get("network"));
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Main">
        <ul className={styles.links}>
          {navLinks(net).map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className={href === "/" ? styles.brand : undefined}>{label}</Link>
            </li>
          ))}
        </ul>
        <div className={styles.right}>
          <Badge kind={net} />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
