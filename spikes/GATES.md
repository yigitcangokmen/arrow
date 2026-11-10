# Arrow · Gate log (spikes/GATES.md)

One section per gate (PLAN App. A.4). Each gate records result, tx hashes, command, last lines of raw output, chosen path, changed claim. Anything not measured says `NOT MEASURED`. Edited only in the main checkout (W1-07). Times GMT+7 [UTC].

## Tool versions
Recorded by WS1-T01 (S-α), 2026-11-10 14:56 GMT+7 [07:56Z]. Already on the machine before T0 (DEC §K K-08): cargo-near, near-cli-rs, gitleaks, Node 24.15.0, Rust 1.97.1 + wasm32-unknown-unknown, Docker. Installed by WS1-T01: outlayer CLI (`cargo install --git https://github.com/out-layer/outlayer-cli --rev 9898d00cd084b601aa1af65829415fa7c3ce6873 --locked`; HEAD unchanged at install time), wasmtime (`brew install wasmtime`), `wasm32-wasip2` target for 1.97.1.

```
2026-11-10T07:56:48Z
cargo-near-near 0.23.0
near-cli-rs 0.31.1
outlayer 0.2.2
outlayer-cli rev 9898d00cd084b601aa1af65829415fa7c3ce6873
8.30.1
wasmtime 50.0.1 (c307ec81d 2026-10-29)
rustc 1.97.1 (8bab26f4f 2026-07-14)
cargo 1.97.1 (c980f4866 2026-06-30)
targets(1.97.1): aarch64-apple-darwin wasm32-unknown-unknown wasm32-wasip2 
v24.15.0
11.12.1
Docker version 29.4.0, build 9d7ad9f
```

Acceptance: `tools_versions_pinned` PASS · `outlayer_cli_present` PASS.

### S0 · Funding · testnet PASS · mainnet DEFERRED → 11 Kas 12:00 GMT+7 [05:00Z] (K0-mainnet, PLAN §4.0(4)/§4.3; waiting human funding) · recorded 2026-11-10 20:05 GMT+7 [13:05Z] (S-α WS1-T11)
- Commands: testnet: WS1-T05 (`arrowhq.testnet` + sub-accounts from the faucet, STATUS WS1-T05 row). Mainnet: human H-02 (10 NEAR + `arrowhq.near`, via the unfunded "Arrow NEAR" implicit account fd2407…0f88), H-03 (Base USDC), H-04 (Solana), H-07 (mainnet accounts + relayer FC key).
- Evidence: testnet accounts funded and used by S1-b, S2, K2 (`evidence/testnet.json`). Mainnet: none (H-02, H-03, H-07 OPEN at 20:05; money approved, DEC §K KU-06).
- PASS items: testnet funding PASS. Mainnet funding NOT DONE.
- Chosen path: unchanged plan (KU-06 budgets).
- Changed claim: none.

