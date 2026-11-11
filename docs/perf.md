# Enclave performance

Measured 2026-11-10 between 18:46 and 19:20 GMT+7, except the main `211bc63` column of the instruction table (2026-11-11). All data is the synthetic demo data (`fixtures/demo/`, labelled synthetic). Percentiles are nearest-rank over 10 runs, so p95 is the slowest run.

## Testnet

- Real evals on `arrow.arrowhq.testnet`, the first market contract, running program rc `73415b8f…` (pre-binding: built before the MinHash change below and before the binding fixes). rc4, which contains both, has not been re-measured.
- Listings: seller `spike.arrowhq.testnet` listed both scored demo datasets. The blobs are on testnet FastFS.
  - Listing 8 is the unlock scene: https://testnet.nearblocks.io/txns/5TUZURcuV2RPWcy2GtH6W4K7nGUSXDCqgN1gv4WEZGGf
  - Listing 9 is the labels scene: https://testnet.nearblocks.io/txns/HTa2E87jTyR3poTtfUpTTCbWEmtonHJrJVQ3typwhhAE
- Buyer: `bench.arrowhq.testnet` ran the evals one at a time. Each eval used a fresh buyer key and the demo criteria: `fixtures/criteria/demo.json` for listing 8 and `fixtures/criteria/demo-buy.json` for listing 9.
- The model was the real NEAR AI `Qwen/Qwen3.8-27B` call from inside the enclave.
- Command: `npx tsx scripts/dev/perf-testnet.ts --evals 10`. Every run below is also a row in `evidence/testnet.json` (`perf-eval-*`, `perf-list-*`).

Columns:
- `wall_ms`: from sending the transaction until a poll of the contract shows the eval settled. Polls run every 2 s.
- `chain_ms`: the eval's `settled_at − created_at`, in block time.
- `time_ms` and `instructions`: OutLayer's `execution_completed` event in the transaction tree.
- `output_bytes`: OutLayer's "Execution completed … Output: Json(N bytes)" log.

