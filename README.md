# Arrow: inspect-before-pay for datasets, on NEAR

> Built at NEAR HACKATHON (2026-11). Skeleton README: every `<…>` is filled with real values before submission. The repo contains no claim without a command or transaction behind it.

Arrow lets a buyer's AI read an encrypted dataset inside a TEE before paying. Only a capped verdict leaves the enclave: `BUY` / `PASS`, optionally `fit 1-5 · novelty 1-5`. The buyer pays from any chain through NEAR Intents, and the data key is then released to the buyer's key on chain. If the enclave fails or times out, `intents.near`'s own `mt_resolve_transfer` refunds the buyer in the same receipt tree. <If gate S3 fell back to escrow: "the Arrow contract refunds the buyer".>

## Problem

You cannot sell information: to judge its value the buyer must see it, and once they have seen it they have no reason to pay. This is Arrow's information paradox (1962). Data licensing (for example Reddit and Google, about $60M per year) and on-chain research bounties pay this cost today. Arrow lets the buyer's own AI read the data where nobody else can see it, and lets out only a few bits.

## Status: what is live, what is not

- Mainnet contract: `arrow-market.near`, locked (all access keys deleted) in tx `<LOCK_TX>`. Program wasm sha256: `<WASM_SHA256>`.
- Testnet contract: `arrow.arrowhq.testnet`, same wasm sha256 `<WASM_SHA256>`.
- Mainnet records: `<N>` listings (1 team-made real dataset, `<M>` external, rest demo, all labelled), `<K>` evals, `<J>` purchases. Listings before the lock are labelled "pre-lock" by `verify`.
- Not live / not claimed: E2EE to NEAR AI (TLS only), on-chain TDX quote verification, resale prevention, eval-time NEAR AI attestation.

## Try it (do X - see Y)

Main path needs Node 22.x (≥22.22.2) or 24.x and no Rust, keys or funds.

1. `git clone <REPO_URL> && cd arrow && npm ci`. See: install finishes without errors.
2. `npm run verify`. See: `verify: <N>/<N> PASS`, with an explorer link per line (mainnet, read-only, archival RPC). For each eval and purchase it checks:
   - OutLayer attestation `wasm_hash` == contract `program_wasm_hash` == `sha256(release/arrow-tee.wasm)`,
   - attestation `transaction_hash` == the eval tx,
   - `<input/output hash check, only if gate S1-b(5) established what input_hash/output_hash cover>`,
   - 1Click inbound and outbound status `SUCCESS`.
3. `npm run verify -- --decrypt-demo`. See: demo purchase #1 decrypted with the public demo viewing key, then `sha256(decrypted) == listing.blob_sha256 ✔`.
4. `npm run bench:offline`. See: re-scored recorded runs.
   - leak-bench (55 attacks incl. 5 error-path): Arrow vs free-text preview, verbatim leaks `<X>` vs `<Y>`, timing-channel estimate `<T>` bits.
   - quality-bench (40 evals): BUY rate on injected listings, Arrow `<a>/10` vs LLM-only `<b>/10`, false flags on clean BUY/SELL data `<c>`.
5. `npm run replay`. See: NEAR AI response signatures for the bench's direct NEAR AI calls, `<captured>/<total>` captured and verified. Signature lookups are best-effort per NEAR AI docs, so some are missing.
6. `npm run try:testnet` (free; creates a testnet account through the NEAR faucet or our hosted sponsor endpoint and mints test tokens from `arrow-usd.arrowhq.testnet`). See: list → eval → buy → decrypt, prints `PASS · fit 4 · novelty 1`, then `sha256 match ✔`. Takes ~2-3 min. If our NEAR AI credit or the daily testnet eval cap is exhausted, it says so and points to step 4.
7. Run step 6 with `--criteria fixtures/criteria/print-row-1.json`. See: `PASS · fit 1 · novelty 1`, no text.
8. Open `<HOSTED_URL>/verify` and paste eval id `<EVAL_ID>`. See: the same checks as step 2 in the browser, plus TDX quote verification via `@phala/dcap-qvl-web`.
9. Agent path: `npm run arrow -- eval <LISTING_ID> --criteria fixtures/criteria/demo.json --network testnet`. See: the same verdict as step 6. MCP: `<MCP_CONFIG_SNIPPET>` exposes MCP server `arrow`, tool `inspect_before_buy`.
10. Optional, needs Rust ≥1.95: `cargo test -p arrow-core`. See: passes, including `output_space_is_at_most_51_states` and `no_stderr_on_any_error`.

## Trust table

