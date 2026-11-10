# sdk/ (@arrow/sdk)

Shared TypeScript used by `web/`, `agent/`, `scripts/` and `bench/`.

Contents:
- `seal`: ECIES to `program_pubkey` / `buyer_pk` via `eciesjs` (must interoperate with Rust `ecies =0.2.11`, gate S4-b).
- `encryptFile`: XChaCha20-Poly1305 via `@noble/ciphers`, laid out as 24-byte nonce ‖ ct ‖ tag.
- `minhash`: same parameters and vectors as `arrow-core`.
- `buildIntent`: ERC-191 transfer intent carrying `msg` and `min_gas`, via `@defuse-protocol/intents-sdk`.
- `viewingKey`: `keccak256(personal_sign(msg))`. The message carries the domain and a warning. EOA only.
- `oneClick`: quote and status calls.
- relayer client.
- zod schemas for `msg`, mirroring the serde types.

No `near-api-js` in this package (red-team B8: intents-sdk already brings `near-api-js ^4 || ^5`).
