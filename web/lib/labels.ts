import { isTeamAccount } from "@arrow/sdk/team";

// DEC H-07: the title prefix decides the label, with one exception: [team-made] is believed only from a team account (SCAM-2).
export type ListingLabel = "synthetic" | "team-made" | "external" | "unlabelled";

// The label tag may follow other tags: "[perf] [synthetic] ..." is synthetic. Only the leading run of bracket tags counts.
const TAG_RUN = /^(?:\[[^\]]*\]\s*)+/;
const LABEL_TAG = /\[(synthetic|team-made)\]\s*/i;
const TEAM_TAG = /\[team-made\]\s*/i;

/**
 * [synthetic] is the seller's own statement about the data and is shown as such. [team-made] says Arrow made it, so an outside
 * seller who writes it is an external seller, and the tag stays in the shown title where everyone can read the claim.
 */
export function labelOf(listing: { title: string; seller: string }, teamAccounts: readonly string[]): ListingLabel {
  const m = LABEL_TAG.exec(TAG_RUN.exec(listing.title)?.[0] ?? "");
  const team = isTeamAccount(listing.seller, teamAccounts);
  if (m) {
    const tag = m[1].toLowerCase() as "synthetic" | "team-made";
    return tag === "team-made" && !team ? "external" : tag;
  }
  return team ? "unlabelled" : "external";
}

/** The title without its `[synthetic]` / `[team-made]` tag (other leading tags stay). `keepTeamTag` leaves an unbelieved [team-made] visible. */
export function displayTitle(title: string, keepTeamTag = false): string {
  const run = TAG_RUN.exec(title)?.[0] ?? "";
  const m = LABEL_TAG.exec(run);
  if (m && keepTeamTag && TEAM_TAG.test(m[0])) return title;
  return run.replace(LABEL_TAG, "") + title.slice(run.length);
}
