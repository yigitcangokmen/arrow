# enclave/arrow-core

Pure, panic-free evaluation logic shared by `arrow-tee`. Tested natively with `cargo test -p arrow-core`, so judges can run it without OutLayer.
Behaviour is pinned by the vectors in `fixtures/`.

Modules:
- `parse`: CSV/JSONL, ≤5 MB.
- `stats`: rows, columns, null rate, duplicate rate, date range.
- `minhash`: k=128, using the parameters and vectors in `fixtures/`.
- `fit_rule`.
- `regex`: injection patterns (instruction-only; never a bare `BUY`) and exfil patterns.
- `compose`: `fit = min(fit_llm, fit_rule)`, the BUY gates, guard → `PASS·1·1`.
- `schema`: output enum, ≤900 bytes (target ≤400).

Rules:
- `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing)]`.
- Errors are a fixed enum and carry no data.

Required tests:
- `output_space_is_at_most_51_states`
- `regex_no_false_positive_on_buy_sell_column`
- `minhash_matches_ts_vectors`
