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

### S0 · Funding · testnet PASS · mainnet PASS · 2026-11-10 22:05 GMT+7 [15:05Z] (accounts) · recorded 22:20 GMT+7 [15:20Z] (S-α WS1-T10)
- Commands: testnet: WS1-T05 (`arrowhq.testnet` + sub-accounts from the faucet, STATUS WS1-T05 row). Mainnet: human H-02 (10.3 NEAR + `arrowhq.near`), H-03 (Base USDC + ETH), H-04 (Solana), H-07 steps 1-5 (HANDOFFS.md single lines, near-cli-rs 0.31.1 sign-with-keychain).
- Evidence (mainnet, read back from the archival RPC 22:16-22:20 GMT+7; all in `evidence/mainnet.json`):
  - H-02 `arrowhq.near` created: https://nearblocks.io/txns/8n1EmZZ2gkkybgv3bhGjtMayjREip4ABVDQAWkThGqUP (10.3 NEAR).
  - H-07 step 1 `arrow-market.near` 0.1 NEAR: https://nearblocks.io/txns/4XThFxSVyyw8LnHHm5qNidm6YWBgJSxRz9htuUPMQQdP (block 223930848, linkdrop `near` → `true`; run `h07-arrow-market`).
  - H-07 step 2 `arrow-market-v2.near` 0.1 NEAR: https://nearblocks.io/txns/8yyb9GYXWTTZdoQ8FcszWQUGLRyDqS4cMnG4geoED6mG (block 223930861; `h07-arrow-market-v2`).
  - H-07 step 3 `arrow-relayer.arrowhq.near` 1.0 NEAR: https://nearblocks.io/txns/GrVY6srViMamYur4QTWBWNwe6ERStfA6hU63mLg6Qa9e (block 223930875; `h07-arrow-relayer`).
  - H-07 step 4 `arrow-spike.arrowhq.near` 1.7 NEAR: https://nearblocks.io/txns/5o1oxf7j2uNB4FVKFubtpFFEaU8LjhY1iTbAYxbnKVJv (block 223932491; `h07-arrow-spike`; deleted at H-08e).
  - H-07 step 5 relayer FunctionCall key `ed25519:3666zm…Kq1x`: https://nearblocks.io/txns/HxFJxjiz9iugECLRm8sL2siYCns58EUqA7MUGoLK3gXX (block 223932502; AddKey `{allowance null, receiver intents.near, methods [execute_intents]}`; `h07-relayer-fc-key`); `setup-relayer.ts --network mainnet --account arrow-relayer.arrowhq.near --check` OK (human run).
  - Base buyer: H-03 15.1 USDC + 0.0016 ETH (21:40); Solana: H-04 3.3 USDC + 0.002 SOL, USDC ATA exists.
  - State 22:16 GMT+7 (`view_account`, `view_access_key_list`): arrowhq.near 9.0611 NEAR (after the spike returned its balance), arrow-market.near 0.1, arrow-market-v2.near 0.1 (both no code), arrow-relayer.arrowhq.near 0.9936 NEAR with one FullAccess + the FunctionCall key above; arrow-spike.arrowhq.near UNKNOWN_ACCOUNT.
- PASS items: testnet funding PASS · mainnet accounts + relayer FC key PASS (S0 card: `arrowhq.near` ≥ 8 NEAR before H-07 → 10.3; EOA ≥ 15 USDC + ETH → 15.1 + 0.0016; NEAR AI 200 (S1-a); Solana ATA).
- Chosen path: unchanged plan (KU-06 budgets). Contract name `arrow-market.near` is ours (DEC D-02); `arrow-market-v2.near` reserved (D-07).
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

### S3a · Signature simulation · (i) PASS · (ii) PASS · 2026-11-10 16:10 / 22:07 GMT+7 [09:10Z / 15:07Z]
- Commands: (i) `npx tsx spikes/s3/s3a-simulate.ts` (S-δ under WS4-T04; WS1-T08 owner re-run 16:10). (ii) human H-08b: `npx tsx spikes/s3/s3a-simulate.ts --funded --gates-line` with the funded Arrow Buyer key (free `simulate_intents` view, nothing sent).
- Evidence: (i) unfunded throwaway EOA 0x4379…7e13, `insufficient balance or overflow` only (class SIGNATURE_OK_BALANCE_ERROR), results file 2026-11-10T09:10:35.923Z (commit 493f651). (ii) `spikes/s3/s3a-results.json` 2026-11-10T15:07:22.180Z: signer `0xb5ef360e42056049f584fd03bf0fb9b208e28387` (Arrow Buyer, Intents USDC 1.999596 after S4-a), transfer 10000 to `arrow-spike.arrowhq.near` with `msg {"mode":"refund_all"}` and `min_gas 300000000000000` in the signed payload → `error null`, `intents_executed 1`, **class OK**. No tx (simulation is a view).
- PASS items: (i) msg + min_gas carried, signature accepted, only balance error → PASS · (ii) funded simulate, neither a signature nor a balance error, `intents_executed 1` → PASS.
- Chosen path: SDK intent builder (ERC-191; WS-5 builds the same bytes with `IntentPayloadBuilder`, 9a0fac0). The same signer flow then executed for real in S3b/S3c below.
- Changed claim: none.

