# release/BUILD.md: arrow-tee build record (frozen)

Status: **frozen.** `release/arrow-tee.wasm` and `release/sha256.txt` are the output of `bash scripts/build-tee-docker.sh` at the source commit below (two clean runs, byte-identical). The same bytes are served at `https://test.fastfs.io/arrowhq.testnet/outlayer.testnet/6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1.wasm` and are the `program_wasm_hash` of arrow-v2.arrowhq.testnet. Any change under `enclave/`, `fixtures/minhash-params.json`, `Cargo.lock`, `Cargo.toml` or `rust-toolchain.toml` now means a new sha, a new OutLayer secret row and re-listing.

## Build command (canonical)

```bash
bash scripts/build-tee-docker.sh              # needs Docker; prints the sha256 of target/tee-docker/arrow-tee.wasm
```

It builds the committed `HEAD` (`git archive`, so uncommitted edits are not in it) inside `sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234` (the image of the NEP-330 contract build) with `--platform linux/amd64`, and there runs `scripts/build-tee.sh`, which runs, from the repo root:

```bash
unset CARGO_ENCODED_RUSTFLAGS                 # and it stops if any CARGO_PROFILE_RELEASE_* is set
CARGO_TARGET_DIR="$ROOT/target/rel-tee" \
RUSTFLAGS="--remap-path-prefix=$HOME=/h --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/h/.cargo --remap-path-prefix=$ROOT=/w" \
cargo build -p arrow-tee --target wasm32-wasip2 --release --locked
```

Why one build host: the sha depends on the target triple of the machine that builds, not only on the source. Cargo hashes the `host:` line of `rustc -vV` into the `-C metadata` of every build script and proc macro, and every crate that depends on one (here `generic-array`, `serde`, `zerocopy`, `serde_json` and everything above them, including `arrow-core` and `arrow-tee`) inherits it. That value feeds symbol names, type ids and code layout, so the bytes differ; `strip` does not remove the difference. The canonical host is `x86_64-unknown-linux-gnu`. Without Docker, the native `bash scripts/build-tee.sh` gives the same sha only on `x86_64-unknown-linux-gnu` with rustup (CI checks both builds); on any other host it gives a different, non-canonical sha (macOS arm64: `2d2dc4d0…`). Proof that the host line is the only difference: on macOS, `RUSTC=scripts/dev/rustc-fixed-host.sh bash scripts/build-tee.sh target/rel-tee-shim` passes every call to the real rustc and only reports `host: x86_64-unknown-linux-gnu` to Cargo's `rustc -vV` query, and it prints the canonical sha (measured on macOS arm64). It is a check of the cause, not a build path.

Why these RUSTFLAGS: without the remaps, panic and source-location strings embed the absolute checkout path, so the same source gives a different sha in every checkout or worktree. Dependency sources sit under `CARGO_HOME`, which is not always under `$HOME`, so it gets its own remap; `$ROOT` is remapped last because it sits under `$HOME` and rustc applies the last matching prefix. No other RUSTFLAGS are used, and `CARGO_ENCODED_RUSTFLAGS` or a `CARGO_PROFILE_RELEASE_*` override would change the wasm, so the script drops the first and refuses the second. The separate target dir keeps the remapped build from invalidating the native build cache. `--locked` pins the dependency tree to `Cargo.lock`.

Release profile (workspace `Cargo.toml`): `codegen-units = 1`, `opt-level = "z"`, `lto = true`, `debug = false`, `panic = "abort"`, `overflow-checks = true`. The `dev-endpoints` feature is off.

## Toolchain

Inside the canonical image (`rustc -vV`, `cargo --version`):

```
rustc 1.97.1 (8bab26f4f 2026-07-14)
binary: rustc
commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452
commit-date: 2026-07-14
host: x86_64-unknown-linux-gnu
release: 1.97.1
LLVM version: 22.1.6
cargo 1.97.1 (c980f4866 2026-06-30)
```

`rust-toolchain.toml`: channel 1.97.1, targets `wasm32-unknown-unknown`, `wasm32-wasip2`. wasmtime is a local test runtime only, not part of the build.

## Inputs

- `shasum -a 256 Cargo.lock`: `a152e5a294ed2dfdfe9db1ada90f86a8c8becace0e0d23e942beba12bc2a7c19`
- Last commit that changed a wasm input: `6b5eead` (fix(enclave): delete invisible characters before NFKC when normalizing MinHash keys)
- Embedded at compile time: `fixtures/minhash-params.json` (`include_str!` in `enclave/arrow-core/src/minhash.rs`). `fixtures/llm-request-example.json` is the byte-exact golden for the NEAR AI request the wasm builds; it freezes with the wasm.

## Expected sha256

| | value |
|---|---|
| frozen sha256 | `6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1` (canonical: `scripts/build-tee-docker.sh`, `x86_64-unknown-linux-gnu`) |
| size | 1698528 bytes |
| candidate source | main `e48fbdc` (round-2 delta fixes merged; MinHash key normalization changed in `6b5eead`); no wasm input changed since |
| reproduced | the image on macOS arm64 (OrbStack, Rosetta), twice; `rust:1.97.1` linux/amd64; GitHub `ubuntu-24.04` native (CI run 42934861136, job `tee`): same sha |
| testnet rc (before the freeze) | rc4 `2d2dc4d0c6aff708105f208d8afd9b71081cea9a7fe400a4b7eec2927ef38ee1` (1696881 bytes) ran on arrow-v2.arrowhq.testnet until the freeze: the same source built on a macOS arm64 host, so not canonical. rc3 `b2786f85…`, rc2 `5daa76fb…`, the first rc `73415b8f…` and the earlier candidate `d5ea438c…` are void |
| freeze commit | source `e30036d` (the tree `build-tee-docker.sh` archived; no wasm input changed after `6b5eead`) |
| freeze built (UTC) | 2026-11-11T18:13:00Z (second of two runs; the first, 18:12:24Z, gave the same bytes) |