| run | network | listing | wall_ms | chain_ms | outlayer time_ms | instructions | output_bytes | result | tx |
|---|---|---|---|---|---|---|---|---|---|
| 1 | testnet | 8 unlock | 67 738 | 58 252 | 47 084 | 266 946 699 | 227 | PASS·2·1 | [2FV7Ep9P](https://testnet.nearblocks.io/txns/2FV7Ep9PcfBXibqtgDc3Q7YwCtsJJmhecFUEojAi29FM) |
| 2 | testnet | 8 unlock | 61 489 | 53 708 | 47 030 | 266 910 349 | 227 | PASS·2·1 | [CuXpKezr](https://testnet.nearblocks.io/txns/CuXpKezrJk4XL2iP14m3VWmWYtLCK3bPC4JPXnZP7Zje) |
| 3 | testnet | 8 unlock | 58 963 | 53 217 | 47 038 | 267 306 543 | 227 | PASS·2·1 | [6UwRbUT1](https://testnet.nearblocks.io/txns/6UwRbUT1dUaWbVeJecTCbFYx22kwnStSPKAGHaF5rUT5) |
| 4 | testnet | 8 unlock | 58 403 | 53 107 | 46 896 | 267 408 261 | 227 | PASS·2·1 | [2fo33MBP](https://testnet.nearblocks.io/txns/2fo33MBPzjtWLZ4ktSR5Ayt5vMDtUH3jSfWjg9sRYEVs) |
| 5 | testnet | 8 unlock | 63 554 | 56 802 | 47 024 | 267 340 958 | 227 | PASS·2·1 | [22gqz8qD](https://testnet.nearblocks.io/txns/22gqz8qDSuYoAUyi7N62AwkwxtZPooN9XXDWUEjcydPz) |
| 6 | testnet | 9 labels | 61 274 | 56 571 | 47 025 | 402 071 014 | 227 | BUY·5·4 | [6mke3XDR](https://testnet.nearblocks.io/txns/6mke3XDRrLd5kRFJU7DYyKHtgBPJoxyVcq1RtUcUm7y9) |
| 7 | testnet | 9 labels | 58 737 | 53 937 | 47 050 | 401 878 180 | 227 | BUY·5·4 | [4SsRbUFS](https://testnet.nearblocks.io/txns/4SsRbUFSD1uRc5BmLSDsEyWMKobAaFJAVvqT4v2uuXko) |
| 8 | testnet | 9 labels | 58 976 | 53 633 | 47 020 | 400 612 931 | 227 | BUY·5·4 | [Lyt2qLbb](https://testnet.nearblocks.io/txns/Lyt2qLbbArUN5Hx7xJyEsNfdeGfJmbh1PEeCgpLAzGG) |
| 9 | testnet | 9 labels | 58 679 | 53 253 | 46 993 | 402 142 496 | 227 | BUY·5·4 | [AcXWvptN](https://testnet.nearblocks.io/txns/AcXWvptNme5Kk4bcTPLFMJ9DmdoNBWZqfyV54zPTRo9E) |
| 10 | testnet | 9 labels | 71 154 | 59 735 | 47 019 | 402 063 696 | 227 | BUY·5·4 | [D1HDCdxx](https://testnet.nearblocks.io/txns/D1HDCdxx35fY2XRUu93pDN9ZQLGxVVT7ZXCZiNHA6iLL) |

Summary:
- All 10 runs settled with a verdict. There was no refund.
- The model gave the same verdict on all 5 runs of each listing.
- `wall_ms` p50 = 58 976 and p95 = 71 154.
- `chain_ms` p50 = 53 708 and p95 = 59 735.
- OutLayer `time_ms` p50 = 47 024 and p95 = 47 084. The spread is 46 896-47 084: [T_PAD](design.md#timeouts) hid the real work time.
- `instructions`:
  - 2.67e8 on the unlock listing (412 rows)
  - 4.02e8 on the labels listing (1 000 rows)
  - Runs on the same listing are within 0.4 % of each other.
- OutLayer did not report `compile_time_ms` for these runs. Its log says "Cached WASM"; the field only appeared on the first, freshly compiled run (the program-key derive).

## Local

- Command: `bash scripts/dev/perf-local.sh`. With `NEARAI_API_KEY` set in `.env` it uses `--llm real`.
- Build: the dev-endpoints wasm of commit e0c00d6, which includes the minhash change. The wasm is precompiled with `wasmtime compile`, so compile time is not counted.
- Settings: T_PAD off (`ARROW_DEV_TPAD_MS=0`), 40-row sample.
- Model and blobs: the real NEAR AI call. The same demo blobs and criteria as on testnet, served from `scripts/dev/fake-nearai.ts` on 127.0.0.1.
- Machine: Apple M5 Pro with wasmtime 50.0.1. Load average was about 9.8 (other sessions were building), so these times are an upper bound.

| run | network | listing | work s | output_bytes | result |
|---|---|---|---|---|---|
| 1 | local | unlock | 3.02 | 227 | PASS·2·1 |
| 2 | local | unlock | 3.79 | 227 | PASS·2·1 |
| 3 | local | unlock | 4.43 | 227 | PASS·2·1 |
| 4 | local | unlock | 3.33 | 227 | PASS·2·1 |
| 5 | local | unlock | 3.42 | 227 | PASS·2·1 |
| 6 | local | labels | 3.11 | 227 | BUY·5·4 |
| 7 | local | labels | 3.16 | 227 | BUY·5·4 |
| 8 | local | labels | 3.22 | 227 | BUY·5·4 |
| 9 | local | labels | 4.23 | 227 | BUY·5·4 |
| 10 | local | labels | 3.07 | 227 | BUY·5·4 |

Local work time: **p50 = 3.22 s, p95 = 4.43 s.** Almost all of it is the NEAR AI round trip. With the fake model the same runs take 0.03-0.08 s.

## Instruction count and max case

wasmtime fuel and OutLayer instructions are the same measure. The rc's program-key derive needs 4.49e6 fuel locally (bisection, ±1 %), and OutLayer reported 4 370 742 instructions for it (https://testnet.nearblocks.io/txns/C99mZHgRb6Lme6eBGYCEsKDtFxcogBvuqmeo373Xzxeh). The fuel figures below come from bisecting the smallest fuel that still finishes, to ±2 %. They use the fake model, because fuel does not depend on the model's answer.

The max case is 200 000 rows and 4 columns (`k,d,v,t`, key column `k`):
- Size: 5 000 008 B of plaintext, which becomes a 5 000 048 B blob (MAX_BLOB is 5 242 880).
- Criteria: a 128-value MinHash signature over 20 000 buyer keys, 10 000 of which overlap with the seller's.
- Limits: run under `-W fuel=20000000000 -W max-memory-size=536870912`, the testnet `limits_eval`.

| case | rc 73415b8f code | after e0c00d6 (u64 minhash) | main 211bc63 (rc4 enclave code), 2026-11-11 |
|---|---|---|---|
| demo unlock, 412 rows | 2.67e8 (testnet) | 2.38e8 | 2.63e8 |
| demo labels, 1 000 rows | 4.02e8 (testnet) | 3.25e8 | 3.58e8 |
| max case, 200 000 rows | **out of fuel at 2.0e10 (trap)** | 1.33e10, ok:true, 227 B, 0.71 s without fuel metering, peak RSS of the wasmtime process 27 MiB | **1.38e10**, ok:true, 227 B, 0.64 s without fuel metering, peak RSS 27 MiB |

The last column is `bash scripts/dev/perf-local.sh --llm fake --runs 1` on main; it adds the key-normalization budget and the deletion of default-ignorable characters to the e0c00d6 code.

What changed: `minhash::perm` used u128 `checked_rem`. On wasm32 that is a software division, and it cost about 950 instructions per permutation (128 permutations per distinct key). It now folds by 2^61 ≡ 1 mod P in u64. The value is the same: `perm_fold_equals_u128_rem` checks 200 000 random inputs and the edges around P against u128 `%`, and the TS/Rust MinHash vectors still pass.

Where the e0c00d6 figure of 1.33e10 goes at 200 000 rows (from runs at 10 000 rows):

| Part | Instructions |
|---|---|
| CSV walk and per-row stats | about 3.1e4 per row |
| Key normalization and sha256 | about 2e4 per key |
| 128 permutations | about 1.7e4 per key |
| Fixed cost | about 1.5e8 |

## Decisions (card rules, set in advance)

| Rule | Measured | Decision |
|---|---|---|
| Local work p95 > 25 s → SAMPLE_ROWS = 20 | 4.43 s | SAMPLE_ROWS stays 40 |
| Local work p95 > 45 s → T_PAD has no effect | 4.43 s | T_PAD works (Summary above) |
| Testnet `wall_ms` p95 > 85 000 → guard margin is thin | 71 154 (`chain_ms` p95 59 735) | No change. Block-to-settle was at most 59.7 s, about 30 s inside the [eval guard](design.md#timeouts) |
| `instructions` > 15e9 → RISK | 4.02e8 (testnet max) · 1.38e10 (local max case on main) | No RISK row. The max case uses 69 % of the 20e9 limit |
| Max case fails at the fuel or memory limit → optimize first, then raise the limits | It failed on the rc code. After optimization it passes | Optimized (e0c00d6). Limits are unchanged (5 MB, 200k rows) |
| Output ≤ 900 B, target ≤ 400 | 227 B in all 20 runs | OK |

## Notes

- `time_ms` and `instructions` are public on chain; what they reveal and what the buyer can steer is the [README trust table](../README.md#trust-table), Side channels row. A run that outlasts T_PAD, for example a stalled NEAR AI call plus a slow blob fetch, shows its real time.
- Not measured on testnet: the 5 MB max case. That would need a 5 MB FastFS upload, and the card measures the max case locally.
- FastFS: a newly uploaded file returned 404 for about 2.5 minutes before test.fastfs.io served it. `perf-testnet.ts` waits up to 10 minutes for it.

## Gas tank

The contract's NEAR balance (the tank) pays for every eval, whether or not the eval succeeds:

- OutLayer charge: 0.00570 NEAR for one eval (testnet run 8 above, rc `73415b8f…`, `Cost: 5702040000000000000000 yoctoNEAR`; the mainnet charge is not measured yet, Pending M8 in [JUDGES.md](../JUDGES.md#pending-ledger)); the rest of the 0.02 NEAR deposit comes back.
- Storage: a settled eval record takes about 580 bytes of contract state, about 0.0058 NEAR at 10^19 yoctoNEAR per byte. A failed eval writes the record too.
- Together: about 0.0115 NEAR per eval. A tank funded with 0.5 NEAR, less the 0.05 NEAR `tank_min` and one 0.02 NEAR deposit, covers about 37 evals before `op=eval` is refused with E10.
