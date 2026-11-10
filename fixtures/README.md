# fixtures/

- `blobs/`: ciphertexts of the demo listings (`<sha256>.bin`), also served from `web/public/blobs/`. The host is untrusted because the sha256 is on chain.
- `team-made/`: the team's real dataset, NEAR mainnet chain statistics (200 rows, one per 600 blocks, about 19 hours) computed from public RPC, November 2026. `SOURCE.md` names the RPC endpoint, the block heights and the UTC collection time. Labelled "team-made" and not synthetic. Rebuild with `npx tsx scripts/src/collect-chain-stats.ts`; `--check` verifies it without network.
- Demo datasets: fictional and labelled "synthetic".
- `minhash-params.json`, `minhash-vectors.json`, `ecies-vectors.json`: shared TS ↔ Rust test vectors.
- `criteria/`: example buyer criteria, including `print-row-1.json` (README step 7) and `demo.json`.

No keys here. The demo buyer viewing key, if kept, is derived in code from a public label, not stored as a key file.

## Shared vectors (binding)

Contract (serde), SDK (zod) and enclave parse the same JSON. These files are the single source; each side tests against them, and a side that drifts goes red. Regenerate with `npx tsx scripts/src/gen-fixtures.ts` and `npx tsx scripts/src/gen-minhash-params.ts`; both take `--check` (byte-identical). Tests: `npx vitest run scripts/test/fixtures.test.ts`. Any change is its own small commit plus a line in the ledger's Announcements.

| File | What |
|---|---|
| `msg-vectors.json` | `msg` for `list` / `eval` / `buy`: `valid[]` and `invalid[]` with `reason` and `stage` |
| `input-vectors.json` | wasm `input_data` for `eval` / `release` / `derive`; invalid ones must make the enclave print `{"v":1,"ok":false}` |
| `output-vectors.json` | wasm output `raw` bytes + `context` + the contract's `contract_decision` |
| `state-index-vectors.json` | 50 scored states + verdict mode + guard + bits per eval |
| `criteria-schema.json` | buyer criteria, JSON Schema 2020-12, `x-arrow-max-bytes: 2975` |
| `criteria-vectors.json` | valid / invalid criteria examples |
| `minhash-params.json` | 128 × (a, b) mod 2^61 − 1 |

Encoding rules:
- Hex is lowercase everywhere, without `0x`. `blob_sha256` is 64 hex. `buyer_pk` is a 65-byte uncompressed secp256k1 key = 130 hex starting with `04`.
- Base64 is the standard alphabet with `=` padding (RFC 4648 §4), not URL-safe.
- Amounts (`price`, `eval_fee`) are JSON strings holding a u128 without decimals (USDC has 6 decimals: `"250000"` = $0.25). `listing_id`, `max_evals`, `rows_claimed` are JSON numbers (u64, inside JS safe range).
- Unknown fields are rejected in `msg` (serde `deny_unknown_fields`, zod `.strict()`).
- `payout` (optional): an Intents account id `^0x[0-9a-f]{40}$` or a NEAR account name (2-64 chars, `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$`). Absent means seller = `sender_id`. `blob_url` starts with `https://` and has no whitespace or control characters.
- Each `msg` case has either `msg` (an object; tests serialize it with `JSON.stringify` / `serde_json::to_string`) or `msg_raw` (a string, used as is). `stage: "parse"` is the schema; `stage: "config"` is the contract's check against its config (zod tests skip `config`, contract tests expect the rejection).
- ECIES profile `eciesjs-0.4-default`: ephemeral pk 65 + nonce 16 + tag 16 = 97 bytes overhead. `sealed_k` = ECIES(K ‖ blob_sha256 ‖ sha256(utf8(seller))) = 193 bytes → 260 base64 chars; `seller` is the account the contract sees as `sender_id` (lowercase `0x…` on Intents) and is passed to the enclave in `listing.seller`. `r` = 98 bytes → 132. `k` = 129 bytes → 172. If S4-b moves to the fallback ECIES, the side that changes the vectors announces the new lengths.
- No private keys in these files. `r`, `k`, `sealed_k`, `sealed_criteria` are filler bytes of the right length (`sha256("arrow/fixture/" + name)` chain); the contract never decrypts them. Real round-trip vectors are in `ecies-vectors.json`. Test keys are derived in code from labels: `sk = sha256(utf8(label))` (for secp256k1 `mod n`, and label + "/1" if that is 0).
- Wasm outputs have a fixed field order and no trailing newline: eval 227 bytes, release 267, derive 155, error 18. Limit 900 (OutLayer blockchain mode), target 400. In `output-vectors.json` only the `accept_*` cases are valid outputs.
- Criteria: the minified UTF-8 JSON is at most 2975 bytes. `sealed_criteria` = ECIES(sha256(buyer_pk 65 bytes ‖ listing_id u64 big-endian) ‖ criteria JSON) ≤ 97 + 32 + 2975 = 3104 bytes → ≤ 4140 base64 chars; the enclave refuses it under another `buyer_pk` or listing. `minhash` is one 2048-char lowercase hex string (128 values × 16 hex, in order), not an array. Byte count = `Buffer.byteLength(JSON.stringify(criteria))`.

MinHash (binding): `x = BE_u64(sha256(normalize(key))[0..8])`; `h_i(x) = (a_i·x + b_i) mod p` computed in 128 bits (Rust `u128`, TS `BigInt`), x is not reduced first; the signature is the minimum per i; each value is written as 16 lowercase hex, zero-padded; the empty set is `"ffffffffffffffff"` × 128. `normalize`: trim → delete every Default_Ignorable_Code_Point (the explicit list in `sdk/src/minhash.ts` and `enclave/arrow-core/src/normalize.rs`; before NFKC, because one between a letter and its combining mark blocks composition) → NFKC → lowercase → delete them again → delete a U+0307 that directly follows `i` → collapse whitespace runs to one space → trim.
