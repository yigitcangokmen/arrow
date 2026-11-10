# contracts/mock-outlayer

Sandbox-only stand-in for `outlayer.near.request_execution` (same 7-parameter signature and input checks) and for the intents contract's `mt_transfer` (records transfers, keeps no balances). Used to test red-team B3: real OutLayer returns a successful `null` on failure or yield timeout, not a `PromiseError`.

The mode comes from `?mock=<mode>` in `input_data.listing.blob_url`, else from `set_mode`, else `auto`:
- `auto`: a well-formed `{"v":1,"ok":true,…}` for `eval` (`r` 98 bytes), `release` (`k` 129 bytes) or `derive` (`pk`), with `h` = the listing's `blob_sha256`.
- `null`: resolve with `null`.
- `late`: `{"v":1,"ok":false}` (the enclave's time guard fired).
- `badhash`, `wrongv`, `shortr`, `garbage`: malformed success outputs.
- `panic`: the call itself fails.
- `never`: yield and never resume, so it times out after `fast_forward(210)` and answers `null`.
- `ok:<json>` (only through `set_mode`): resolve with the given payload.

The unused deposit (minus the 0.001 NEAR base fee) goes back to `payer_account_id`, as on OutLayer. Not deployed anywhere.
