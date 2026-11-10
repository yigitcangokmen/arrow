# bench/ (@arrow/bench)

Numbers come from runs, never from prose. Every synthetic dataset is labelled "synthetic".

- `criteria/`: the attack and quality wrappers: `leak/L01..L55.json`, `quality/Q01-a..Q20-b.json`. Only the `criteria` field of a wrapper is ever sealed and sent; `truth`, `decode`, `expected` and `meta` stay in the bench. **Agent-written; human review: not done yet (H-21 open).** This line changes only when a human has read `REVIEW.md`.
- `datasets/`: 3 fictional leak-bench listings (`leak/`, each with a canary in row 1; LB3 is JSONL and runs in `verdict` mode) and 20 quality-bench listings (`quality/`: 5 clean-good, 5 clean-bad, 10 injected) with one buyer list per listing (`quality/buyers/`, 10% key overlap). Q01 is a clean trading dataset with a `side: BUY/SELL` column to measure false flags. Listing titles start with `[synthetic] bench ...`.
- `injection-room/`: the G5 room, 24 attacks + 2 controls (see its README).
- `REVIEW.md`: one line per attack and listing for the human review; regenerate with `npm run bench:gen -- --review`.
- `src/gen/`, `src/truth.ts`: seeded generators (`npm run bench:gen -- --suite room,leak,quality [--check]`) and the ground-truth predicates.
- `src/live.ts` (`npm run bench:live -- --dry | --preflight | --suite room,quality,leak | --resume`): runs against the testnet enclave with the same wasm hash as mainnet and appends one line per eval to `results/live/<suite>.jsonl`. `--dry` prints the plan (181 evals over 49 listings) and touches nothing.
- `src/prepare.ts` (`npm run bench:prepare`): encrypts the 49 plaintexts into `blobs/` with `blobs/manifest.json`; the keys stay in `~/.config/arrow/bench-keys.json` (mode 0600), never in the repo.
- `src/native.ts` (`npm run bench:native`): the deterministic gates (fit_rule, null counts, dates, novelty band) from the arrow-core example `bench_tool`, written to `results/native-stats.json`. It has no G5 scanner, so it never touches `results/native-gates.json` (the injection-room evidence from `ARROW_WRITE_NATIVE_GATES=1 cargo test -p arrow-core --test injection_room`).
- `src/baselines.ts` (`npm run bench:baselines`): the naive free-text preview and the LLM-only baseline (116 calls) go straight to NEAR AI with fictional data; raw request and response bytes and the signatures are recorded for `replay`.
- `src/offline.ts` (`npm run bench:offline [-- --write | --check | --verify-chain] [--results <dir>]`): recomputes every number from `results/` with no keys and no network (only `--verify-chain` reads the chain). A table with no results prints "not run", never zeros.
- `results/`: raw outputs, committed. `results/schema.json` is generated from `src/schema.ts`.
- `test/fixtures/`: hand-made inputs for the unit tests. They are not results.

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
