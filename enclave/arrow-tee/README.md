# enclave/arrow-tee

OutLayer WASI P2 program (`wasm32-wasip2`). Scaffold it from `out-layer/private-dao-example` (ECIES, HKDF, `PROTECTED_` secret) and `out-layer/ai-example` (wasi-http POST).

Behaviour (KICKOFF.md §2.6):
- **Guard.** `OUTLAYER_EXECUTION_TYPE == "NEAR"`, and `NEAR_PREDECESSOR_ID` is in the allowlist for `NEAR_NETWORK_ID`: `{mainnet: [arrow-market.near, arrow-market-v2.near], testnet: [arrow.arrowhq.testnet, arrow-v2.arrowhq.testnet]}`. The same wasm hash runs on both networks.
- **eval.** Steps:
  1. Unseal `K‖blob_sha256`.
  2. Download the blob and check its sha256.
  3. Decrypt with XChaCha.
  4. Compute stats and MinHash.
  5. Take a 40-row sample seeded from the contract's `random_seed`.
  6. Call NEAR AI `Qwen/Qwen3.8-27B` with `json_schema`, temperature 0, `max_tokens 64`, reasoning off.
  7. Compose the result.
  8. ECIES-encrypt it to `buyer_pk`.
  9. Pad to `T_PAD = 45 s`.
  10. Write `{"v":1,"ok":true,"r":…,"h":…}` (≤900 bytes, target ≤400).
- **release.** Unseal, check the hash binding, return `ECIES(buyer_pk, K)`.
- **Errors (red-team B1).**
  - `panic::set_hook(Box::new(|_| {}))`.
  - Never write to stderr.
  - Every error prints `{"v":1,"ok":false}` and exits 0.
  - wasm32 has no unwinding, so the code must be panic-free.
  - Test: `no_stderr_on_any_error`.

Build: `cargo build -p arrow-tee --target wasm32-wasip2 --release`. Then copy the wasm to `release/` and write its sha256.

**Frozen at 2026-11-12 18:00 GMT+7.** After that, changes need the human's explicit OK: a change means a new hash, a new secret slot and a new program key.