| Part | Who you trust | Can see | Cannot | How to check |
|---|---|---|---|---|
| Seller data at rest | Nobody (ciphertext; host untrusted) | — | Decrypt | `blob_sha256` on chain; enclave checks it |
| Program key / `PROTECTED_MASTER` | OutLayer keystore (TDX) + shared OutLayer master | Inside TEE | Release to an unpinned wasm or a non-Arrow caller | `WasmHash` + `Predecessor` condition; in-wasm network allowlist; negative tests `<S1-b tx>`, `<S3c tx>` |
| OutLayer keystore DAO | Can export keys on "cessation" | Potentially everything | — | **Open risk** |
| Evaluation | Intel TDX (OutLayer worker) | Plaintext inside TEE | Emit anything outside the schema | Open source; attestation `wasm_hash` |
| LLM | NEAR AI gateway (TDX) + model TEE (TDX + NVIDIA CC) | 40 sampled rows + criteria | Retain data (NEAR AI zero-data-retention claim: a trust assumption) | `/v1/attestation/report` shows the endpoint's **current** attestation, not eval-time; the wasm does not verify quotes itself |
| Wasm ↔ NEAR AI | TLS (not E2EE) | — | — | Endpoint and model ID fixed in source |
| OutLayer coordinator (closed source) | Liveness | Encrypted input | Read secrets | If it fails, the callback gets `null` and the buyer is refunded in full |
| `outlayer.near`, `intents.near` contracts | Their owners (upgradable); Arrow depends on them | — | — | **Open risk**; `verify` reads historical txs |
| Arrow operator | Relayer liveness, gas tank | Encrypted blobs | Read data, take funds, change contract or wasm hash after the lock | No access keys (`<LOCK_TX>`); contract owns itself |
| NEAR AI API key (inside OutLayer secret) | Billing | Usage volume | See content | — |
| 1Click / PoA bridge (Intents Technology) | Short custody during swaps; Base/Solana USDC arrive as `omft.near` bridged tokens | Swap txs | — | 1Click `/v0/status`. Users see no bridge UI, but assets do come through a bridge |
| Output channel | Schema + rule composition | ≤5.67 bits/eval (scored), ≤1.58 (verdict) | Free text | `cargo test`, leak-bench |
| Error channel | One fixed error state, empty stderr | 1 state (counted in the bound) | Carry data | `no_stderr_on_any_error`, leak-bench error-path |
| Side channels | **Not closed** | `time_ms`, `instructions` on chain | — | leak-bench timing measurement: `<T>` bits |
| Decision correctness | Structural gates + LLM | — | The LLM cannot produce BUY unless the structural gates pass | quality-bench. Semantic injection on structurally valid data is an open risk: `<a>/10` |
| Buyer viewing key | The buyer's EOA signature over a domain-bound message | — | — | Any site that obtains the same signature can derive it; EOA required (EIP-1271 wallets are not deterministic) |
| After purchase | Buyer | All data | — | Out of scope (resale is not prevented) |

## Leak bound

- scored: `log2(2·5·5 + 1) = 5.67` bits/eval.
- verdict-only: `log2(3) = 1.58` bits/eval.
- Lifetime: ≤ `max_evals × bits`. The counter is on the listing, so the bound holds against sybil buyers.
- Measured side channel (time/instructions): `<T>` bits.

## What we do not claim

- No on-chain TDX quote verification.
- Not zero-knowledge.
- No NEAR MPC CKD.
- No E2EE.
- No resale prevention.
- Not "nothing leaks".
- Not "no bridge".
- Not "first NDAI" (TrustKit/NDAI is prior work).
- The keyless contract plus OutLayer pattern also appears in other hackathon entries. We do not present it as novel.

## How it works · NEAR technology used

`<diagram>`

- **NEAR AI Cloud** private inference: `Qwen/Qwen3.8-27B` (owned_by `nearai`), `/v1/attestation/report`.
- **OutLayer** TDX: WASI P2 program, `PROTECTED_` secret, `WasmHash` + `Predecessor` access condition, `request_execution` yield/resume callback.
- **NEAR Intents**: transfer intent with `NotifyOnTransfer` → `mt_on_transfer`, `mt_resolve_transfer` refund, ERC-191 signer, **1Click** (Base in, Solana out).
- NEP-245, NEP-141 (testnet token), NEP-297 events, NEP-330 reproducible build.
- `0x…` implicit accounts: buyer and seller need no NEAR account.

## Differences from prior work

| Project | Difference |
|---|---|
| TrustKit / NDAI | LLM outside the enclave, testnet |
| DeadDrop | Sells encrypted files with key delivery, no inspection before purchase |
| Ocean Compute-to-Data | Buyer writes the algorithm, unbounded output, no LLM reader. `<verify against Ocean docs>` |

## Demand (honest numbers)

- `<15>` invites sent, `<M>` external listings, `<K>` external evals, `<J>` purchases.
- Team-made dataset: `<name>`, labelled "team-made".

## Repo layout

`contracts/` (arrow, arrow-usd, mock-outlayer) · `enclave/` (arrow-core, arrow-tee) · `sdk/` · `web/` · `agent/` · `scripts/` · `bench/` · `fixtures/` · `release/`

## Build from source

- Contracts: `cargo near build reproducible-wasm` (Docker), compare with the on-chain code hash.
- Enclave: `cargo build -p arrow-tee --target wasm32-wasip2 --release`, compare `sha256` with `release/sha256.txt` and the contract's `program_wasm_hash`.

## Keys in this repository

None. Testnet accounts for judges are created at run time (faucet or hosted sponsor endpoint). `<If kept: the demo buyer viewing key is derived from the public label "arrow:demo-buyer:public:v1"; it is intentionally public, holds no funds and only decrypts demo purchases.>`

## Libraries, templates, AI usage

- Templates: `out-layer/private-dao-example`, `out-layer/ai-example` (MIT/Apache-2.0).
- Libraries: see `package.json` and `Cargo.toml`.
- AI: Parts of the code were written with AI coding assistants and reviewed by the team.

## Pre-hackathon code

None. All code in this repository was written during the NEAR HACKATHON window (first commit `<DATE>`, after 2026-11-01).

## Other projects by the same people (Q-015)

yigitcangokmen also builds Tender: https://github.com/yigitcangokmen/tender — independent code, contracts and accounts; core mechanic MPC CKD sealed bids.

## License

MIT, see `LICENSE`.