### S3b · Transfer notification + refund (mainnet) · PASS · 2026-11-10 22:07-22:08 GMT+7 [15:07-15:08Z] (H-08c; read back by S-α WS1-T10 22:18)
- Commands (human H-08c): (1) `near contract deploy arrow-spike.arrowhq.near use-file spikes/s3/spike-contract/target/near/spike.wasm with-init-call new …` (spike.wasm 150 703 B, sha256 e8d455c9…f265); (2) `npx tsx spikes/s3/s3b-notify.ts --mode refund_all`; (3) `… --mode keep`. Both send `execute_intents` from the relayer FC key.
- Evidence (mainnet):
  - spike deploy + init: https://nearblocks.io/txns/ERT9znZxK2EPfrhrVmTpTE3opUE4d1gsvBJuFC71aNGP (block 223932724, DeployContract + `new`, SuccessValue; run `spike-deploy`).
  - refund_all: https://nearblocks.io/txns/2oiKhXvjvmNmPtZB3oT2S5t2mNYNox1oTtJz6QsVEvsp (block 223932775; run `spike-s3b-refund_all`). Receipts: `execute_intents` → `mt_on_transfer` (arrow-spike returns `["10000"]`) → `intents.near` `mt_resolve_transfer` → `["0"]` kept; `mt_transfer` event back spike → buyer.
  - keep: https://nearblocks.io/txns/EVsShxK1d771UXpucrBFF5C6FryVgE4PfiT12f2PjaHB (block 223932849; run `spike-s3b-keep`).
  - Spike log in both txs: `S3_NOTIFY sender=0xb5ef360e42056049f584fd03bf0fb9b208e28387 prev=[0xb5ef…8387] tokens=["nep141:17208628…33a1"] amounts=[10000] msg={"mode":"refund_all"}` / `msg={"mode":"keep"}`.
  - Script lines (evidence observed): refund_all `buyer 1999596 -> 1999596, spike 0 -> 0; log ok; PASS`; keep `buyer 1999596 -> 1989596, spike 0 -> 10000; log ok; PASS`.
- PASS items: `S3b_log` sender = buyer `0x…` lower case, `msg` equals the signed payload's msg → PASS · `S3b_refund_all` buyer and spike unchanged → PASS · `S3b_keep` buyer −10000, spike +10000 → PASS.
- Chosen path: `PAYMENT_PATH = Notify` holds (K0 row 1).
- Changed claim: none (README keeps "intents.near's own `mt_resolve_transfer` refunds the buyer"; now shown on mainnet).

