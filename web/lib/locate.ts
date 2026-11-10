// Finds the newest record of a sequential id space (get_eval, get_purchase, get_listing) that satisfies `match`.
// Used when a payment is known to have happened but its transaction hash is not (the nonce is used, the relay lost the answer).
export async function locateLatest<T>(
  read: (id: number) => Promise<T | null>,
  match: (t: T) => boolean,
  o: { maxBack?: number } = {},
): Promise<{ id: number; rec: T } | null> {
  // Contract ids start at 1 (next_*_id: 1), so id 0 never exists (W2-1).
  if ((await read(1)) === null) return null;
  // smallest n with no record: grow by doubling, then bisect
  let known = 1;
  let missing = 2;
  while ((await read(missing)) !== null) {
    known = missing;
    missing *= 2;
    if (missing > 1 << 26) return null;
  }
  while (missing - known > 1) {
    const mid = Math.floor((known + missing) / 2);
    if ((await read(mid)) !== null) known = mid;
    else missing = mid;
  }
  for (let id = known, n = 0; id >= 1 && n < (o.maxBack ?? 60); id--, n++) {
    const rec = await read(id);
    if (rec !== null && match(rec)) return { id, rec };
  }
  return null;
}
