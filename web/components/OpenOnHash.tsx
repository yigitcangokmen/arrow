"use client";
import { useEffect } from "react";

/**
 * Opens the <details> with this id when the URL fragment names it (the footer's "Trust table" link), or names an element inside it
 * whose id starts with `prefix` (a trust-table row), on load and on every hash change. Focus moves to the summary so keyboard and
 * screen-reader users land where the page scrolled to.
 */
export function OpenOnHash({ id, prefix }: { id: string; prefix?: string }) {
  useEffect(() => {
    const open = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      if (hash !== id && !(prefix && hash.startsWith(prefix))) return;
      const d = document.getElementById(id);
      if (!(d instanceof HTMLDetailsElement)) return;
      d.open = true;
      const target = hash === id ? d : document.getElementById(hash) ?? d;
      target.scrollIntoView();
      d.querySelector("summary")?.focus({ preventScroll: true });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [id, prefix]);
  return null;
}
