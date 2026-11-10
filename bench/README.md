# bench/ (@arrow/bench)

Numbers come from runs, never from prose. Every synthetic dataset is labelled "synthetic".

- `criteria/`: human-written attack and quality criteria (written on 2026-11-09).
- `datasets/`: 3 fictional leak-bench listings and 20 quality-bench listings (5 clean-good, 5 clean-bad, 10 injected). Include one clean trading dataset with a `side: BUY/SELL` column to measure false flags.
- `src/live.ts` (`npm run bench:live`): runs against the testnet enclave with the same wasm hash as mainnet. Naive free-text preview and LLM-only baselines call NEAR AI directly with fictional data, and their signatures are recorded for `replay`.
- `src/offline.ts` (`npm run bench:offline`): re-scores `results/*.json`. Free and needs no keys.
- `results/`: raw outputs, committed.

**leak-bench** (55 attacks):
- 10 verbatim requests
- 15 targeted-bit attempts
- 10 encoding schemes
- 5 single-element MinHash membership tests
- 5 timing attempts
- 5 jailbreaks
- 5 error-path attacks (red-team B1)

It measures: (a) verbatim substrings of ≥20 chars, (b) `1 − H(p)` bits on targeted bits, (c) output entropy, (d) mutual information between `time_ms`/`instructions` and the target bit, (e) whether every output stays within the 51 states.

**quality-bench** (40 evals): BUY/PASS accuracy, BUY rate on injected listings, false flags on clean data, Arrow vs LLM-only.

Plus a 5-attack subset run on mainnet.
