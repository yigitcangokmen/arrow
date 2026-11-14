"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { parseNetwork } from "../lib/config.ts";
import { NAV_BAR, navLinks, shortHash, txUrl } from "../lib/links.ts";
import { NetBadge } from "./NetBadge.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import styles from "./Nav.module.css";

/** The arrow mark next to the name: a plain inline SVG, no script. */
function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18 18 6" />
      <path d="M9 6h9v9" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/**
 * Reads ?network= so the badge and the links follow the network being viewed (QA-16). Render it inside <Suspense>.
 * Desktop: brand, Trust · Verify · Sell · Lock tx, the network badge, Listings as the filled button and the theme switch. Attack and
 * Payouts are in the phone menu and the footer. Below 860 px the links move into a <details> menu; it closes after a click, on Escape (focus back on
 * the menu button) and on a tap outside. `mainnetLive` comes from a server-side view call (lib/server/mainnetLive.ts); `mainnetLockTx`
 * from the evidence file.
 */
export function Nav({ mainnetLive = false, mainnetLockTx = null }: { mainnetLive?: boolean; mainnetLockTx?: string | null }) {
  const net = parseNetwork(useSearchParams().get("network"));
  const menu = useRef<HTMLDetailsElement>(null);
  const links = navLinks(net);
  const brand = links.find((l) => l.label === "Arrow")!;
  const listings = links.find((l) => l.label === "Listings")!;
  const middle = links.filter((l) => l !== brand && l !== listings);
  const pathname = usePathname();
  const current = (href: string) => {
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(`${path}/`) ? "page" : undefined;
  };
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = menu.current;
      if (e.key !== "Escape" || !d?.open) return;
      d.open = false;
      d.querySelector("summary")?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const d = menu.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  const item = ({ href, label }: { href: string; label: string }) => (
    <li key={href}><Link href={href} onClick={close} aria-current={current(href)}>{label}</Link></li>
  );
  // The mainnet lock transaction, after Sell in the bar and in the phone menu.
  const lockItem = mainnetLockTx ? (
    <li>
      <a href={txUrl("near", "mainnet", mainnetLockTx)} target="_blank" rel="noopener noreferrer" onClick={close}>
        Lock tx <span aria-hidden="true">↗</span><span className="sr-only"> {shortHash(mainnetLockTx)} (opens in a new tab)</span>
      </a>
    </li>
  ) : null;
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Main">
        <Link href={brand.href} className={styles.brand}><Mark />{brand.label}</Link>
        <ul className={styles.links}>{middle.filter((l) => (NAV_BAR as readonly string[]).includes(l.label)).map(item)}{lockItem}</ul>
        <div className={styles.right}>
          <NetBadge net={net} mainnetLive={mainnetLive} pathname={pathname} lockTx={mainnetLockTx} />
          <Link href={listings.href} className={styles.try} aria-current={current(listings.href)}>{listings.label}</Link>
          <span className={styles.theme}><ThemeToggle /></span>
          <details className={styles.menu} ref={menu}>
            <summary><MenuIcon /><span className="sr-only">Menu</span></summary>
            <div className={styles.sheet}>
              <ul>{middle.map(item)}{lockItem}</ul>
              <ThemeToggle withLabel />
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
