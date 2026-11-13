"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { parseNetwork } from "../lib/config.ts";
import { navLinks } from "../lib/links.ts";
import { Badge } from "./Badge.tsx";
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

/**
 * Reads ?network= so the badge and the links follow the network being viewed (QA-16). Render it inside <Suspense>.
 * Desktop: brand, "Who sees what", the NAV_LINKS, the network chip, Try as the filled button and the theme switch.
 * Below 860 px the links move into a <details> menu; it closes after a click, on Escape (focus back on Menu) and on a tap outside.
 */
export function Nav() {
  const net = parseNetwork(useSearchParams().get("network"));
  const menu = useRef<HTMLDetailsElement>(null);
  const links = navLinks(net);
  const brand = links.find((l) => l.label === "Arrow")!;
  const tryLink = links.find((l) => l.label === "Try")!;
  const middle = links.filter((l) => l !== brand && l !== tryLink);
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
  const items = (
    <>
      {/* A plain link: a client-side jump to /#trust renders the loading screen first and loses the hash target. */}
      <li><a href="/#trust" onClick={close}>Who sees what</a></li>
      {middle.map(({ href, label }) => (
        <li key={href}><Link href={href} onClick={close} aria-current={current(href)}>{label}</Link></li>
      ))}
    </>
  );
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Main">
        <Link href={brand.href} className={styles.brand}><Mark />{brand.label}</Link>
        <ul className={styles.links}>{items}</ul>
        <div className={styles.right}>
          <span className={styles.chip}><Badge kind={net} /></span>
          <Link href={tryLink.href} className={styles.try} aria-current={current(tryLink.href)}>{tryLink.label}</Link>
          <span className={styles.theme}><ThemeToggle /></span>
          <details className={styles.menu} ref={menu}>
            <summary>Menu</summary>
            <div className={styles.sheet}>
              <ul>{items}</ul>
              <ThemeToggle withLabel />
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
