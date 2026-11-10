# release/

The frozen enclave program: `arrow-tee.wasm` and `sha256.txt` (lowercase 64-hex), produced at the freeze on 2026-11-12 18:00 GMT+7.

The same bytes must be reachable at the public HTTPS `PROGRAM_WASM_URL` (GitHub release once the repo is public, or `web/public/release/`). OutLayer cannot download release assets from a private repo.

This sha256 must equal the contract's `program_wasm_hash` and the `wasm_hash` in OutLayer attestations on both networks.