### S3c · OutLayer composition + B5 (mainnet) · PASS · 2026-11-10 22:10-22:13 GMT+7 [15:10-15:13Z] (H-08d; read back by S-α WS1-T10 22:18)
- Commands (human H-08d): `outlayer login mainnet` as arrow-spike (key piped from the keychain) + `outlayer secrets set … --profile arrow --wasm-hash 195508a1… --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-spike.arrowhq.near --build 195508a1…` (with NEARAI_API_KEY); `npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer` and `--mode outlayer_refund`; B5: `near contract call-function as-transaction outlayer.near request_execution file-args spikes/s3/out/b5-args.json … sign-as arrowhq.near`; then the secret was deleted and the testnet outlayer login restored. Agent read-back: `npx tsx spikes/s1/read-result.ts <tx> arrow-relayer.arrowhq.near --network mainnet`, `npx tsx spikes/s3/s3c-b5-negative.ts --read <b5_tx>`, archival `EXPERIMENTAL_tx_status` receipt list.
- Program: spike-tee wasm sha256 `195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e`, WasmUrl = the **testnet FastFS URL** (`https://test.fastfs.io/spike.arrowhq.testnet/outlayer.testnet/195508a1….wasm`): mainnet `outlayer.near` fetched it without a re-upload.
- Evidence (mainnet):

  | Run | tx | request_id | decision | enclave elapsed_ms (contract) | block → result (chain) | NEAR AI inside | skew_ms | attestation | balances (buyer / spike Intents USDC) |
  |---|---|---|---|---|---|---|---|---|---|
  | keep (`outlayer`) | `BTX324JzvDVZJa5dMxbK1bojhqkXZJwx2ii2qfnngP6q` (block 223933060) | 2917 | keep | 8 757 | 10.0 s (script: 10 957 ms to last receipt) | `ai_status 200`, 964 ms | 4 987 | 200, id 1342627 | 1989596 → 1979596 / 10000 → 20000 |
  | refund (`outlayer_refund`) | `9NvREUZ1pEqnjuTY8osX3E51knjCBS3LYCgNgybiezKj` (block 223933160) | 2918 | refund | 36 577 | 38.0 s (script: 39 088 ms) | `ai_status 0` after 30 016 ms (no HTTP status) | 3 691 | 200, id 1342639 | unchanged / unchanged |
  | B5 negative (arrowhq.near → outlayer.near direct) | `Bzzg22r9tRpUZrbKmJDHSBWLCtgXhEAV3Vj3wuSCwbsf` (block 223933331) | 2919 | — | — | — | — | — | 404 (no execution) | — |

  Receipt tree, both S3c txs (one tx each): `execute_intents` (relayer) → `intents.near` `mt_on_transfer` → `arrow-spike` `request_execution` → `outlayer.near` `on_execution_response` → `arrow-spike` `on_outlayer` (keep `["0"]`, refund `["10000"]`) → `intents.near` `mt_resolve_transfer`. Program output (404 B) in both: `ok true`, `t NEAR`, `net mainnet`, `pred arrow-spike.arrowhq.near`, `sender arrow-relayer.arrowhq.near`, `pm 0a1d5bd1` (secret present for the allowed caller), `tx`/`rid` equal the tx hash and request id. Attestation (`api.outlayer.ai/attestations/by-request/<id>`): `wasm_hash == 195508a1…`, `transaction_hash ==` the tx, `input_hash == sha256(input) == in_sha`, `output_hash == sha256(output)`, `has_tdx_quote` (both runs).
  B5: `execution_completed` failed with `Access denied by access condition — signer arrowhq.near, called from arrowhq.near`, `instructions: 0`, 0.019 NEAR of the 0.02 deposit refunded (1 mNEAR charged), final value `null`; `s3c-b5-negative --read` → `B5: PASS (no secret reached the other caller)`.
  Evidence runs: `spike-s3c-outlayer`, `spike-s3c-outlayer_refund`, `spike-s3c-b5-negative`.
- PASS items: `S3c_1_tree` decision in the same tx's receipt tree, execute_intents block → last receipt 10.0 s (keep) and 38.0 s (refund), both < 90 s; refund through `mt_resolve_transfer` → PASS · `S3c_2_B5` OutLayer null, pm never reached the other caller → PASS · `S3c_3_attestation` 200 on `api.outlayer.ai`, `wasm_hash == H` → PASS.
- **Refund path took 38 s, and what it means for the time guard:** the extra ~28 s is the NEAR AI call inside the enclave: it returned no HTTP status after 30.0 s (`ai_status 0`, `ai_ms 30016`), while the keep run's call answered 200 in 0.96 s. OutLayer, the yield callback and `mt_resolve_transfer` add the same few seconds as in the keep run. The refund decision itself is mode-driven (`outlayer_refund`), so the stall was incidental, but it is a real mainnet sample of a hung NEAR AI call. For Arrow's `eval`: the enclave caps the chat call at 35 s (`http.rs` CHAT deadline) and the blob fetch at 25 s, so a hung NEAR AI plus a slow blob ends inside the program at about 60 s + ~4-5 s block → worker start (mainnet skew_ms 4 987 / 3 691) ≈ 65 s, which is under the 90 s EVAL_DEADLINE: the guard does not trip on a stalled LLM, the program writes `{"v":1,"ok":false}` from the failed call, and the contract refunds (Invariant 11 path unchanged). `release` makes no NEAR AI call, so 60 s keeps a wide margin. Mainnet max |skew| 5.0 s ≤ 10 s → **I-10 stays 90 s / 60 s**, no enclave change before the freeze. Caveat: a 30 s stall now and then means a buyer may wait ~40 s for a refund; README/UI timing text should say "refund within about a minute", not "seconds".
- Chosen path: `PAYMENT_PATH = Notify` (K0 row 1); secret condition W1-03 form works on mainnet (K0 row 5); B5 = keystore Predecessor + WASM allowlist (K0 row 11); `/verify` hash claim confirmed on `api.outlayer.ai` (K0 row 7).
- Changed claim: none to the trust table (keystore Predecessor is enforced on mainnet). Doc debt: refund timing wording (see above).

