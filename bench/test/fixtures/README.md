# bench/test/fixtures

Hand-made inputs for the bench unit tests. **They are not run results and not recorded transactions.** The numbers in `results/` only exercise the code in `bench/test`; they are never copied to `bench/results/`. `tx-eval-*.json` follow the event shapes in `contracts/arrow/src/events.rs` and the OutLayer contract's `execution_requested` / `execution_completed` events; WS6-T06 replaces them with a recorded testnet transaction.
