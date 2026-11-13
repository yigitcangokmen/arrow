"use client";
import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

type Pref = "system" | "light" | "dark";
const ORDER: Pref[] = ["system", "light", "dark"];
const KEY = "arrow-theme";

function stored(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Sun (light), moon (dark), half-filled circle (follow the system). Drawn inline, no script. */
function Icon({ pref }: { pref: Pref }) {
  const common = { "aria-hidden": true, viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (pref === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (pref === "dark") {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  );
}

const WORD: Record<Pref, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

/** `withLabel` adds the words next to the icon (the mobile menu, where there is room). */
export function ThemeToggle({ withLabel = false }: { withLabel?: boolean } = {}) {
  const [pref, setPref] = useState<Pref>("system");
  useEffect(() => setPref(stored()), []);

  function next() {
    const n = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    setPref(n);
    if (n === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", n);
    try {
      if (n === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, n);
    } catch {
      // storage can be blocked; the choice then lasts until reload
    }
  }

  return (
    <button type="button" className={withLabel ? `${styles.toggle} ${styles.labelled}` : styles.toggle} onClick={next} aria-label={`Theme: ${pref}. Switch theme`} title={`${WORD[pref]}. Switch theme`}>
      <Icon pref={pref} />
      {withLabel ? <span aria-hidden="true">{WORD[pref]}</span> : null}
    </button>
  );
}
