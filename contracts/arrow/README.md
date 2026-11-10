# contracts/arrow

Market contract (`arrow-market.near` on mainnet, `arrow.arrowhq.testnet` on testnet). near-sdk 5.30.1.
The owner is the contract account itself: once its access keys are deleted, the admin methods are closed for good.

## Interface

The tests are the source of truth; this is a map.

### Methods
| Method | Who | What |
|---|---|---|
| `new(cfg: Config)` | deploy | `{"cfg": {...}}`. `secrets_ref.account_id` must be the contract itself. `testnet_caps` is required on the testnet build and rejected on the mainnet build |
| `mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg)` | `intents.near` | NEP-245 notification. One token (`cfg.usdc_token_id`, prefixed `nep141:…`), one amount, `sender_id == previous_owner_ids[0]`. Returns the unused amount as `["<n>"]` |
| `ft_on_transfer(sender_id, amount, msg)` | `cfg.usdc_token_id` | testnet build only (arrow-usd). Returns `"<n>"` |
| `on_eval(eval_id)`, `on_release(purchase_id)`, `on_program_key()` | self (callbacks) | read the raw OutLayer result; `null`, a bad payload, `ok:false` or a wrong `h` refund in full |
| `init_program_key()` (payable, ≥ `outlayer_deposit_release`), `set_program(url, hash)`, `set_config(patch)`, `set_paused(paused)` | self only | `set_program` clears the program key; listings sealed to the old program get E13 |
| `fund_tank()` | anyone (payable) | NEAR for OutLayer deposits and storage |
| `request_eval(eval_id)`, `request_release(purchase_id)` | anyone (the relayer) | escrow build only, else E16. The notification holds the fee or price and returns the overpay; this call starts OutLayer. A second call fails with E17 |
| `refund_stale(kind, id)` | anyone, also while paused | escrow build only. `kind` = `eval` or `buy`; after 15 minutes without a request, pays the held amount back (reason `stale`) |
| `get_config`, `program_pubkey`, `get_listing(listing_id)`, `get_listings(from_index, limit)`, `get_eval(eval_id)`, `get_evals_by_listing(listing_id, from_index, limit)`, `get_purchase(purchase_id)`, `leak_budget(listing_id)`, `version` | views | ids start at 1; `get_listings` reads ids ≥ `from_index`, `get_evals_by_listing` skips `from_index` entries; pages are capped at 50. `get_eval` never returns `sealed_criteria` |

### `msg`
JSON with `"op"`: `list`, `eval` or `buy`. Unknown fields and unknown ops are rejected; ids are JSON numbers, amounts are strings.
Shared vectors: `fixtures/msg-vectors.json`.

| op | Fields | Amount |
|---|---|---|
| `list` | `title, public_desc, columns, rows_claimed, blob_url, blob_sha256, sealed_k, price, eval_fee, max_evals, mode, payout?` | ≥ `listing_bond` (sent to the treasury) |
| `eval` | `listing_id, sealed_criteria, buyer_pk` | ≥ listing `eval_fee` (90 % seller / 10 % treasury on success) |
| `buy` | `listing_id, buyer_pk` | ≥ listing `price` (98 % seller / 2 % treasury on success) |

Anything above the required amount is returned as unused. Each eval counts against the listing's leak budget when it is accepted and is never given back, not even on refund. When the budget is spent, `eval` fails with E09 and `buy` still works.

### Errors
Every panic reads `Arrow: Exx <text>`. A panic inside a transfer notification refunds the whole amount.

| Code | Text |
|---|---|
| E01 | `predecessor is not the intents contract` |
| E02 | `wrong token` |
| E03 | `expected exactly one token, amount and owner` |
| E04 | `bad msg: <field>` |
| E05 | `paused` |
| E06 | `program key not initialised` |
| E07 | `unknown listing` |
| E08 | `amount below required` |
| E09 | `leak budget exhausted` |
| E10 | `gas tank low` |
| E11 | `daily eval cap reached for account` (testnet) |
| E12 | `daily global eval cap reached` (testnet) |
| E13 | `listing sealed to an old program` |
| E14 | `self-only method` |
| E15 | `bad config: <field>` |
| E16 | `escrow path disabled` |
| E17 | `wrong state` |
| E18 | `not stale yet` |
| E20 | `intents disabled on this build` |

### Events
NEP-297, `standard:"arrow"`, `version:"1.0.0"`, `data` is an object (not an array).

```
EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_listed","data":{"listing_id":1,"seller":"0x…","payout":"0x…","title":"…","mode":"scored","price":"250000","eval_fee":"100000","max_evals":20,"bits_per_eval_milli":5673,"budget_milli":113460,"blob_sha256":"…","program_wasm_hash":"…"}}
EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_eval","data":{"phase":"accepted","listing_id":1,"eval_id":1,"buyer":"0x…","fee":"100000","spent_milli":5673,"left_milli":107787}}
EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_purchase","data":{"phase":"done","listing_id":1,"purchase_id":1,"buyer":"0x…","price":"250000","h":"…"}}
EVENT_JSON:{"standard":"arrow","version":"1.0.0","event":"arrow_refund","data":{"kind":"eval","listing_id":1,"id":1,"reason":"null","amount":"100000"}}
```
`arrow_eval` and `arrow_purchase` have `phase` `accepted` (in the notification) and `done` (with `h`). Refund reasons: `null`, `bad_output`, `not_ok`, `hash_mismatch`, and `stale` (escrow only).

### Payment path
`version()` and `get_config()` report `payment_path`. `notify` (default): the notification calls OutLayer and the callback returns the unused amount, so `intents.near` refunds the buyer. `escrow` (compile-time switch `ARROW_PAYMENT_PATH=escrow`, or the committed default in `src/paths.rs`): the contract holds the fee or price and pays refunds itself; its callbacks return `null`.

### Gas
- Testnet: `ft_transfer_call` to the contract needs **300 TGas + 1 yoctoNEAR**.
- Mainnet: the transfer intent carries `min_gas` **300 TGas**.
- Inside: OutLayer `request_execution` 150 TGas, `on_eval` / `on_release` 60 TGas plus the rest, payouts 15 TGas each.

Gas burnt by the contract's own receipts, measured in the sandbox (`cargo test -p arrow --test sandbox gas_profile -- --nocapture`, 2026-11-10; the suite fails above 40 TGas):

| Flow | Notification (`mt_on_transfer` / `ft_on_transfer`) | Callback (`on_eval` / `on_release`) |
|---|---|---|
| eval, mainnet build | 3.29 TGas | 2.71 TGas |
| eval, testnet build | 3.42 TGas | 2.66 TGas |
| buy, mainnet build | 2.84 TGas | 2.69 TGas |
| buy, testnet build | 2.82 TGas | 2.65 TGas |

### Build
```bash
cargo near build non-reproducible-wasm --manifest-path contracts/arrow/Cargo.toml --no-abi --locked                      # mainnet
cargo near build non-reproducible-wasm --manifest-path contracts/arrow/Cargo.toml --no-abi --locked --features testnet   # testnet
cargo test -p arrow --lib && cargo test -p arrow --lib --features testnet
```
