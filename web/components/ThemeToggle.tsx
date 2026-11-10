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

export function ThemeToggle() {
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
    <button type="button" className={styles.toggle} onClick={next} aria-label={`Theme: ${pref}. Switch theme`}>
      {pref}
    </button>
  );
}
