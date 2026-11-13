import type { ReactNode } from "react";
import { TRUST_PATH } from "../lib/links.ts";
import { trustRowId } from "../lib/trust.ts";
import styles from "./Sightlines.module.css";

const ICON = { strokeWidth: 1.8, fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": true } as const;
const Person = () => <svg {...ICON}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
const Lock = () => <svg {...ICON}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
const Chip = () => <svg {...ICON}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="10" y="10" width="4" height="4" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>;
const Chain = () => <svg {...ICON}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>;
const Page = () => <svg {...ICON}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>;

interface Party {
  who: string;
  icon: ReactNode;
  you?: boolean;
  gets: string[];
  never: string[];
  /** A trust-table flag shown on the card, linked to its row on /trust. */
  flag?: { text: string; row: string };
}

/**
 * What each part of the system holds and never gets, the same on the home page and /trust. The trust table (/trust) is the source of
 * truth; these are its short form, and they keep the side channels visible (NEAR AI's file totals and your criteria; on chain the
 * column names, row count, run time and who paid). The chain and the Arrow site are separate cards: "never gets the rows" is true of
 * the chain, while the site's served JavaScript handles everything the page does (trust row "Arrow web app", RISKY), and the Arrow
 * operator's "cannot read data" is a plan until the contract is locked (row "Arrow operator", TODO).
 */
const PARTIES: Party[] = [
  { who: "You", icon: <Person />, you: true, gets: ["verdict", "fit · novelty", "rows, after you buy"], never: [] },
  { who: "Sealed hardware", icon: <Lock />, gets: ["whole file", "unlock key", "signed report"], never: [] },
  { who: "NEAR AI", icon: <Chip />, gets: ["40-row sample", "file totals", "your criteria"], never: ["unlock key"] },
  { who: "Public chain", icon: <Chain />, gets: ["fingerprints", "amounts", "who paid", "column names", "row count", "run time"], never: ["rows"] },
  {
    who: "Arrow site",
    icon: <Page />,
    gets: ["encrypted file", "IP address", "all this page handles"],
    never: [],
    flag: { text: "risky", row: "Arrow web app (served JavaScript)" },
  },
];

/** The key to the chips: a filled chip is what a part sees, a struck one what it never gets. */
export function SightLegend({ className = "" }: { className?: string }) {
  return (
    <p className={`${styles.legend} ${className}`}>
      <span className={styles.on}>sees</span>
      <span className={styles.no}><s>never gets</s></span>
    </p>
  );
}

/** Five short cards (two columns on phones): filled chips are what a part holds, struck red chips what it never gets. */
export function Sightlines({ large = false }: { large?: boolean }) {
  return (
    <ul className={`${styles.sight} ${large ? styles.large : ""}`} aria-label="Who sees what">
      {PARTIES.map((p) => (
        <li key={p.who} className={`${styles.who} ${p.you ? styles.you : ""}`}>
          <span className={styles.k}>
            <span>{p.who}</span>
            <span className={styles.glyph}>{p.icon}</span>
          </span>
          <ul className={styles.chips} aria-label={`${p.who} sees`}>
            {p.gets.map((c) => (
              <li key={c} className={styles.on}>{c}</li>
            ))}
          </ul>
          {p.never.length > 0 ? (
            <ul className={styles.chips} aria-label={`${p.who} never gets`}>
              {p.never.map((c) => (
                <li key={c} className={styles.no}><s>{c}</s></li>
              ))}
            </ul>
          ) : null}
          {p.flag ? (
            <a className={styles.flag} href={`${TRUST_PATH}#${trustRowId(p.flag.row)}`} title={`Trust table row: ${p.flag.row}`}>
              {p.flag.text} →
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
