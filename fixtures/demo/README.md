# fixtures/demo/

**Synthetic.** Everything in this folder is fictional data made by the Arrow team for the demo. No row describes a real token, wallet or person. Accounts live under `synthetic-demo.near`, which does not exist on mainnet. Token tickers start with `X` and are random; a match with a real ticker is a coincidence. The seller of these listings is the team.

Rebuild: `npx tsx scripts/src/gen-demo-data.ts` (then `npx tsx scripts/src/make-demo-criteria.ts`). Both take `--check` and are byte-stable.

| File | Rows | What |
|---|---|---|
| `unlock-schedule-412.csv` | 412 | Listing 1, the PASS scene: `[synthetic] Q1 2027 token unlock schedule (412 rows)`. Key column `token_contract`, dates 2027-01-01 to 2027-03-31 |
| `wallet-labels-1000.csv` | 1,000 | Listing 2, the BUY scene: `[synthetic] NEAR DeFi wallet labels (1,000 rows)`. Key column `account_id`, `last_active` 2026-08-01 to 2026-10-31 |
| `buyer-list-unlock.csv` | 412 | The demo buyer's own list for scene 1. 371 of 412 keys are in the seller data: overlap 0.900 in both directions |
| `buyer-list-labels.csv` | 1,000 | The demo buyer's own list for scene 2. 300 of 1,000 keys are in the seller data: overlap 0.300 in both directions |
| `expected.json` | | Overlaps, MinHash estimates, plaintext sha256 values and the seeds |

Both listing CSVs have a `synthetic` column that is `yes` on every row. The buyer lists are one-column key lists (only the key column is read), so their label is the `.synthetic-demo.near` suffix on every key and this file.

## Scenes and expected results

| Scene | Criteria | Deterministic part | Expected |
|---|---|---|---|
| 1 | `fixtures/criteria/demo.json` | One required column (`vesting_contract_audit`) is missing, so `fit_rule` = 4. MinHash estimate puts novelty in band 1 | PASS (novelty 1, below `min_novelty` 3) |
| 2 | `fixtures/criteria/demo-buy.json` | All structural gates hold, `fit_rule` = 5, novelty band 4 | BUY when the model agrees (the model part is not deterministic) |
| 3 | `fixtures/criteria/print-row-1.json` | Designed to trip the exfil guard (the enclave exfil tests, not this folder, are the check) | PASS, fit 1, novelty 1 |

The bands are the result of `arrow-core`'s own functions: `cargo test -p arrow-core --test demo_bands`. The TS estimators in `scripts/src/lib/containment.ts` only choose the data seeds.

## Blobs

The plain key K of a blob is never stored. `scripts/src/make-demo-blobs.ts` encrypts a dataset with a fresh K at listing time, seals K to the program key of the target network (`sealed_k`) and drops it. A new run makes a new blob and a new `sealed_k`, so the blobs in `fixtures/blobs/` are per network and per program key. After the wasm freeze the testnet program key changes, so older testnet listings cannot be read and refund; that is expected.
