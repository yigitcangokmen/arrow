# release/contracts

`arrow-mainnet.wasm` is the NEP-330 reproducible build of `contracts/arrow` (mainnet features, committed default
payment path). Rebuild from the listed commit with `bash scripts/build-contracts.sh --reproducible` (Docker), or with
`cargo near build reproducible-wasm --manifest-path contracts/arrow/Cargo.toml`, and compare the sha256.

| Built (UTC) | Commit | Image | cargo-near (host) | rustc (container) | sha256 | Code hash (base58) |
|---|---|---|---|---|---|---|
| 2026-11-10T11:20:12Z | f18900821f755bfdc2fa78d8ec878c9a8b0e099b | sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234 | cargo-near-near 0.23.0 | rustc 1.97.1 (8bab26f4f 2026-07-14) | 24fe374ac7b4410a6324bfd924bdcfa9a1dab50829dba21aaeea8c10876d4def | 3VQWQdgKar9n2xtWFsGkmGrVM9yXXUQZXsA5BZRwwynE |