### S4-a · 1Click inbound + Solana dry · PASS · inbound 2026-11-10 22:06 GMT+7 [15:06Z] (H-08a) · Solana dry 21:45 GMT+7 [14:45Z]
- Commands: agent `npx tsx spikes/s4/s4a-solana-dry.ts` (free, dry:true, seller Intents USDC → "Arrow Sol" Solana USDC); human H-08a `npx tsx spikes/s4/s4a-inbound.ts --amount 2`.
- Evidence: inbound Base tx https://basescan.org/tx/0xaef58959048af87eed58e7e062dd88b6e486720ea99a01c01b8ee7f439fdb9f4 (block 55663941; read-only Base RPC 22:18: status 1, from Arrow Buyer 0xb5ef…8387, one USDC `Transfer` of 2 000 000 to the 1Click deposit 0x93Cf0f8719e00dBBC7302Bebf7d8E46B12F3AB1a); 1Click status SUCCESS in 30 s; buyer Intents USDC 0 → 1 999 596 (+1.999596) (run `s4a-inbound-2026-11-10T15-06-34-833Z`). Live `mt_balance_of` 22:16 GMT+7: buyer 1 979 596 (after S3b keep −10000 and S3c keep −10000). Solana dry 21:45 → `dry quote 200 · amountIn 3 · amountOut 2.989698 · withdrawFee 9951 · timeEstimate 7 s` · `no ATA error` (`spikes/s4/s4a-solana-dry.json`); Arrow Sol USDC token account holds 3.3 USDC.
- PASS items: (inbound) SUCCESS 30 s < 120 s and buyer Intents +1.999596 ≈ 1.99 → PASS · (Solana dry) quote 200 + no ATA error → PASS.
- Chosen path: 1Click origin **Base USDC** (K0 row 10), `slippageTolerance 50`, no JWT needed.
- Changed claim: none.

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
**K0-testnet: DECIDED 2026-11-10 20:10 GMT+7 [13:10Z] (S-α WS1-T11). K0-mainnet: DECIDED 2026-11-10 22:20 GMT+7 [15:20Z] (S-α WS1-T11, early; was due 11 Kas 12:00 GMT+7 [05:00Z]).** The human ran H-07 and H-08a-e between 21:49 and 22:15 GMT+7; every mainnet gate (S0-mainnet, S3a(ii), S3b, S3c + B5, S4-a) PASSed and was read back from the chain by WS1-T10 (sections above, `evidence/mainnet.json`). All 11 rows are now FINAL; no row changed its value. H-24 (single hard stop) **N/A: not triggered**.

Gate rows: S0 testnet PASS / mainnet PASS · S1-a PASS · S1-b PASS (7: FastFS only) · S2 PASS · S3a (i) PASS / (ii) PASS · S3b PASS · S3c PASS (B5 PASS) · S4-a PASS · S4-b PASS. No row is PENDING or DEFERRED.

