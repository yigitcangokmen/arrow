# [team-made] NEAR mainnet chain stats, Nov 2026 (computed from public RPC)

Public description (listing `public_desc`, 249 characters): Per-block NEAR mainnet statistics (gas used and limit, utilization, transactions and receipts across all shards), sampled every 600 blocks (about six minutes) over about 19 hours. Computed by the Arrow team from public RPC. Real data, not synthetic.

## What this is
Real NEAR mainnet statistics that the Arrow team computed itself from public JSON-RPC responses. The dataset is **team-made** and **not synthetic**. It contains no third-party site data, no account ids, no transaction hashes and no personal data. Every cell is a number or a UTC timestamp.

## Source
- Source: NEAR mainnet public JSON-RPC (block and chunk queries).
- Endpoints (both serve the same chain; each request goes to the less busy one, and the archival one also answers when the other has no such block):
  - https://rpc.mainnet.fastnear.com
  - https://archival-rpc.mainnet.fastnear.com
- RPC methods used: `block`, `chunk`. Nothing else is called.
- Requests made: 2739 (252 `block`, 2487 `chunk`; 126 retries after 127 HTTP 429 answers).
  - https://rpc.mainnet.fastnear.com: 1651 requests
  - https://archival-rpc.mainnet.fastnear.com: 1088 requests
- Pacing: at least 900 ms between two request starts on the same endpoint (the gap grows by half after an HTTP 429, up to 3000 ms, and shrinks again after 10 good calls), at most 4 in flight.

## Collection
- Collection started: 2026-11-10T09:41:03Z (UTC).
- Collection finished: 2026-11-10T10:26:34Z (UTC).
- Head (final block when the run started): height 223898579, hash `37Jscnh1DT3tT4Rkt1G8tVyekq18yQdWE5y9DvJTLX5R`, block time 2026-11-10T09:41:01Z (UTC).
- Sampling: the block at `head - k * 600` for k = 0..199 (200 rows). If a height has no block (skipped slot) the nearest earlier block is used (0 of 200 sampled heights needed that).
- Block heights 223779179 (2026-11-09T14:24:42Z) to 223898579 (2026-11-10T09:41:01Z).
- Reproduce: `npx tsx scripts/src/collect-chain-stats.ts --head 223898579 --rows 200 --stride 600`. Blocks are immutable on chain, so the same head gives the same rows; the first endpoint keeps only a few days, the archival one serves older heights.

## File
- `fixtures/team-made/near-chain-stats-2026-11.csv`: 200 rows, 18358 bytes, sha256 `9a282d2ca12cf76e6a3d854d8ff43dee88ee771f77197b97e10c43b6b1ca39e2`.
- Columns: `block_height`, `block_date` (UTC, YYYY-MM-DD), `block_ts` (UTC), `shards` (chunk slots in the block), `chunks_included` (chunks newly included in this block), `gas_used` and `gas_limit` (gas units, summed over the newly included chunks), `utilization_pct` (floor of 100 * gas_used / gas_limit, two decimals), `tx_count` (transactions in those chunks), `receipt_count` (length of the `receipts` array that the `chunk` method returns for those chunks, taken as returned).
- Rows are sorted by ascending block height.

## Limits
- This is a sample of 200 blocks, not every block. Utilization and counts describe those blocks only.
- Nothing here is cleaned; whatever the chain returned is what is in the file.
- The request counts above are for the whole run, including blocks that were fetched and are not in the file (the run was stopped early because the public endpoints answer HTTP 429 above about 1.5 requests per second).

Machine-readable twin: `manifest.json`. `npx tsx scripts/src/collect-chain-stats.ts --check` verifies the CSV against it without network.
