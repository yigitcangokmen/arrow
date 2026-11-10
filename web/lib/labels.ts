import { isTeamAccount } from "@arrow/sdk/team";

// DEC H-07: the title prefix decides the label. Team accounts matter only for "external" vs "unlabelled".
export type ListingLabel = "synthetic" | "team-made" | "external" | "unlabelled";

// The label tag may follow other tags: "[perf] [synthetic] ..." is synthetic. Only the leading run of bracket tags counts.
const TAG_RUN = /^(?:\[[^\]]*\]\s*)+/;
const LABEL_TAG = /\[(synthetic|team-made)\]\s*/i;

export function labelOf(listing: { title: string; seller: string }, teamAccounts: readonly string[]): ListingLabel {
  const m = LABEL_TAG.exec(TAG_RUN.exec(listing.title)?.[0] ?? "");
  if (m) return m[1].toLowerCase() as "synthetic" | "team-made";
  return isTeamAccount(listing.seller, teamAccounts) ? "unlabelled" : "external";
}

/** The title without its `[synthetic]` / `[team-made]` tag (other leading tags stay). */
export function displayTitle(title: string): string {
  const run = TAG_RUN.exec(title)?.[0] ?? "";
  return run.replace(LABEL_TAG, "") + title.slice(run.length);
}
