# release/

The frozen enclave program: `arrow-tee.wasm` and `sha256.txt` (lowercase 64-hex), built with `bash scripts/build-tee-docker.sh` at the freeze (2026-11-11T18:13Z). How to rebuild it: [BUILD.md](BUILD.md).

The same bytes are served at the `PROGRAM_WASM_URL` on testnet FastFS: `https://test.fastfs.io/arrowhq.testnet/outlayer.testnet/6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1.wasm`. The URL is hash-pinned, so the host only affects liveness.

This sha256 must equal the contract's `program_wasm_hash` and the `wasm_hash` in OutLayer attestations on both networks.
