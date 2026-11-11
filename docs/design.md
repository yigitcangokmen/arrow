# Arrow design notes

## NEAR AI call

- Endpoint `https://cloud-api.near.ai/v1/chat/completions`, model `Qwen/Qwen3.8-27B`, both fixed in `enclave/arrow-tee/src/consts.rs`. The enclave checks that the response names the same model.
- Request (`enclave/arrow-core/src/llm.rs`): `temperature` 0.0, `max_tokens` 64, a `json_schema` response format, reasoning off for Qwen.
- Prompt (`enclave/arrow-core/src/prompt.rs`): the buyer's criteria text, the column names, `rows_total`, per-column null %, duplicate-row %, the date range, and the sampled rows as JSON arrays with each cell cut to `cell_cap` = min(200, max(8, 960 / number of columns)) characters. Criteria and data sit in tags whose name carries a token derived from the eval seed.
- Sample (`enclave/arrow-core/src/sample.rs`): 40 rows (`SAMPLE_ROWS`) drawn with the eval's seed, which the contract sets per eval and stores on chain; a file of 40 rows or fewer goes whole.

## Decision

`enclave/arrow-core/src/compose.rs`:

- `fit = min(fit_llm, fit_rule)`, clamped to 1-5. `fit_rule` comes from the buyer's structural criteria (required columns, minimum rows, date window, null rate).
- `novelty` is deterministic: the overlap between the buyer's MinHash sketch and the listing's key column, 3 when the buyer sends no sketch, in which case the `min_novelty` gate below is skipped.
- BUY needs the LLM's BUY vote, `fit_rule` 5, `fit >= min_fit` and `novelty >= min_novelty`. Anything else is PASS.
- An injection or exfiltration flag (from the scanner or the LLM) returns the guard score `PASS · 1 · 1`, which is one of the ordinary states, not a new one.

## Leak bound

- Scored mode: 2 verdicts × 5 fit × 5 novelty + 1 error output = 51 states, log2 51 ≈ 5.672. Verdict-only mode: 3 states, log2 3 ≈ 1.585. The contract stores them as `bits_per_eval_milli` 5673 and 1585, rounded up to the next milli-bit. Every surface that states the bound rounds up, "at most 5.68 bits" and "at most 1.59"; the per-eval charge lines of the CLI and `/buy` round to the nearest hundredth (`formatBits`, `sdk/src/bits.ts`: 5.67), and `/sell`'s budget preview shows milli-bits. The bench line "results outside the 50 states" counts the success states only.
- With `null` (a trap, an out-of-fuel run or an OutLayer failure) on chain as a second failure state, scored mode has at least 52 outcomes (≈ 5.70 bits) and verdict mode 4 (2 bits). Neither the bound nor the budget counts `null`.
- The contract's classifier (`contracts/arrow/src/eval.rs`) has two more refund reasons: `bad_output` (an output it cannot parse) and `hash_mismatch` ([hash binding](#hash-binding)). On eval the Arrow program writes neither, but an OutLayer fault could return `bad_output`.
- The output is at most 900 bytes (`MAX_OUTPUT_BYTES`, OutLayer's blockchain-mode limit; [measured size and target](perf.md#decisions-card-rules-set-in-advance)).

## Leak budget

- `evals_used` rises inside `mt_on_transfer` when an eval is accepted and never falls, not even on a refund (`contracts/arrow/src/eval.rs`).
- Lifetime bound per listing: `max_evals × bits_per_eval_milli`. 50 evals in scored mode give 283.65 bits (`budget_milli` 283650). The counter sits on the listing, so the bound holds across buyers.
- At `max_evals` a further `op=eval` is refused; `op=buy` keeps working.
- View `leak_budget(listing_id)` returns `bits_per_eval_milli`, `max_evals`, `evals_used`, `budget_milli`, `spent_milli`, `left_milli`.

## Timeouts

From `enclave/arrow-tee/src/consts.rs` and `enclave/arrow-tee/src/http.rs`:

| What | Value |
|---|---|
| NEAR AI chat call | 35 s to first byte and in total (10 s to connect) |
| Blob fetch | 25 s in total (15 s to first byte) |
| `T_PAD`: an eval is padded to at least | 45 s |
| Eval guard: error output when the request block is older than | 90 s |
| Release guard | 45 s |
| NEAR yield window before the contract times out and refunds | 200 blocks |

`T_PAD` is a minimum: a run that takes longer is not cut, and two exits are not padded, the start-of-run time guard (`enclave/arrow-tee/src/flow.rs`) and a trap, which leaves `null`.

## Hash binding

- Every `ok` output carries `h`, the sha256 of the ciphertext the enclave downloaded.
- On buy the enclave downloads the blob again. If it was swapped, `h` differs from the listing's `blob_sha256`, the key stays inside and the contract refunds with `arrow_refund{reason:"hash_mismatch"}`; if the blob is gone, the reason is `not_ok`. Release also checks that the key opens the blob it just downloaded.
- On eval a swapped blob ends as `not_ok`: the enclave stops before scoring.
- After a release nothing stops the seller from changing the hosted file. `op=rehost` (CLI only) points a listing at a new URL and keeps `blob_sha256`.

## Keys

- File: XChaCha20-Poly1305 with a 32-byte key K (`sdk/src/crypto.ts`). The browser draws K and the nonce at random. The CLI derives both as an HMAC-SHA256 of a random local seller secret over the network, contract, program key and the plaintext's sha256 (`agent/src/commands.ts`), so the same file listed twice on the same market gets the same K and the same ciphertext.
- Listing: K sealed with ECIES to the program's secp256k1 public key (`program_pubkey`), derived inside the enclave from the OutLayer secret `PROTECTED_MASTER` with HKDF info `arrow/program/v1`. Changing the program changes the key ([J#57](../JUDGES.md#claims)).
- Purchase: the enclave re-seals K to the buyer's public key from the `op=buy` msg. Eval results are sealed to the buyer's key too.
- Viewing key (web): derived from the buyer's EOA signature over `Arrow viewing key v1`, the site domain and a warning (`sdk/src/viewingKey.ts`). EIP-1271 contract wallets are refused: their signature does not recover to their address, and `intents.near` has no ERC-1271 path, so USDC credited to such an account could never be signed out (`web/lib/wallet.ts`).

## Standards

- NEP-245 multi-token transfers through `intents.near` (`mt_on_transfer`, `mt_resolve_transfer`), with `0x…` implicit accounts for ERC-191 signers.
- NEP-141 on testnet: the test token `arrow-usd.arrowhq.testnet` (`ft_on_transfer`).
- NEP-297 events (`arrow_refund` and others).
- NEP-330 build metadata in the contract wasm.
