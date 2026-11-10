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

### S0 · Funding · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S1-a · NEAR AI · WAITING H-01a (no `NEARAI_API_KEY` in .env at 2026-11-10 15:12 GMT+7 [08:12Z]) · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S1-b · OutLayer chain mode (testnet) · PARTIAL: echo runs PASS (7 items below), echo+ai runs WAITING H-01a · 2026-11-10 15:18-15:22 GMT+7 [08:18-08:22Z]
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

- PASS items:
  - (1) **PASS** (echo): 3/3 `S1B_RESULT ok`, valid JSON, `ok:true`, 394 B. echo+ai 3/3: **WAITING H-01a**.
  - (2) **PASS**: `pred == "spike.arrowhq.testnet"`, `net == "testnet"`, `t == "NEAR"`, `sender == "arrowhq.testnet"` in all 3; `tx` and `rid` env vars are filled and equal the tx hash / request_id.
  - (3) **PASS** (echo): tx block → callback block 6.9-8.9 s (< 90 s). With the NEAR AI call: **WAITING H-01a**.
  - (4) **PASS**: attacker run → OutLayer `execution_completed` `success:false`, `error_message: "Access denied by access condition — signer attacker.arrowhq.testnet, called from attacker.arrowhq.testnet …"`, `instructions 0`, final value `null`; `27b9c0a1` never appears in the attacker output.
  - (5) **PASS**: attestation 200 (`/attestations/by-request/<id>`), `has tdx_quote`, `wasm_hash == H`, `transaction_hash ==` the run tx; **`input_hash == sha256(input string) == in_sha` (stdin bytes)** and **`output_hash == sha256(output bytes)`** in all 4 runs → `/verify` may claim input and output hashes (DEC O-03 row can move to REQUIRED).
  - (6) **PASS**: `bts` filled in all runs; `skew_ms = wall − NEAR_BLOCK_TIMESTAMP` = 5 575 / 3 519 / 3 335 (+ 3 385 no-secret run); **max |skew| = 5.6 s ≤ 10 s → I-10 thresholds stay 90 s (eval) / 60 s (release)**. Note: this value includes block → worker start latency, so it is an upper bound on clock skew.
  - (7) **PARTIAL**: FastFS URL accepted (all runs). Raw GitHub NOT TESTED (repo private, K-03; raw URL not reachable). Final wasm path stays S-02 fallback (Vercel static → FastFS) unless the repo goes public.
- Remaining after H-01a: `bash spikes/s1/run.sh secrets` (adds NEARAI_API_KEY, regenerates PROTECTED_MASTER) then `bash spikes/s1/run.sh pos 4|5|6 echo+ai true` → items (1) and (3) with AI, `ai_status`/`ai_ms`.
- Chosen path: WasmUrl = testnet FastFS; secret condition = `--access allow-all --via <contract> --build <H>` (W1-03, unchanged); RESULT_PATH proposal: chain mode with yield callback (raw `promise_result_checked(0, 1024)`, null → refund) works on testnet.
- Changed claim: none yet. `/verify` can state input/output hash binding (testnet observation).

### S2 · Testnet token + refund · PASS · 2026-11-10 15:29-15:33 GMT+7 [08:29-08:33Z] (S-γ, ws/2-contracts f6075ab)
- Commands (worktree `../arrow-ws-2`): build `cargo near build non-reproducible-wasm --manifest-path contracts/arrow-usd/Cargo.toml --no-abi --locked --out-dir target/near/variants/arrow-usd` (arrow_usd.wasm 152497 B, sha256 4c7921ab…a727), same for `contracts/mock-outlayer` (199419 B) and `spikes/s2/receiver` (`--out-dir spikes/s2/receiver/target/near/s2-receiver`, 140495 B); sandbox `cargo test --manifest-path spikes/s2/receiver/Cargo.toml --test s2 -- --test-threads=2` → `test result: ok. 6 passed; 0 failed` (27 s); testnet `bash spikes/s2/run-testnet.sh` → `S2-TESTNET PASS`.
- Evidence (testnet, accounts `arrowhq.testnet` buyer, `arrow-usd.arrowhq.testnet`, `s2.arrowhq.testnet` receiver):
  - s2-001 deploy arrow-usd + `new`: https://testnet.nearblocks.io/txns/DKcmuQZfqyXg4MprUqKqqJL9XADcL4hrCeWcTQ2LG7sL (ft_metadata symbol aUSD, decimals 6)
  - s2-002 deploy S2 receiver (`new {"outlayer":"outlayer.testnet"}`): https://testnet.nearblocks.io/txns/FEfdg5PzmUAG5H2C4eZstM6HYadmnEP38DiQ7W9pyJxD
  - s2-003 mint 10000000 to arrowhq.testnet: https://testnet.nearblocks.io/txns/FigU6Yju4aSxCmJtjnmUECcTCLbHiZUebpT1AGMSytwH (0 → 10000000)
  - s2-004 mint 10000001 rejected ("Arrow-USD: mint cap is 10 USDC per call"): https://testnet.nearblocks.io/txns/9VEBgna2bjfFLFa2efZjPamL7H6tYsu9kzDkxjpcSd1K
  - s2-005 `ft_transfer_call(s2, 100000, "refund_all")`: https://testnet.nearblocks.io/txns/5toQSSaeNKNYyE1WAmEeZtMFwCvyLptKgraS1DT5srrV (buyer 10000000 → 10000000, receiver 0 → 0)
  - s2-006 `ft_transfer_call(s2, 100000, "keep")`: https://testnet.nearblocks.io/txns/Ajx43mbGw8pv6fWTPW5FCAww9bvwhux2DzhWh3uuKtzH (buyer 10000000 → 9900000, receiver 0 → 100000)
  - Runs are in `../arrow-ws-2/spikes/s2/out/runs.jsonl` (gitignored) because `scripts/src/evidence-add.ts` is not on main yet; import with `--file` when it lands (not yet in evidence/testnet.json).
