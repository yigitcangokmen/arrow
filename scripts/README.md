# scripts/ (@arrow/scripts)

Node scripts run with `tsx` from the repo root. Server-side only: this package uses `near-api-js` 7.4.0.

- `src/verify.ts` (`npm run verify`): read-only check of historical txs through archival RPC (mainnet and testnet). OutLayer attestations come from `api.outlayer.ai` / `testnet-api.outlayer.ai`; 1Click status from `/v0/status`. Listings created before the lock are labelled "pre-lock". `--decrypt-demo` decrypts demo purchase #1.
- `src/try-testnet.ts` (`npm run try:testnet`): judge flow. Creates an account through the faucet, falling back to the hosted sponsor; mints arrow-usd; runs list → eval → buy → decrypt. If credit or the cap is exhausted it points the user to `bench:offline`.
- `src/e2e-testnet.ts`, `src/e2e-mainnet.ts`: builder end-to-end runs.
- `src/balances.ts --ops` (checks in `src/lib/ops.ts`, scheduled by `.github/workflows/ops.yml`): the H-23 upkeep check. Tank (`tank_available`), paused, program key, program hash against `release/`, the program wasm URL (GET and sha decide, FastFS answers HEAD 404), the OutLayer secret row, a `max_tokens` 1 NEAR AI probe, relayer, hosted routes, demo listings' ciphertext.
- `src/fastfs-check.ts`: after a FastFS upload, every chunk tx must be FINAL and the URL must serve the sha.
- `deploy/mainnet-check.sh pre | post | wasm`: read-only checks around the mainnet deploy; `wasm` fails when the contract wasm is older than the contract source (`deploy/mainnet.md` says how to rebuild).
- `src/setup-relayer.ts`: adds the FunctionCall key (receiver `intents.near`, method `execute_intents`, unlimited allowance).
- `src/replay.ts` (`npm run replay`): verifies the NEAR AI signatures recorded for the bench's direct calls only. Signature lookups are best-effort, so the output is "captured/total".
