# Arrow: inspect before you pay, on NEAR

Inspect before you pay: the buyer's AI reads the sealed data inside a TEE, and only a capped verdict (at most 5.67 bits per eval) comes back to the buyer. The seller encrypts a dataset in the browser, the buyer pays from any chain through NEAR Intents, and after a purchase the data key is released to the buyer's key. If the enclave fails or times out, `intents.near`'s own `mt_resolve_transfer` refunds the buyer's NEAR Intents balance.

> **Draft status.** Everything below is backed by a command or a transaction in this repository today. Items that need the mainnet deployment, the final run or the lock are marked `TODO(...)` or `{{UPPER_SNAKE}}`; they are filled from recorded evidence, never by hand, and `bash scripts/check-claims.sh --final` fails until none are left.

## Problem

You cannot sell information: to judge its value the buyer must see it, and once they have seen it they have no reason to pay. Kenneth Arrow described this paradox in 1962 ([NBER](https://www.nber.org/books-and-chapters/rate-and-direction-inventive-activity-economic-and-social-factors/economic-welfare-and-allocation-resources-invention)). Data sellers work around it today with NDAs, samples and trust. Arrow lets the buyer's own AI read the data where nobody can look, and lets out a few bits.

## Status (as of {{STATUS_UTC}})

- Mainnet contract: `TODO(mainnet)` `arrow-market.near`, locked (all access keys deleted) in tx `{{LOCK_TX}}`. Program wasm sha256 `{{WASM_SHA256}}`, contract wasm sha256 `{{CONTRACT_WASM_SHA256}}`.
- Testnet: contract `arrow.arrowhq.testnet` (live, release-candidate program wasm `73415b8f…` served from testnet FastFS) and the testnet token `arrow-usd.arrowhq.testnet`. The end-to-end run on it is green (9 of 9 steps) and the enclave has produced real verdicts with a NEAR AI call inside it; see [Testnet end-to-end and timings](#testnet-end-to-end-and-timings). The release candidate is not the final program: the wasm freeze is still ahead, and listings made now stop being readable when the program key changes.
- Demand: `{{DEMAND_LINE}}`
- Gates run so far (testnet and free mainnet views): S2, S1-b (echo), S3a (dry), S4-b, and the K2 testnet end-to-end run. See [Gates and evidence](#gates-and-evidence).
- Not live / not claimed: NEAR AI calls from inside the enclave on mainnet (`TODO(mainnet)`; on testnet they run), the paid cross-chain inbound (S4-a), mainnet purchases, E2EE to NEAR AI (TLS only), on-chain TDX quote verification, resale prevention, eval-time NEAR AI attestation.
- The testnet contract is not locked, so daily caps can be adjusted.

## Trust table

Labels: **PROVEN** = a command or tx in this repo shows it. **RISKY** = true, and a weakness. **NOT PROVEN** = we do not claim it. **TODO** = proof is planned and not yet run.

| Part | Who you trust | Can see | Cannot | How to check | Label |
|---|---|---|---|---|---|
| Seller data at rest | Nobody (ciphertext; the blob host is untrusted) | Ciphertext | Decrypt | `blob_sha256` is on chain and the enclave checks it before reading; `cargo test -p arrow-core` | TODO (mainnet run) |
| Program key / `PROTECTED_MASTER` | OutLayer keystore (TDX) and the shared OutLayer master | Inside the TEE | Release to an unpinned wasm or a non-Arrow caller | `WasmHash` + `Predecessor` access condition. Negative test: an attacker account calling OutLayer directly gets `Access denied by access condition`, tx [`smm9T86m…`](https://testnet.nearblocks.io/txns/smm9T86m4RU8grrrbHgAsSd3TeD5zkCuT4FH4tbugH6) | PROVEN (testnet, echo program) |
| OutLayer keystore DAO | Can export keys on "cessation" | Potentially everything | n/a | Open risk | RISKY |
| Evaluation | Intel TDX (OutLayer worker) | Plaintext inside the TEE | Emit anything outside the schema | Open source; attestation `wasm_hash` and `transaction_hash` match the run (S1-b item 5) | PROVEN (testnet, echo program) |
| LLM | NEAR AI gateway (TDX) and model TEE (TDX + NVIDIA CC) | 40 sampled rows + criteria | Retain data (NEAR AI's zero-data-retention claim is a trust assumption) | `/v1/attestation/report` shows the endpoint's **current** attestation, not eval-time; the wasm does not verify quotes itself | NOT PROVEN |
| Wasm to NEAR AI | TLS (not E2EE) | n/a | n/a | Endpoint and model ID are fixed in source | RISKY |
| Time guard | The TDX clock, which the host provides | n/a | n/a | The wasm compares the block timestamp with the TDX clock, which the host provides. A host that lies about time can make a late result look on time. Measured skew max 5.6 s on testnet | RISKY |
| OutLayer coordinator (closed source) | Liveness | Encrypted input | Read secrets | If it fails, the callback gets `null` and the buyer is refunded: a purchase in full, an eval less the treasury's share of the fee (sandbox, S2) | PROVEN (sandbox) |
| `outlayer.near`, `intents.near` contracts | Their owners (both are upgradable); Arrow depends on them | n/a | n/a | `outlayer.near` code hash changed between 2026-11-09 (`5waW…`) and 2026-11-10 (`8rRYys…`) | RISKY |
| Program bytes | Whoever serves the wasm URL | The wasm | Change it unnoticed (hash-pinned) | Availability depends on the host (FastFS on testnet; the repo is private) | RISKY |
| Arrow operator | Relayer liveness, gas tank | Encrypted blobs | Read data, take funds, change contract or wasm hash after the lock | `TODO(lock)` no access keys (`{{LOCK_TX}}`); the contract owns itself | TODO |
| NEAR AI API key (inside the OutLayer secret) | Billing | Usage volume | See content | The mainnet inference key can be topped up, not rotated | RISKY |
| 1Click and the PoA bridge (Intents Technology) | Short custody during swaps | Swap txs | n/a | Base and Solana USDC arrive as bridged tokens (`omft.near`); 1Click `/v0/status`. `TODO(S4-a)` paid inbound not run yet | NOT PROVEN |
| Refund destination | `intents.near` | n/a | n/a | Refunds go to the buyer's NEAR Intents balance (`0x…` account in `intents.near`). Moving them back to Base is a separate 1Click withdrawal | TODO (mainnet refund tx) |
| Output channel | Schema and rule composition | At most 5.67 bits per eval (scored), 1.58 (verdict) | Free text | `cargo test -p arrow-core` (`output_space_is_at_most_51_states`, `output_le_900_bytes`) | PROVEN |
| Error channel | One fixed error state, empty stderr | 1 state (counted in the bound) | Carry data | `bash scripts/dev/stderr-harness.sh` | PROVEN (native harness) |
| Leak budget | The contract counter | n/a | n/a | A buyer can burn a listing's budget by forcing failed evals (pays gas, learns at most the error state). `evals_used` never decreases | RISKY |
| Side channels | Not closed | `time_ms`, `instructions` on chain | n/a | `TODO(bench)` leak-bench timing measurement | RISKY |
| Decision correctness | Structural gates and the LLM | n/a | The LLM cannot produce BUY unless the structural gates pass | `cargo test -p arrow-core` (`llm_cannot_buy_without_structural_gates`); `TODO(bench)` quality-bench. Semantic injection on structurally valid data is an open risk | PROVEN (gates), RISKY (semantics) |
| HTTP 402 wrapper | n/a | n/a | n/a | The 402 response describes how to inspect and pay; it carries no payment and no x402 facilitator is involved. `TODO(web)` live `curl -i` | TODO |
| Buyer viewing key | The buyer's EOA signature over a domain-bound message | n/a | n/a | Any site that obtains the same signature can derive it; an EOA is required (EIP-1271 wallets are not deterministic) | RISKY |
| After purchase | The buyer | All data | n/a | Out of scope: resale is not prevented | NOT PROVEN |

## Try it (do X, see Y)

What runs today with Node 22.22.2 or later (tested on 24.15.0) and, for steps 4-6, Rust 1.95 or later. No keys, no funds. Steps that need the deployed contract come later and are listed under `TODO`.

1. `npm ci`. See: the install finishes without errors. (`TODO({{REPO_URL}})` clone line once the repository is public.)
2. `bash scripts/check-claims.sh`. See: no output, exit 0. This is the scanner for the phrases we promise not to write (below).
3. `npm run bench:offline`. See: a results table that re-scores recorded runs; rows with no recorded run say `not run`; the injection room line reads `19/24 (79.2%)` stopped by the deterministic layer alone. Every dataset in the bench is synthetic and labelled so.
4. `cargo test -p arrow-core`. See: `test result: ok. 77 passed`, including `output_space_is_at_most_51_states`, `output_le_900_bytes` and `regex_no_false_positive_on_buy_sell_column`.
5. `cargo run -p s4-interop --release`. See: `S4-b RESULT: PASS`, with `ecies ts->rs: 7/7`, `xchacha ts->rs: 4/4`, `minhash ts->rs: 8/8`. TypeScript and Rust seal, open and fingerprint identically.
6. `npx tsx spikes/s3/s3a-simulate.ts`. See: `payload carries msg: yes · min_gas: yes`, then `class: SIGNATURE_OK_BALANCE_ERROR`. A signed transfer intent with a `msg` is accepted by `intents.near` (mainnet `simulate_intents`, a free view, throwaway key); only the empty balance fails. Nothing is sent.
7. `npm run arrow -- --help`. See: the commands `list`, `eval`, `buy`, `status`, `decrypt`.

`TODO(try-testnet)` the market contract is on testnet now; the judge path has not been run from a clean clone yet: `npm run try:testnet` (list, eval, buy, decrypt), `npm run arrow -- status --network testnet`, `npm run arrow -- list … --dry-run`. `TODO(mainnet)` `npm run verify`, `npm run verify -- --decrypt-demo`, `npm run replay`, the hosted `/verify/{{EVAL_ID_DEMO}}` page and `curl -i {{HOSTED_URL}}/api/x402/{{LISTING_ID_DEMO}}`. If one of these fails for a reason outside our control, steps 3 to 6 above still run offline.

## Gates and evidence

Each gate is a spike run before the real build. Transaction links point at the testnet explorer; raw notes are in `spikes/GATES.md` (integration ledger).

| Gate | Result | Evidence |
|---|---|---|
| **S2** testnet token and refund | PASS. Public capped mint works; a receiver that returns the whole amount leaves both balances unchanged; one that keeps exactly 100000 moves exactly 100000. Sandbox: a mock OutLayer returning `null`, or never resuming, produces a full refund on both rails (`arrow_refund` event). | Deploy [`DKcmuQZf…`](https://testnet.nearblocks.io/txns/DKcmuQZfqyXg4MprUqKqqJL9XADcL4hrCeWcTQ2LG7sL), mint [`FigU6Yju…`](https://testnet.nearblocks.io/txns/FigU6Yju4aSxCmJtjnmUECcTCLbHiZUebpT1AGMSytwH), over-cap mint rejected [`9VEBgna2…`](https://testnet.nearblocks.io/txns/9VEBgna2bjfFLFa2efZjPamL7H6tYsu9kzDkxjpcSd1K), refund_all [`5toQSSae…`](https://testnet.nearblocks.io/txns/5toQSSaeNKNYyE1WAmEeZtMFwCvyLptKgraS1DT5srrV), keep [`Ajx43mbG…`](https://testnet.nearblocks.io/txns/Ajx43mbGw8pv6fWTPW5FCAww9bvwhux2DzhWh3uuKtzH). Sandbox suite: `cargo test --manifest-path spikes/s2/receiver/Cargo.toml --test s2` after building the contracts (6 passed when recorded) |
| **S1-b** OutLayer chain mode, testnet | PARTIAL. Echo program (not the Arrow program, sha256 `195508a1…1151e`) on `spike.arrowhq.testnet`: 3 of 3 runs return valid JSON; caller and network are visible to the wasm; block-to-callback 6.9 to 8.9 s; an attacker account calling OutLayer directly is refused; attestation `wasm_hash`, `transaction_hash`, `input_hash` and `output_hash` match the run; measured clock skew at most 5.6 s, so the time guards stay at 90 s (eval) and 60 s (release). The same flow with a real NEAR AI call inside the Arrow program is in the next section. | Runs [`ED5VCvV6…`](https://testnet.nearblocks.io/txns/ED5VCvV6vyzosFm9bHA1BSA4dDkk3RxdLrC2jGuCqaRi), [`4Q5eNqa3…`](https://testnet.nearblocks.io/txns/4Q5eNqa3YbGuApELvMso2oZN9aeNd3GCjjJc3wTiEF5S), [`8aPNegaf…`](https://testnet.nearblocks.io/txns/8aPNegafPsKGkUPsKQe2Qf1qaYHhjyiY7ZwGVFVoBJah); negative [`smm9T86m…`](https://testnet.nearblocks.io/txns/smm9T86m4RU8grrrbHgAsSd3TeD5zkCuT4FH4tbugH6) |
| **S3a** signature simulation (dry) | (i) PASS. A signed ERC-191 transfer intent carrying `msg` and `min_gas` is accepted; the only error is `insufficient balance or overflow`. (ii) `TODO` the funded simulate needs a funded buyer. | `npx tsx spikes/s3/s3a-simulate.ts`; result file `spikes/s3/s3a-results.json` |
| **S4-b** ECIES, XChaCha, MinHash interop | PASS in both directions: ECIES 7/7 and 5/5, XChaCha 4/4 and 4/4, MinHash 8/8, plus the TypeScript interop test. | `cargo run -p s4-interop --release`; `npx vitest run sdk/test/crypto.interop.test.ts` |
| **K2** testnet end-to-end | PASS, `E2E testnet: 9/9 steps green`. The PASS scene returns `PASS fit 2/5 novelty 1/5` and the BUY scene `BUY fit 5/5 novelty 4/5`; a purchase releases the key and the decrypted data hashes equal; an eval against a broken blob host is refunded with both events and the balance back; the leak counters move. Evidence rows: 12 listings, 16 evals, 3 purchases, 3 refunds in `evidence/testnet.json`. Run on the release-candidate wasm. | Eval PASS [`6fSU8y8U…`](https://testnet.nearblocks.io/txns/6fSU8y8UxJ3KYps91yVyfyMHo6TCFnQJZwyyz3FTTEnm), eval BUY [`4RzSuxeo…`](https://testnet.nearblocks.io/txns/4RzSuxeo1coQZangy4inXt4yhVf9ta7G8eWFJ3M7fS2j), purchase [`DwKeJ1YX…`](https://testnet.nearblocks.io/txns/DwKeJ1YXXWixQQmCNnqLXTZPKgm1CAvXxGDPyDY3ocgz), refund [`EQPftWo8…`](https://testnet.nearblocks.io/txns/EQPftWo8vA6Foyz7UzM2Mnk56mWuT6s8LDUDQPerEmmz). Needs the team's testnet accounts, so it is a recorded run, not a judge command |
| S3b, S3c (mainnet), S4-a (paid inbound) | `TODO` not run. Dry runs only (`SIGNATURE_OK_BALANCE_ERROR`); the real runs move value and are done by a human. | n/a |

## Testnet end-to-end and timings

Real evals on `arrow.arrowhq.testnet`, program wasm release candidate `73415b8f…`, with the model `Qwen/Qwen3.8-27B` called from inside the enclave. All data is the synthetic demo data. Full table with every transaction: `docs/perf.md`.

- Two scenes, ten evals, ten verdicts, no refund. Listing 8 (unlock, 412 rows) returned `PASS·2·1` five times and listing 9 (labels, 1 000 rows) returned `BUY·5·4` five times: the model agreed on every run. Example transactions: [`2FV7Ep9P…`](https://testnet.nearblocks.io/txns/2FV7Ep9PcfBXibqtgDc3Q7YwCtsJJmhecFUEojAi29FM) (`PASS·2·1`), [`6mke3XDR…`](https://testnet.nearblocks.io/txns/6mke3XDRrLd5kRFJU7DYyKHtgBPJoxyVcq1RtUcUm7y9) (`BUY·5·4`).
- Time from sending the transaction until the contract shows the eval settled: p50 59.0 s, p95 71.2 s (10 runs, so p95 is the slowest run). In block time the eval took p50 53.7 s, p95 59.7 s, against the 90 s eval guard.
- OutLayer `time_ms` is 47.0 s in every run (46.9 to 47.1 s). The enclave pads each eval to 45 s on purpose, so the real work time is not visible on chain. Locally, with the real model, the work takes p50 3.2 s.
- `instructions` are public and follow the dataset size: 2.67e8 on the 412-row listing, 4.02e8 on the 1 000-row one, within 0.4 % between runs on one listing. This is the side channel listed in the trust table.
- The verdict output is 227 bytes in every run (limit 900). One eval cost the contract's gas tank 0.0057 NEAR.
- Largest accepted input (200 000 rows, 5 MB) was measured locally only, after a MinHash speed-up that is not in the testnet release candidate: 1.33e10 instructions of the 2.0e10 limit.
- Mainnet numbers: `TODO(mainnet)` the same table from the final wasm on `arrow-market.near`, `{{MAINNET_EVAL_TIMINGS}}`.

## Leak bound and leak budget

- Scored mode: `log2(2·5·5 + 1) = 5.67` bits per eval (`bits_per_eval_milli` 5673). Verdict-only mode: `log2(3) = 1.58` bits (1585).
- Lifetime bound per listing: `max_evals × bits`. For 50 evals in scored mode that is 283.65 bits (`budget_milli` 283650). The counter lives on the listing, so the bound holds against many buyers.
- `evals_used` increments inside `mt_on_transfer` and is never decremented, not even on refund. When it reaches `max_evals`, a further `op=eval` is refused with a full refund; `op=buy` keeps working. Read it with the `leak_budget(listing_id)` view: `bits_per_eval_milli`, `max_evals`, `evals_used`, `budget_milli`, `spent_milli`, `left_milli`.
- The budget can be burned by forcing errors (RISKY, see the trust table).
- Output is also capped at 900 bytes, the OutLayer blockchain-mode limit; Arrow targets 400.
- Measured side channel (time, instructions): `TODO(bench)`.

## How it works · NEAR technology used

```
seller browser                         buyer (any chain)
  encrypt dataset (XChaCha)              pays 1Click -> NEAR Intents balance (0x... account)
  seal key to enclave pubkey (ECIES)     signs a transfer intent with a msg
        |                                        |
        v                                        v
   blob host (untrusted)            intents.near --mt_on_transfer--> Arrow contract
                                                                     |  request_execution (yield)
                                                                     v
                                                  OutLayer worker: Intel TDX
                                                  arrow-tee wasm (WASI P2), PROTECTED_ secret
                                                  1. checks caller and network
                                                  2. downloads blob, checks sha256
                                                  3. samples rows, calls NEAR AI (TEE model)
                                                  4. composes a fixed-schema verdict
                                                  5. time guard, then writes <= 900 bytes
                                                                     |  resume
                                                                     v
                                  Arrow contract: verdict to buyer, or null/ok:false -> refund
```

- **NEAR AI Cloud** private inference. Model `Qwen/Qwen3.8-27B`, called from inside the enclave on testnet (ten real verdicts, see above); `TODO(mainnet)` the mainnet key and run. Fixed endpoint, `json_schema`, `temperature 0`, `max_tokens 64`, reasoning off, 40 sampled rows.
- **OutLayer** TDX: a WASI P2 program, a `PROTECTED_` secret, a `WasmHash` + `Predecessor` access condition, and the `request_execution` yield and resume callback.
- **NEAR Intents**: transfer intent with a `msg` that triggers `mt_on_transfer`, `mt_resolve_transfer` refund, ERC-191 signer, and **1Click** for cross-chain inbound and outbound.
- NEP-245, NEP-141 (testnet token), NEP-297 events, NEP-330 reproducible build, `0x…` implicit accounts: buyer and seller need no NEAR account.
- The decision is not the LLM's alone: `novelty` is deterministic, `fit = min(fit_llm, fit_rule)`, and BUY needs every structural gate. A guard trip maps to `PASS · 1 · 1`, never to a new output state.
- Every eval and release output carries `h`, the sha256 of the ciphertext the enclave downloaded. On buy the enclave downloads the blob again: if it was swapped, `h` differs from the listing's `blob_sha256`, the key stays inside and the contract refunds with `arrow_refund{reason:"hash_mismatch"}`; if it is gone, the refund reason is `not_ok`. On eval a swapped blob ends as `not_ok` (the enclave stops before scoring). After a release nothing stops the seller from changing the hosted file.
- Security-track pieces: TEE attestation (`TODO(web)` `/verify`), a bit-capped output and an injection-refusal room (24 attacks), and a relayer key limited to `intents.near` function calls (`TODO(mainnet)`).

## For agents: CLI and MCP

- CLI: `npm run arrow -- <list|eval|buy|status|decrypt>` (always through `npm run`; the bare npx package name belongs to an unrelated project). Exit codes: 0 ok, 1 error, 2 usage, 3 pending, 4 refunded, 5 needs a terminal or `--yes`, 6 leak budget exhausted.
- MCP: `npx -y tsx agent/src/mcp.ts` serves a server named `arrow` with the tools `inspect_before_buy`, `buy`, `get_listing`, `list_listings`. `TODO(mcp-snippet)` client configuration snippet and a per-call spend cap.
- HTTP: `TODO(web)` `/api/x402/<listing_id>` returns an x402-shaped 402 response whose `accepts` is empty on purpose. x402 tells you how to pay. Arrow tells you whether it's worth paying. Payment itself goes through NEAR Intents (`mt_on_transfer`), not an x402 facilitator.

## Differences from prior work

| Project | Source | What it does | What Arrow adds |
|---|---|---|---|
| TrustKit / NDAI | github.com/discordwell/ndai-hackathon · arXiv 2502.07924 | Two agents negotiate inside an enclave; README: "egress whitelist of the LLM API hosts"; output fields "outcome, price, reason"; escrow on Base/Ethereum Sepolia | The reader model itself runs in a TEE (NEAR AI Cloud); output is a fixed schema bounded in bits; mainnet; refunds by `intents.near` |
| Information Bazaar | arXiv 2403.14443 · github.com/tn-learn/info-bazaar | Open-source simulated market; LLM agents inspect and then forget | Forgetting is enforced by an enclave and a contract, with real payments |
| DeadDrop | github.com/Hothit1/deaddrop | Encrypted file sale, escrowed key delivery by a keeper, testnet | DeadDrop guarantees delivery; Arrow lets the buyer judge value before paying |
| Ocean Compute-to-Data | github.com/oceanprotocol/docs (compute-to-data) | Provider checks datatokens before the job; "results and logs" are returned to the consumer; the consumer writes the algorithm | Inspection before payment, bounded output, natural-language criteria, TEE |
| Sealed Exploit · AgentEscrow · SealedBounty | x.com/edycutjong/status/2117725204403364028 · x.com/dele_dave/status/2117911300516823327 · x.com/0xJoydeeeep/status/2119815388657774668 | A TEE verdict releases escrow | The condition is the buyer's private criterion over the seller's private data, and a buyer who does not buy learns at most 5.67 bits |
| x402 / Penstock | github.com/coinbase/x402 (spec v2) · github.com/ace-coderr/penstock | Pay-first paywalls for HTTP and MCP | Complementary: x402 tells you how to pay, Arrow tells you whether it's worth paying |
| Spend firewalls (uprali, Warden, Clear to Pay) | github.com/aly-coding/uprali-mvp · x.com/saxxyweb3/status/2119774924499800353 · x.com/joezzyweb3/status/2119220897345122339 | Control whom and how much an agent pays | Arrow checks what is being bought |
| Charter · cipherwork | github.com/Spagero763/charter · github.com/wadadawadada/cipherwork | Same stack family (NEAR AI, OutLayer, Intents), privacy for one party | Privacy for both parties against each other. The stack itself is not presented as new |

A mainnet implementation of the inspect-before-pay idea (Arrow 1962; NDAI 2025; Information Bazaar 2024) where the reader model is itself in a TEE, the output is bounded in bits, and refunds are intents.near's own code. Limits: see trust table.

## What we do not claim

<!-- claims:quoted:start -->
- No on-chain TDX quote verification.
- Not zero-knowledge.
- No NEAR MPC CKD.
- No E2EE.
- No resale prevention.
- Not "nothing leaks".
- Not "no bridge".
- Not "first NDAI" (TrustKit/NDAI is prior work).
- The keyless contract plus OutLayer pattern also appears in other hackathon entries. We do not present it as novel.
<!-- claims:quoted:end -->

## Demand (honest numbers)

- `{{DEMAND_LINE}}`
- Team-made dataset: NEAR public-RPC chain statistics, built by `scripts/src/collect-chain-stats.ts`, labelled "team-made" (see `fixtures/team-made/SOURCE.md`). Demo data is labelled synthetic.
- Invites log: `TODO(outreach)` `docs/outreach/log.md`. Nothing has been sent yet.

## Benchmarks

- Injection room: 24 attacks; the deterministic layer alone stops 19 of 24 (`npm run bench:offline`). Enclave timing and instruction counts from real testnet evals are in [Testnet end-to-end and timings](#testnet-end-to-end-and-timings). `TODO(bench)` live room, leak-bench (50 attacks + 5 error-path), quality-bench (40 evals), timing bits, replay captured/total.
- Criteria were written by an agent and are waiting for a human review (`bench/REVIEW.md`).

## Video

`TODO(video)` {{YOUTUBE_URL}}

## Repo layout

`contracts/` (arrow, arrow-usd, mock-outlayer) · `enclave/` (arrow-core, arrow-tee) · `sdk/` · `web/` · `agent/` · `scripts/` · `bench/` · `fixtures/` · `spikes/` · `release/`

## Build from source

- Contracts: `cargo near build reproducible-wasm` (Docker) for the final build; compare with the on-chain code hash. `TODO(mainnet)`
- Enclave: `cargo build -p arrow-tee --target wasm32-wasip2 --release`; compare its sha256 with `release/sha256.txt` and the contract's `program_wasm_hash`. `TODO(freeze)` `release/` is filled at the wasm freeze.

## Keys in this repository

None, with one deliberate exception: the demo buyer's viewing key is derived in code from the public label `arrow:demo-buyer:public:v1`. It is intentionally public, holds no funds, and only decrypts demo purchases. Testnet accounts for judges are created at run time.

## Libraries, templates, AI usage

- Templates: `out-layer/private-dao-example`, `out-layer/ai-example`.
- Libraries: see `package.json` and `Cargo.toml`.
- Parts of the code were written with AI coding assistants and reviewed by the team.
- Claims are in this README and the trust table above.

## Pre-hackathon code

None. First commit 2026-11-10, inside the window that opened with the announcement on 2026-10-19.

## Other projects by the same people (Q-015)

<!-- claims:quoted:start -->
yigitcangokmen also builds Tender: https://github.com/yigitcangokmen/tender. Independent code, contracts and accounts; core mechanic MPC CKD sealed bids. The two projects share no code, packages, contracts, accounts, wallets or deployments. Arrow's core is TEE inspection with NEAR Intents refunds.
<!-- claims:quoted:end -->

## License

MIT, see `LICENSE`.
