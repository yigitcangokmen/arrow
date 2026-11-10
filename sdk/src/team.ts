/** A team account is listed in the team accounts file or is the Arrow root or one of its subaccounts (DEC H-07, Q-07). */
export function isTeamAccount(account: string, listed: readonly string[] = []): boolean {
  const a = account.toLowerCase();
  if (listed.some((t) => t.toLowerCase() === a)) return true;
  return a === "arrowhq.near" || a === "arrowhq.testnet" || a.endsWith(".arrowhq.near") || a.endsWith(".arrowhq.testnet");
}