| # | Output | Decision | Evidence (rule from WS1-T11) | Status |
|---|---|---|---|---|
| 1 | `PAYMENT_PATH` | **`Notify`** (transfer notification: `mt_on_transfer` → OutLayer → `mt_resolve_transfer` refund) | Rule: S3b PASS and S3c(1) PASS → Notify. Mainnet: S3b refund_all 2oiKhXvj… (buyer unchanged), keep EVsShxK1… (−10000/+10000); S3c(1) keep BTX324Jz… 10.0 s and refund 9NvREUZ1… 38.0 s, one receipt tree each, refund by `intents.near` `mt_resolve_transfer`. Testnet: K2 9/9, sandbox `s2_mt_refund_on_null` | **FINAL** (K0-mainnet 22:20). `paths.rs` `DEFAULT_PAYMENT_PATH = Notify` unchanged; Escrow stays built and tested behind the switch; H-07b N/A |
| 2 | `RESULT_PATH` | **`Chain`** | S1-b (1)(2)(3) PASS with echo (6.9-8.9 s) and echo+ai (7.8-8.2 s); real rc evals with NEAR AI 10/10 settled on testnet, chain p95 59.7 s (WS3-T11b); K2 9/9. No S1-a fallback needed | FINAL (testnet evidence is the rule's input; S3c(1) re-checks the < 90 s tree on mainnet) |
| 3 | Model + parameters | **`Qwen/Qwen3.8-27B`, variant default (`chat_template_kwargs.enable_thinking=false`, `QwenNoThinking`), 40 rows**, `json_schema` strict, `temperature 0`, `max_tokens 64` | S1-a PASS: schema 10/10, reasoning 0, finish stop 10/10, p95 2 648 ms, model match (`spikes/s1/s1a-results.json`) | FINAL. Equals `consts.rs` `LLM = QWEN`: no enclave change |
| 4 | WasmUrl source | **rc: testnet FastFS. Final: S-02 fallback (Vercel static, else FastFS)** | S1-b (7): FastFS accepted in every run; raw GitHub NOT TESTED (repo private, DEC §K KU-03). If the human makes the repo public before the freeze, raw GitHub (commit-pinned) becomes primary again; the URL does not change after K3 | FINAL for now (KU-03) |
| 5 | Secret condition | **`outlayer secrets set … --wasm-hash <H> --generate PROTECTED_MASTER:hex32 --access allow-all --via <contract> --build <H>`** → `{"Logic":{"operator":"And","conditions":[{"WasmHash":{"hash":H}},{"Predecessor":…<contract>…}]}}` | S1-b secrets step (W1-03 form accepted; also used by WS1-T15 for `arrow.arrowhq.testnet`, access WasmHash 73415b8f… AND Predecessor) | FINAL |
| 6 | Time guard | **90 s eval / 60 s release** | max \|skew_ms\| = 5 575 (echo) / 3 955 (echo+ai) ≤ 10 000 (S1-b (6)); `consts.rs` EVAL_DEADLINE 90 s already | FINAL |
| 7 | `/verify` hash claim | **DEC O-03 row → REQUIRED**: `input_hash = sha256(stdin)`, `output_hash = sha256(stdout)` | S1-b (5): 7/7 testnet runs; S3c(3) mainnet: `api.outlayer.ai` attestation 200 for requests 2917 and 2918 with `wasm_hash`, `transaction_hash`, `input_hash`, `output_hash` all matching and `has_tdx_quote` | **FINAL** (testnet + mainnet) |
| 8 | ECIES profile | **`eciesjs 0.4.18` ↔ `ecies =0.2.11`** (default config), XChaCha20-Poly1305 nonce24‖ct‖tag | S4-b PASS (ecies 7/7 + 5/5, xchacha 4/4 + 4/4, minhash 8/8 + 8/8) | FINAL |
| 9 | Intent signature | **SDK builder** (ERC-191, `msg` + `min_gas` in the signed payload) | S3a(i) PASS; S3a(ii) PASS 22:07 (funded Arrow Buyer, `simulate_intents` class OK, `intents_executed 1`); the same payloads executed for real in S3b/S3c | **FINAL** |
| 10 | 1Click origin | **Base USDC** | S4-a PASS: Base tx 0xaef58959…b9f4, 1Click SUCCESS in 30 s, buyer Intents +1.999596 USDC; Solana dry quote 200, no ATA error | **FINAL** (Arbitrum stays the documented fallback, DEC E-02) |
| 11 | B5 | **keystore Predecessor + WASM allowlist** (both networks) | Testnet S1-b (4) PASS; mainnet S3c(2) PASS: arrowhq.near → outlayer.near direct with the spike's secrets_ref, tx Bzzg22r9…, request 2919 → `Access denied by access condition`, instructions 0, final value `null` | **FINAL**. Trust table keeps keystore Predecessor as enforced (no "WASM allowlist primary" row) |

- `contracts/arrow/src/paths.rs`: `DEFAULT_PAYMENT_PATH = PaymentPath::Notify`, `RESULT_PATH = ResultPath::Chain` (WS-2 wrote these defaults; they equal rows 1-2, so **no commit is needed at K0-testnet or K0-mainnet**). `paths_rs_matches` PASS.
- H-07b: **N/A** (Notify is final). H-24: N/A.
- Changed claims: none to the README trust table. Mainnet now shows "intents.near's own `mt_resolve_transfer` refunds the buyer" (S3b refund_all 2oiKhXvj…, S3c refund 9NvREUZ1…). Doc debt: refund timing wording ("within about a minute"; the mainnet refund sample took 38 s because a NEAR AI call stalled for 30 s, S3c section).
- Time guard (row 6) re-checked on mainnet: skew_ms 4 987 / 3 691 (≤ 10 s) → 90 s / 60 s stays; the 38 s refund run fits with ~50 s to spare (S3c section).
- WasmUrl (row 4): mainnet `outlayer.near` ran the spike from the testnet FastFS URL, so FastFS works on mainnet too; the final wasm path is unchanged (S-02 fallback while the repo is private).
