# contracts/arrow

Market contract (`arrow-market.near` on mainnet, `arrow.arrowhq.testnet` on testnet). near-sdk 5.30.1, about 500 lines.
Spec: KICKOFF.md §2.5, plus architect spec §3.3-3.4.

What goes here:
- `new(cfg)`. `usdc_token_id` keeps its prefix (`nep141:17208628…`). The owner is the contract itself.
- `mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg)` handles `op` = `list` | `eval` | `buy`. It panics, which refunds in full, unless `predecessor == intents.near` and the token is USDC.
- `on_eval` / `on_release` read the raw promise result as `Option<ArrowOut>`. A `null`, a deserialize error or `ok:false` returns `[amount]` plus an `arrow_refund` event. Success returns `[amount - fee]` (red-team B3, B8).
- `on_program_key`, `init_program_key` and `set_program` / `set_paused` (self only, so they close forever at the lock).
- `ft_on_transfer` and the daily eval caps, both under `#[cfg(feature = "testnet")]`.
- NEP-297 events: `arrow_listed`, `arrow_eval`, `arrow_purchase`, `arrow_refund`.

Tests (near-workspaces 0.24.0, with `contracts/mock-outlayer`):
- list / eval / buy happy paths
- `refund_on_null_result`
- `refund_on_yield_timeout` (`fast_forward(201)`)
- `max_evals`
- wrong token or predecessor
- empty gas tank
- self-only methods
- 2 modes × 2 networks matrix

Build: `cargo near build non-reproducible-wasm` (dev), `cargo near build reproducible-wasm` (final, needs Docker).
