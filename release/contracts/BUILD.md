# release/contracts

`arrow-mainnet.wasm` is the NEP-330 reproducible build of `contracts/arrow` (mainnet features, committed default
payment path). Rebuild from the listed commit with `bash scripts/build-contracts.sh --reproducible` (Docker), or with
`cargo near build reproducible-wasm --manifest-path contracts/arrow/Cargo.toml`, and compare the sha256.

| Built (UTC) | Commit | Image | cargo-near (host) | rustc (container) | sha256 | Code hash (base58) |
|---|---|---|---|---|---|---|
| 2026-11-10T11:20:12Z | 2683d6d351cbba9d98270414a9b8d776da043f1e | sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234 | cargo-near-near 0.23.0 | rustc 1.97.1 (8bab26f4f 2026-07-14) | 24fe374ac7b4410a6324bfd924bdcfa9a1dab50829dba21aaeea8c10876d4def | 3VQWQdgKar9n2xtWFsGkmGrVM9yXXUQZXsA5BZRwwynE |
| 2026-11-11T19:11:24Z | 6ae732d34eafa4a35f3e7b01a14d91ba46f3ec0e | sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234 | cargo-near-near 0.23.0 | rustc 1.97.1 (8bab26f4f 2026-07-14) | f59f35e7a454fe9377cc26d40c0830cb09a20797154cbeae4d35970af86e7b80 | HXohArFyu1SdovFgdxgMVpZjrqQoWtNd7XY1hdu7L8fH |
