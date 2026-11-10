# web/ (Next.js 16.4.6)

Hosted on Vercel and kept up until at least 2026-11-18, ideally 2026-11-25 (HACKATHON.md Q-012).

Pages:
- `/sell`: encrypt in the browser, upload to Vercel Blob, seal K, sign `op=list`.
- `/buy/[id]`: criteria plus an optional MinHash of your own list (computed in the browser only), 1Click top-up, sign `op=eval`, decrypt the result, then `op=buy`, decrypt the file and check its hash.
- seller panel: payout from the `0x…` Intents account to Solana via 1Click.
- `/verify`: hash checks, narrowed to what gate S1-b(5) proved. Shows NEAR AI attestation labelled "current endpoint state, not eval-time" and TDX quote verification in the browser via `@phala/dcap-qvl-web`.
- `/attack`: recorded bench tables plus a live "print row 1" try.
- `/try`: hosted testnet flow. It uses `near-api-js` through a dynamic import only.

Server routes:
- `/api/relay`: `simulate_intents` → `execute_intents`, FunctionCall key with unlimited allowance, per-IP rate limit.
- `/api/blob`: Vercel Blob upload.
- `/api/testnet-sponsor`: creates and funds a testnet judge account. The key lives in the Vercel env, never in git.