- PASS items: (1) **PASS** arrow-usd deployed + public mint OK, `ft_balance_of(arrowhq.testnet)` = 10000000, over-cap mint rejected. (2) **PASS** refund_all leaves both balances unchanged, keep moves exactly 100000. (3) **PASS (sandbox)** mock OutLayer `null` → receiver returns the full amount, `EVENT_JSON … "event":"arrow_refund" … "reason":"null"`, buyer balance restored (`s2_ft_refund_on_null`), intents rail returns `["100000"]` (`s2_mt_refund_on_null`). (4) **PASS (sandbox)** mock `never` (yield, no resume) + `fast_forward(210)` → yield callback answers `null` → same refund on both rails (`s2_ft_refund_on_yield_timeout`, `s2_mt_refund_on_yield_timeout`); the sandbox fallback (real OutLayer sleeping wasm) was not needed.
- Chosen path: arrow-usd (own NEP-141 with public capped mint) on testnet + raw `promise_result_checked` callback that maps `null`/error to a full refund in the rail's shape (`"n"` for NEP-141, `["n"]` for intents). Callers of `ft_transfer_call` attach 300 TGas + 1 yocto.
- Changed claim: none.
- Tool versions: near-cli-rs 0.31.1, cargo-near 0.23.0, rustc 1.97.1, near-workspaces 0.24.0 (sandbox binary from near-sandbox 0.4.0 cache).

### S3a · Signature simulation · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S3b · Transfer notification + refund (mainnet) · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S3c · OutLayer composition + B5 (mainnet) · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S4-a · 1Click inbound + Solana dry · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S4-b · ECIES/XChaCha/MinHash interop · PENDING (Rust side done; ts->rs waits WS4-T02/T03 vectors, rs->ts waits sdk/test/crypto.interop.test.ts) · 2026-11-10 15:29 GMT+7 [08:29Z]
- Commands: `cargo run -p s4-interop --release` (branch ws/3-enclave 9248156 + c331e19; ecies 0.2.11 in Cargo.lock, eciesjs 0.4.18 in package-lock)
- Evidence (official run on ws/3-enclave): `ecies ts->rs: PENDING (fixtures/ecies-vectors.json missing)` · `ecies rs->ts: 5/5 PASS (fixtures/ecies-vectors-rs.json, self-check)` · `xchacha ts->rs: PENDING` · `xchacha rs->ts: 4/4 PASS (fixtures/xchacha-vectors-rs.json)` · `minhash ts->rs: PENDING (fixtures/minhash-vectors.json missing)` · `minhash rs self-check: 8/8 PASS` · `RESULT: PENDING`
- Dry runs (scratch, not gate evidence): eciesjs 0.4.18 unsealed 5/5 of the Rust ciphertexts; @noble/ciphers 2.4.0 opened 4/4 Rust blobs; eciesjs-sealed probe vectors (default config, 7 cases incl. 1 B and 2975 B) opened in Rust 7/7, noble XChaCha probes 4/4; an independent Node 24 implementation of the fixtures/README MinHash definition matched fixtures/minhash-vectors-rs.json 8/8.
- PASS items: (1) ECIES ts->rs PENDING · (2) XChaCha ts->rs PENDING · (3) MinHash ts->rs PENDING · rs->ts files written. PASS = ts->rs 7/7 + 4/4 + crypto.interop.test.ts green (WS4-T02 DoD). Re-run the command above after WS4-T02/T03 land on main; "pending" is not PASS.
- Chosen path: default (ecies 0.2.11 pure <-> eciesjs 0.4.x default config, XChaCha20-Poly1305 nonce24||ct||tag), no fallback needed so far.
- Changed claim: —

## K0 decision
PENDING (WS1-T11 fills: result, evidence, chosen path and changed claim per gate; PLAN §4.3 decision table). K0 due min(10 Kas 21:00 + Δ, 11 Kas 09:00) = 11 Kas 05:49 GMT+7 [10 Kas 22:49Z].
