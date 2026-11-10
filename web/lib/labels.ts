// DEC H-07: the title prefix decides the label. Team accounts matter only for "external" vs "unlabelled".
export type ListingLabel = "synthetic" | "team-made" | "external" | "unlabelled";

const PREFIX = /^\[(synthetic|team-made)\]\s*/i;

export function labelOf(listing: { title: string; seller: string }, teamAccounts: readonly string[]): ListingLabel {
  const m = PREFIX.exec(listing.title);
  if (m) return m[1].toLowerCase() as "synthetic" | "team-made";
  return teamAccounts.includes(listing.seller) ? "unlabelled" : "external";
}

/** The title without its `[synthetic]` / `[team-made]` prefix. */
export function displayTitle(title: string): string {
  return title.replace(PREFIX, "");
}