### S1-a · NEAR AI · PASS · 2026-11-10 19:57 GMT+7 [12:57Z] (S-α WS1-T06, ws/1-gates f69ee47)
- Commands (worktree `../arrow-ws-1`, key = H-01a NEAR Builders key in `.env`): `bash spikes/s1/ping.sh` → `HTTP 200`; `curl https://cloud-api.near.ai/v1/models` → `models 200` (12:57Z; one check, the card's 4×15 min retry is moot because it answered 200 at once); `npx tsx spikes/s1/s1a.ts --n 10` (defaults: `--model Qwen/Qwen3.8-27B --variant default --rows 40`).
- Request (same shape and field order as `arrow-core` `llm::request_body`; system prompt taken from `fixtures/llm-request-example.json`): `json_schema` `arrow_verdict` strict, `temperature 0`, `max_tokens 64`, `chat_template_kwargs.enable_thinking=false`, user message = criteria + 40 deterministic **synthetic** unlock rows (`token,unlock_date,amount,cliff_months`, `label: synthetic`) in the `<criteria-T>`/`<data-T>` spotlighting layout. 3 478 B request.
- Evidence: `spikes/s1/s1a-results.json` (per call: http, latency, model, finish_reason, token counts, reasoning_tokens, schema_ok; no content, no key). Last line: `schema 10/10 · reasoning 0 · finish stop 10/10 · p50 1561 ms · p95 2648 ms · model Qwen/Qwen3.8-27B · S1-a PASS`. Every call: HTTP 200, `completion_tokens 41`, `reasoning_tokens 0`.
- PASS items: `S1a_schema` 10/10 **PASS** · `S1a_reasoning_off` reasoning 0 ×10, finish `stop` ×10 (64 tokens are enough: 41 used) **PASS** · `S1a_latency` p95 2 648 ms < 25 000 **PASS** · `S1a_model` response `model == "Qwen/Qwen3.8-27B"` ×10 and `/v1/models` 200 **PASS**. No fallback step needed (no `/no_think`, no GLM, no 20-row cut).
- In the enclave (S1-b echo+ai, below): the spike's small call from inside OutLayer returned `ai_status 200` in 721-741 ms. Real rc evals with NEAR AI already settled on testnet (WS3-T11b 10/10, K2 9/9).
- Chosen path: model `Qwen/Qwen3.8-27B`, variant default = `QwenNoThinking` (`chat_template_kwargs.enable_thinking=false`), 40 sample rows. This is exactly `enclave/arrow-tee/src/consts.rs` `LLM = QWEN` → **no enclave change** for the freeze.
- Changed claim: none (README and the agent guide already name `Qwen/Qwen3.8-27B` with reasoning off).

### S1-b · OutLayer chain mode (testnet) · PASS (items 1-6 PASS with echo and echo+ai; item 7 PARTIAL: FastFS only, repo private) · 2026-11-10 15:18-15:22 + 20:00-20:01 GMT+7 [08:18-08:22Z + 13:00-13:01Z]
- Code: `spikes/s1/` (commit 94b037a on ws/1-gates): `spike-tee` (wasm32-wasip2, sha256 `195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e`, 516 690 B), `s1-spike` contract on `spike.arrowhq.testnet`, `read-result.ts`, `run.sh`. Local wasmtime (`-S http`): echo → JSON, stderr 0 B; `garbage` / empty / unknown mode → `{"v":1,"ok":false}`, exit 0, stderr 0 B; echo+ai with a bogus key → reached cloud-api.near.ai, `ai_status 401`.
- WasmUrl: **FastFS** (repo private, DEC K-03): `https://test.fastfs.io/spike.arrowhq.testnet/outlayer.testnet/195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e.wasm`, upload tx `3wRxLum9JcgqdNWwNBTgJZWRBboBDmzVqDgxyHCG4j56`; `curl -sL <url> | shasum -a 256` = H. (HEAD on that URL returns 404; GET serves the bytes.)
- Commands: `bash spikes/s1/run.sh fastfs|deploy|secrets|pos <n> echo true|neg` (deploy tx `8u4N7AHua283RLSrbvhFHCADoHVQE44BQB1ZdPe6ap81`). Signer of every positive run is `arrowhq.testnet` (≠ predecessor `spike.arrowhq.testnet`), deposit 0.02 NEAR, max_seconds 100.
- Secrets (W1-03 form accepted as written, `--build` accepted): `outlayer secrets set '{}' --profile arrow --wasm-hash H --generate PROTECTED_MASTER:hex32 --access allow-all --via spike.arrowhq.testnet --build H` → CLI: "Locked to build … Calls admitted only from: spike.arrowhq.testnet". **Predecessor JSON form** (`outlayer.testnet` view `list_user_secrets`): `{"accessor":{"WasmHash":{"hash":H}},"profile":"arrow","access":{"Logic":{"operator":"And","conditions":[{"WasmHash":{"hash":H}},{"Predecessor":{"condition":{"Whitelist":{"accounts":["spike.arrowhq.testnet"]}}}}]}}}`. NEARAI_API_KEY is NOT in the secret yet (no key in .env; H-01a).
- Evidence (testnet, https://testnet.nearblocks.io/txns/<hash>):

  | Run | tx | request_id | attestation id | S1B_RESULT | elapsed_ms_chain | contract elapsed_ms | pm | skew_ms |
  |---|---|---|---|---|---|---|---|---|
  | pos1 echo, secrets | `ED5VCvV6vyzosFm9bHA1BSA4dDkk3RxdLrC2jGuCqaRi` | 15488 | 27715 | ok | 8 901 | 8 265 | `27b9c0a1` | 5 575 |
  | pos2 echo, secrets | `4Q5eNqa3YbGuApELvMso2oZN9aeNd3GCjjJc3wTiEF5S` | 15490 | 27717 | ok | 6 917 | 6 325 | `27b9c0a1` | 3 519 |
  | pos3 echo, secrets | `8aPNegafPsKGkUPsKQe2Qf1qaYHhjyiY7ZwGVFVoBJah` | 15492 | 27719 | ok | 6 875 | 6 256 | `27b9c0a1` | 3 335 |
  | echo, no secrets | `DrzDWmzZ2LtokK8siP1ymvcjfnCf1X16c8Efcnw9wHge` | 15493 | 27720 | ok | 7 062 | 6 569 | null | 3 385 |
  | neg (attacker → OutLayer direct) | `smm9T86m4RU8grrrbHgAsSd3TeD5zkCuT4FH4tbugH6` | 15495 | 404 (no execution) | final value `null` | 1 288 | — | — | — |
  | pos4 echo+ai, secrets | `BkjtavBdNLngSN4p6WvB281mbPe5JX2QgFT1SpQ2WsoS` | 15923 | 31890 | ok | 8 218 | 7 700 | `61dd0ccf` | 3 955 |
  | pos5 echo+ai, secrets | `GtZNfvifv4RHCw6wHSedNuHEngc65LJkZrLeB43MUPUP` | 15925 | 31896 | ok | 7 853 | 7 298 | `61dd0ccf` | 3 480 |
  | pos6 echo+ai, secrets | `G3CcadmYYynW32zPAzmJr2Z2n9gE2XXc86JsRfRQPxTp` | 15926 | 31902 | ok | 7 832 | 7 248 | `61dd0ccf` | 3 511 |

  echo+ai runs (20:00-20:01 GMT+7 [13:00-13:01Z]): `bash spikes/s1/run.sh secrets` → "Secrets stored (profile: arrow, keys: NEARAI_API_KEY; protected (TEE): PROTECTED_MASTER)", list shows `WasmHash(195508a1...)` `(build:195508a1… and from:spike.arrowhq.testnet)`; then `bash spikes/s1/run.sh pos 4|5|6 echo+ai true`. Every run: `ai_key true`, **`ai_status 200`**, `ai_ms` 741 / 721 / 730, output 391 B, attestation `wasm_matches`, `tx_matches`, `input_hash == sha256(input) == in_sha`, `output_hash == sha256(output)`, `has_tdx_quote`. `pm` changed 27b9c0a1 → 61dd0ccf because `secrets` regenerates `PROTECTED_MASTER` (expected; the spike has no stored data). The global outlayer CLI login was set back to arrow.arrowhq.testnet afterwards. All 7 S1-b runs are in `evidence/testnet.json` (ids `s1b-pos1..6`, `s1b-neg`, kind spike).

- PASS items:
  - (1) **PASS**: echo 3/3 and echo+ai 3/3 `S1B_RESULT ok`, valid JSON, `ok:true` (394 B / 391 B).
  - (2) **PASS**: `pred == "spike.arrowhq.testnet"`, `net == "testnet"`, `t == "NEAR"`, `sender == "arrowhq.testnet"` in all 6 positive runs (pos1-6); `tx` and `rid` env vars are filled and equal the tx hash / request_id.
  - (3) **PASS**: tx block → callback block 6.9-8.9 s (echo) and 7.8-8.2 s (echo+ai, NEAR AI call 0.72-0.74 s inside the enclave), all < 90 s. The full rc eval (40-row prompt, T_PAD 45 s) settles in chain p95 59.7 s (WS3-T11b, docs/perf.md).
  - (4) **PASS**: attacker run → OutLayer `execution_completed` `success:false`, `error_message: "Access denied by access condition — signer attacker.arrowhq.testnet, called from attacker.arrowhq.testnet …"`, `instructions 0`, final value `null`; `27b9c0a1` never appears in the attacker output.
  - (5) **PASS**: attestation 200 (`/attestations/by-request/<id>`), `has tdx_quote`, `wasm_hash == H`, `transaction_hash ==` the run tx; **`input_hash == sha256(input string) == in_sha` (stdin bytes)** and **`output_hash == sha256(output bytes)`** in all 7 runs (pos1-6 + no-secret) → `/verify` may claim input and output hashes (DEC O-03 row can move to REQUIRED).
  - (6) **PASS**: `bts` filled in all runs; `skew_ms = wall − NEAR_BLOCK_TIMESTAMP` = 5 575 / 3 519 / 3 335 (+ 3 385 no-secret run; echo+ai 3 955 / 3 480 / 3 511); **max |skew| = 5.6 s ≤ 10 s → I-10 thresholds stay 90 s (eval) / 60 s (release)**. Note: this value includes block → worker start latency, so it is an upper bound on clock skew.
  - (7) **PARTIAL**: FastFS URL accepted (all runs). Raw GitHub NOT TESTED (repo private, K-03; raw URL not reachable). Final wasm path stays S-02 fallback (Vercel static → FastFS) unless the repo goes public.
- Chosen path: **RESULT_PATH = Chain** (chain mode with yield callback, raw `promise_result_checked(0, 1024)`, null → refund); WasmUrl = testnet FastFS; secret condition = `--access allow-all --via <contract> --build <H>` (W1-03, unchanged); I-10 = 90 s / 60 s (max |skew| 5.6 s).
- Changed claim: none. `/verify` can state the input/output hash binding (7/7 testnet runs; mainnet confirmation is S3c(3)).

### S2 · Testnet token + refund · PASS · 2026-11-10 15:29-15:32 GMT+7 [08:29-08:32Z] (S-γ, ws/2-contracts f6075ab)
- Commands (worktree `../arrow-ws-2`): build `cargo near build non-reproducible-wasm --manifest-path contracts/arrow-usd/Cargo.toml --no-abi --locked --out-dir target/near/variants/arrow-usd` (arrow_usd.wasm 152497 B, sha256 4c7921ab…a727), same for `contracts/mock-outlayer` (199419 B) and `spikes/s2/receiver` (`--out-dir spikes/s2/receiver/target/near/s2-receiver`, 140495 B); sandbox `cargo test --manifest-path spikes/s2/receiver/Cargo.toml --test s2 -- --test-threads=2` → `test result: ok. 6 passed; 0 failed` (27 s); testnet `bash spikes/s2/run-testnet.sh` → `S2-TESTNET PASS`.
- Evidence (testnet, accounts `arrowhq.testnet` buyer, `arrow-usd.arrowhq.testnet`, `s2.arrowhq.testnet` receiver):
  - s2-001 deploy arrow-usd + `new`: https://testnet.nearblocks.io/txns/DKcmuQZfqyXg4MprUqKqqJL9XADcL4hrCeWcTQ2LG7sL (ft_metadata symbol aUSD, decimals 6)
  - s2-002 deploy S2 receiver (`new {"outlayer":"outlayer.testnet"}`): https://testnet.nearblocks.io/txns/FEfdg5PzmUAG5H2C4eZstM6HYadmnEP38DiQ7W9pyJxD
  - s2-003 mint 10000000 to arrowhq.testnet: https://testnet.nearblocks.io/txns/FigU6Yju4aSxCmJtjnmUECcTCLbHiZUebpT1AGMSytwH (0 → 10000000)
  - s2-004 mint 10000001 rejected ("Arrow-USD: mint cap is 10 USDC per call"): https://testnet.nearblocks.io/txns/9VEBgna2bjfFLFa2efZjPamL7H6tYsu9kzDkxjpcSd1K
  - s2-005 `ft_transfer_call(s2, 100000, "refund_all")`: https://testnet.nearblocks.io/txns/5toQSSaeNKNYyE1WAmEeZtMFwCvyLptKgraS1DT5srrV (buyer 10000000 → 10000000, receiver 0 → 0)
  - s2-006 `ft_transfer_call(s2, 100000, "keep")`: https://testnet.nearblocks.io/txns/Ajx43mbGw8pv6fWTPW5FCAww9bvwhux2DzhWh3uuKtzH (buyer 10000000 → 9900000, receiver 0 → 100000)
  - Imported into `evidence/testnet.json` at 16:07 GMT+7 [09:07Z] by S-α (WS1-T05) with `scripts/src/evidence-add.ts --file` (ws/1-gates b86a8f3 = main f8e198c): runs s2-001..006, block heights 277043102..277043205 from the archival RPC, `commit` = 2510d4e (main's rebased copy of f6075ab; spikes/s2 identical). The jsonl kinds `mint`, `mint_cap`, `refund_all`, `keep` are not in the evidence schema (PLAN A.3), so s2-003..006 are `kind:"spike"` with the original label kept as the `expect` prefix (e.g. `mint: buyer +10000000`); s2-001/002 stay `deploy`.
- PASS items: (1) **PASS** arrow-usd deployed + public mint OK, `ft_balance_of(arrowhq.testnet)` = 10000000, over-cap mint rejected. (2) **PASS** refund_all leaves both balances unchanged, keep moves exactly 100000. (3) **PASS (sandbox)** mock OutLayer `null` → receiver returns the full amount, `EVENT_JSON … "event":"arrow_refund" … "reason":"null"`, buyer balance restored (`s2_ft_refund_on_null`), intents rail returns `["100000"]` (`s2_mt_refund_on_null`). (4) **PASS (sandbox)** mock `never` (yield, no resume) + `fast_forward(210)` → yield callback answers `null` → same refund on both rails (`s2_ft_refund_on_yield_timeout`, `s2_mt_refund_on_yield_timeout`); the sandbox fallback (real OutLayer sleeping wasm) was not needed.
- Chosen path: arrow-usd (own NEP-141 with public capped mint) on testnet + raw `promise_result_checked` callback that maps `null`/error to a full refund in the rail's shape (`"n"` for NEP-141, `["n"]` for intents). Callers of `ft_transfer_call` attach 300 TGas + 1 yocto.
- Changed claim: none.
- Tool versions: near-cli-rs 0.31.1, cargo-near 0.23.0, rustc 1.97.1, near-workspaces 0.24.0 (sandbox binary from near-sandbox 0.4.0 cache).

### S3a · Signature simulation · (i) PASS (WS1-T08 acceptance re-run 16:10 GMT+7 [09:10Z]) · (ii) DEFERRED → 11 Kas 12:00 GMT+7 [05:00Z] (K0-mainnet; waiting H-08b) · 2026-11-10 15:26 / 16:10 GMT+7 [08:26Z / 09:10Z]
- Commands: `npx tsx spikes/s3/s3a-simulate.ts` (S-δ under WS4-T04; script and result on main since a055271). (ii): `npx tsx spikes/s3/s3a-simulate.ts --funded` after H-03 funding (H-08b).
- Evidence: `spikes/s3/s3a-results.json` (2026-11-10T08:26:32Z): signed ERC-191 transfer intent to `arrow-spike.arrowhq.near` with `msg` and `min_gas` in the signed payload; mainnet `simulate_intents` → `insufficient balance or overflow` only (class SIGNATURE_OK_BALANCE_ERROR).
- PASS items: (i) msg + min_gas carried, signature accepted, only balance error → PASS (WS-4 run 15:26; WS1-T08 owner re-run 16:10 on ws/1-gates 87ee813 (= main 493f651) with a fresh in-memory EOA 0x4379…7e13: `payload carries msg: yes · min_gas: yes`, `class: SIGNATURE_OK_BALANCE_ERROR`, `insufficient balance or overflow` only; `spikes/s3/s3a-results.json` timestamp 2026-11-10T09:10:35.923Z). Nothing signed with a team wallet, nothing sent. (ii) funded simulate WAITING H-08b.
- Chosen path: SDK intent builder (S3a(i) PASS; WS-5 now builds the same payload bytes with `IntentPayloadBuilder`, 9a0fac0).
- Changed claim: —

### S3b · Transfer notification + refund (mainnet) · DEFERRED → 11 Kas 12:00 GMT+7 [05:00Z] (K0-mainnet, PLAN §4.0(4)/§4.3; waiting human funding) (mainnet run = H-08c; dry PASS 16:09 GMT+7 [09:09Z]) · —
- Commands: `npx tsx spikes/s3/s3b-notify.ts --mode refund_all|keep [--dry]` (main a9936a0, was ws/1-gates 73115a5; shared flow `spikes/s3/intent-run.ts`).
- Evidence: dry only: `--mode refund_all --dry` and `--mode keep --dry` → `payload carries msg: yes · min_gas: yes`, `class: SIGNATURE_OK_BALANCE_ERROR` (throwaway in-memory EOA, free mainnet `simulate_intents` view, nothing sent). Real runs write `evidence/mainnet.json` ids `spike-s3b-refund_all` / `spike-s3b-keep`.
- PASS items: dry_runs_ok (WS1-T09) PASS. Gate items wait H-08c (human: deploy + two runs). The real-send path (near-api-js `Account.callFunctionRaw` from the relayer FC key) is type-checked only; it cannot be exercised without mainnet funds.
- Chosen path: —
- Changed claim: —

### S3c · OutLayer composition + B5 (mainnet) · DEFERRED → 11 Kas 12:00 GMT+7 [05:00Z] (K0-mainnet, PLAN §4.0(4)/§4.3; waiting human funding) (mainnet run = H-08d; dry PASS 16:09 GMT+7 [09:09Z]) · —
- Commands: `npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer|outlayer_refund [--dry]` (main a9936a0, was ws/1-gates 73115a5), `spikes/s3/s3c-b5-negative.ts --prepare | --read <tx>`.
- Evidence: dry only: `--mode outlayer --dry` and `--mode outlayer_refund --dry` → `payload carries msg: yes · min_gas: yes`, `class: SIGNATURE_OK_BALANCE_ERROR` (throwaway EOA, free view, nothing sent). Real runs write `evidence/mainnet.json` ids `spike-s3c-outlayer` / `spike-s3c-outlayer_refund`.
- PASS items: dry_runs_ok (WS1-T09) PASS. Gate items wait H-08d (also needs `NEARAI_API_KEY`, H-01a, for the echo+ai program). Real-send path type-checked only.
- Chosen path: —
- Changed claim: —

### S4-a · 1Click inbound + Solana dry · DEFERRED → 11 Kas 12:00 GMT+7 [05:00Z] (K0-mainnet, PLAN §4.0(4)/§4.3) · Solana dry PASS 2026-11-10 21:45 GMT+7 [14:45Z]; inbound waits H-08a (READY 21:55: H-03 funded) · —
- Commands: agent `npx tsx spikes/s4/s4a-solana-dry.ts` (free, dry:true, seller Intents USDC → "Arrow Sol" Solana USDC); human H-08a `npx tsx spikes/s4/s4a-inbound.ts --amount 2` (HANDOFFS.md H-08a line).
- Evidence: Solana dry 21:45 → `dry quote 200 · amountIn 3 · amountOut 2.989698 (2989698) · withdrawFee 9951 · timeEstimate 7 s` · `no ATA error`, exit 0, `spikes/s4/s4a-solana-dry.json` (no addresses stored). Read-only Solana RPC `getTokenAccountsByOwner` (USDC mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) for the H-04 address → one token account holding 3.3 USDC, so the ATA exists. Inbound dry 21:47 with the funded buyer → `Base USDC 15.1 · ETH 0.0016 · dry quote 200 · amountOut 1.999596 · timeEstimate 35 s`. Paid inbound: none yet.
- PASS items: (Solana dry) quote 200 + no ATA error PASS · (inbound) SUCCESS < 120 s and buyer Intents +≈1.99: NOT MEASURED (H-08a).
- Chosen path: —
- Changed claim: —

### S4-b · ECIES/XChaCha/MinHash interop · PASS · 2026-11-10 15:45 GMT+7 [08:45Z] (official run on the integrated tree, S-α WS1-T14)
- Official run 15:45 GMT+7 [08:45Z], integration worktree `../arrow-int` at int/4-sdk 9a837a5 (= main after ws/2-contracts, ws/3-enclave and ws/4-sdk merged; no S4_FIXTURES_DIR): `cargo run -p s4-interop --release` → `ecies ts->rs: 7/7 PASS` · `ecies rs->ts: 5/5 PASS` · `xchacha ts->rs: 4/4 PASS` · `xchacha rs->ts: 4/4 PASS` · `minhash ts->rs: 8/8 PASS` · `minhash rs self-check: 8/8 PASS` · `RESULT: PASS`. TS side same tree: `npx vitest run` → 16 files passed, 127 tests passed, 1 skipped (ARROW_E2E network test); `crypto.interop.test.ts` ecies_rs_to_ts_unseal + xchacha_rs_to_ts_decrypt PASS. `gen-crypto-vectors.ts --check` → OK (xchacha byte-equal, ecies 7/7 unseal); `gen-minhash-vectors.ts --check` → OK byte-equal. `cargo test -p arrow-core --test fixtures_golden -- --include-ignored` → 6 passed incl. `minhash_matches_ts_vectors` (still `#[ignore]` in the tree; WS-3 removes the attribute). The run left no diff in fixtures/.
- Commands: `cargo run -p s4-interop --release` (branch ws/3-enclave 646d759 + c23d5ca; ecies 0.2.11 in Cargo.lock, eciesjs 0.4.18 in package-lock)
- Evidence (official run on ws/3-enclave): `ecies ts->rs: PENDING (fixtures/ecies-vectors.json missing)` · `ecies rs->ts: 5/5 PASS (fixtures/ecies-vectors-rs.json, self-check)` · `xchacha ts->rs: PENDING` · `xchacha rs->ts: 4/4 PASS (fixtures/xchacha-vectors-rs.json)` · `minhash ts->rs: PENDING (fixtures/minhash-vectors.json missing)` · `minhash rs self-check: 8/8 PASS` · `RESULT: PENDING`
- Dry runs (scratch, not gate evidence): eciesjs 0.4.18 unsealed 5/5 of the Rust ciphertexts; @noble/ciphers 2.4.0 opened 4/4 Rust blobs; eciesjs-sealed probe vectors (default config, 7 cases incl. 1 B and 2975 B) opened in Rust 7/7, noble XChaCha probes 4/4; an independent Node 24 implementation of the fixtures/README MinHash definition matched fixtures/minhash-vectors-rs.json 8/8.
- Cross-branch run 15:35 GMT+7 [08:35Z] (WS-4's committed vectors from ws/4-sdk 24f6f44 copied to scratch, `S4_FIXTURES_DIR=<copy> cargo run -p s4-interop --release`): `ecies ts->rs: 7/7 PASS` (eciesjs@0.4.18, idx0-idx6) · `xchacha ts->rs: 4/4 PASS` · `minhash ts->rs: 8/8 PASS` · `RESULT: PASS`. S-δ reports `sdk/test/crypto.interop.test.ts` green against the -rs files (STATUS WS-4 row). Both directions pass on the branches; the official PASS line is written after ws/3-enclave and ws/4-sdk are both on main and the command above runs without S4_FIXTURES_DIR.
- PASS items: (1) ECIES ts->rs 7/7 (cross-branch) · (2) XChaCha ts->rs 4/4 (cross-branch) · (3) MinHash ts->rs 8/8 (cross-branch) · rs->ts files written (5 + 4), TS interop test green per S-δ. PASS = ts->rs 7/7 + 4/4 + crypto.interop.test.ts green (WS4-T02 DoD). Re-run the command above after WS4-T02/T03 land on main; "pending" is not PASS.
- Re-run 15:51 GMT+7 [08:51Z] on main f477d7e (after the KU-10 rebase of the ws/6-data part; `../arrow-int`, no S4_FIXTURES_DIR): `cargo run -p s4-interop --release` → ecies ts->rs 7/7, rs->ts 5/5, xchacha 4/4 + 4/4, minhash ts->rs 8/8, rs self-check 8/8, `S4-b RESULT: PASS`; `npx vitest run sdk/test/crypto.interop.test.ts` → 2 passed; `cargo test -p arrow-core --test fixtures_golden -- --include-ignored` → 6 passed; tree unchanged after the run.
- Chosen path: default (ecies 0.2.11 pure <-> eciesjs 0.4.x default config, XChaCha20-Poly1305 nonce24||ct||tag), no fallback needed so far.
- Changed claim: —

## K0 decision
**K0-testnet: DECIDED 2026-11-10 20:10 GMT+7 [13:10Z] (S-α WS1-T11). K0-mainnet: PENDING → 11 Kas 12:00 GMT+7 [05:00Z]** (PLAN §4.0(4) and §4.3 K0 NO-GO line: the mainnet gates S0-mainnet, S3a(ii), S3b, S3c, S4-a could not run because the human funding steps H-02/H-03/H-07/H-08a-d are still open; the build continues on both payment paths). K0 was due min(10 Kas 21:00 + Δ, 11 Kas 09:00) = 11 Kas 05:49 GMT+7 [10 Kas 22:49Z]; decided early on the evidence below. H-24 (single hard stop) **N/A: not triggered** (chain mode works on testnet with and without the NEAR AI call).

Gate rows: S0 testnet PASS / mainnet DEFERRED · S1-a PASS · S1-b PASS (7: FastFS only) · S2 PASS · S3a (i) PASS / (ii) DEFERRED · S3b DEFERRED · S3c DEFERRED · S4-a DEFERRED · S4-b PASS. No row is left PENDING; every DEFERRED row points to 11 Kas 12:00.

| # | Output | Decision | Evidence (rule from WS1-T11) | Status |
|---|---|---|---|---|
| 1 | `PAYMENT_PATH` | **`Notify`** (transfer notification: `mt_on_transfer` → OutLayer → `mt_resolve_transfer` refund) | Rule: S3b PASS and S3c(1) PASS → Notify; mainnet gates not run → provisional Notify, final at K0-mainnet. Testnet: the notify-shaped flow (NEP-141 `ft_on_transfer` arm) is green end to end, K2 `E2E testnet: 9/9 steps green` incl. a broken-host eval refunded with both events (WS4-T10); sandbox `s2_mt_refund_on_null` returns `["100000"]` (S2). Escrow is built and tested behind the same switch (WS2-T10, `ARROW_PAYMENT_PATH=escrow` 10 tests) | PROVISIONAL → K0-mainnet 11 Kas 12:00. If S3b or S3c(1) FAILs: flip `DEFAULT_PAYMENT_PATH` to `Escrow`, run `new-near-keypair.ts --env RELAYER_ESCROW_PRIVATE_KEY`, write the H-07b block |
| 2 | `RESULT_PATH` | **`Chain`** | S1-b (1)(2)(3) PASS with echo (6.9-8.9 s) and echo+ai (7.8-8.2 s); real rc evals with NEAR AI 10/10 settled on testnet, chain p95 59.7 s (WS3-T11b); K2 9/9. No S1-a fallback needed | FINAL (testnet evidence is the rule's input; S3c(1) re-checks the < 90 s tree on mainnet) |
| 3 | Model + parameters | **`Qwen/Qwen3.8-27B`, variant default (`chat_template_kwargs.enable_thinking=false`, `QwenNoThinking`), 40 rows**, `json_schema` strict, `temperature 0`, `max_tokens 64` | S1-a PASS: schema 10/10, reasoning 0, finish stop 10/10, p95 2 648 ms, model match (`spikes/s1/s1a-results.json`) | FINAL. Equals `consts.rs` `LLM = QWEN`: no enclave change |
| 4 | WasmUrl source | **rc: testnet FastFS. Final: S-02 fallback (Vercel static, else FastFS)** | S1-b (7): FastFS accepted in every run; raw GitHub NOT TESTED (repo private, DEC §K KU-03). If the human makes the repo public before the freeze, raw GitHub (commit-pinned) becomes primary again; the URL does not change after K3 | FINAL for now (KU-03) |
| 5 | Secret condition | **`outlayer secrets set … --wasm-hash <H> --generate PROTECTED_MASTER:hex32 --access allow-all --via <contract> --build <H>`** → `{"Logic":{"operator":"And","conditions":[{"WasmHash":{"hash":H}},{"Predecessor":…<contract>…}]}}` | S1-b secrets step (W1-03 form accepted; also used by WS1-T15 for `arrow.arrowhq.testnet`, access WasmHash 73415b8f… AND Predecessor) | FINAL |
| 6 | Time guard | **90 s eval / 60 s release** | max \|skew_ms\| = 5 575 (echo) / 3 955 (echo+ai) ≤ 10 000 (S1-b (6)); `consts.rs` EVAL_DEADLINE 90 s already | FINAL |
| 7 | `/verify` hash claim | **DEC O-03 row → REQUIRED**: `input_hash = sha256(stdin)`, `output_hash = sha256(stdout)` | S1-b (5): 7/7 testnet runs, attestation 200 with `has_tdx_quote`, `wasm_hash` and `transaction_hash` match | FINAL on testnet; S3c(3) confirms on `api.outlayer.ai` |
| 8 | ECIES profile | **`eciesjs 0.4.18` ↔ `ecies =0.2.11`** (default config), XChaCha20-Poly1305 nonce24‖ct‖tag | S4-b PASS (ecies 7/7 + 5/5, xchacha 4/4 + 4/4, minhash 8/8 + 8/8) | FINAL |
| 9 | Intent signature | **SDK builder** (ERC-191, `msg` + `min_gas` in the signed payload) | S3a(i) PASS (`simulate_intents` → balance error only); S3a(ii) funded simulate DEFERRED | FINAL for the builder; S3a(ii) re-checks with funds |
| 10 | 1Click origin | **Base USDC** (provisional) | S4-a not run (H-08a waits H-03) | PROVISIONAL → K0-mainnet. FAIL → Arbitrum USDC |
| 11 | B5 | **testnet: keystore Predecessor + WASM allowlist** | Testnet counterpart S1-b (4) PASS: attacker → `Access denied by access condition`, final value `null`, `pm` absent. Mainnet B5 = S3c(2) not run | PROVISIONAL → K0-mainnet. FAIL → trust table row "WASM allowlist primary" |

- `contracts/arrow/src/paths.rs`: `DEFAULT_PAYMENT_PATH = PaymentPath::Notify`, `RESULT_PATH = ResultPath::Chain` (WS-2 wrote these defaults; they equal rows 1-2, so **no commit is needed at K0-testnet**). `paths_rs_matches` PASS.
- H-07b: **N/A while Notify** (only opens if K0-mainnet picks Escrow). H-24: N/A.
- Changed claims: none at K0-testnet (README keeps "intents.near's own `mt_resolve_transfer` refunds the buyer", pending S3b/S3c). If K0-mainnet picks Escrow: "the Arrow contract refunds the buyer" (Doc debt line from WS-2 T10).
- K0-mainnet (11 Kas 12:00 GMT+7 [05:00Z]) needs: H-02 → H-07 → H-08a (S4-a) → H-08b (S3a(ii)) → H-08c (S3b) → H-08d (S3c + B5), then WS1-T10 reads them and fills rows 1, 10, 11 here. If they still cannot run by then, rows 1/10/11 stay at their provisional values and the README states the mainnet refund path as unproven until K4.
