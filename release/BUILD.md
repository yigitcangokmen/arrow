# release/BUILD.md: arrow-tee build record (DRAFT, freeze candidate)

Status: **freeze candidate, not frozen.** The freeze (K3, 2026-11-12 18:00 GMT+7 [11:00Z]) rebuilds from the freeze commit with the same command, writes `release/arrow-tee.wasm` and `release/sha256.txt`, and fills in the two "freeze" lines below. If anything under `enclave/`, `fixtures/minhash-params.json`, `Cargo.lock`, `Cargo.toml` or `rust-toolchain.toml` changes before then, the expected sha changes and this candidate is void.

## Build command

```bash
bash scripts/build-tee.sh target/rel-tee      # prints the sha256 of arrow-tee.wasm
```

`scripts/build-tee.sh` runs, from the repo root (`ROOT=$(git rev-parse --show-toplevel)`):

```bash
unset CARGO_ENCODED_RUSTFLAGS                 # and it stops if any CARGO_PROFILE_RELEASE_* is set
CARGO_TARGET_DIR="$ROOT/target/rel-tee" \
RUSTFLAGS="--remap-path-prefix=$HOME=/h --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/h/.cargo --remap-path-prefix=$ROOT=/w" \
cargo build -p arrow-tee --target wasm32-wasip2 --release --locked
```

Why these RUSTFLAGS: without the remaps, panic and source-location strings embed the absolute checkout path (`/Users/...`), so the same source gives a different sha in every checkout or worktree. Dependency sources sit under `CARGO_HOME`, which is not always under `$HOME`, so it gets its own remap; `$ROOT` is remapped last because it sits under `$HOME` and rustc applies the last matching prefix. No other RUSTFLAGS are used, and `CARGO_ENCODED_RUSTFLAGS` or a `CARGO_PROFILE_RELEASE_*` override would change the wasm, so the script drops the first and refuses the second. With these rules the sha does not depend on `CARGO_HOME`. The separate target dir keeps the remapped build from invalidating the native build cache. `--locked` pins the dependency tree to `Cargo.lock`.

Release profile (workspace `Cargo.toml`): `codegen-units = 1`, `opt-level = "z"`, `lto = true`, `debug = false`, `panic = "abort"`, `overflow-checks = true`. The `dev-endpoints` feature is off.

## Toolchain

```
rustc 1.97.1 (8bab26f4f 2026-07-14)
binary: rustc
commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452
commit-date: 2026-07-14
host: aarch64-apple-darwin
release: 1.97.1
LLVM version: 22.1.6
cargo 1.97.1 (c980f4866 2026-06-30)
wasmtime 50.0.1 (c307ec81d 2026-10-29)      # local test runtime only, not part of the build
```

`rust-toolchain.toml`: channel 1.97.1, targets `wasm32-unknown-unknown`, `wasm32-wasip2`.

## Inputs

- `shasum -a 256 Cargo.lock`: `a152e5a294ed2dfdfe9db1ada90f86a8c8becace0e0d23e942beba12bc2a7c19`
- Last commit that changed a wasm input: `7412dfd` (fix(enclave): abort silently when an allocation fails)
- Embedded at compile time: `fixtures/minhash-params.json` (`include_str!` in `enclave/arrow-core/src/minhash.rs`). `fixtures/llm-request-example.json` is the byte-exact golden for the NEAR AI request the wasm builds; it freezes with the wasm.

## Expected sha256

| | value |
|---|---|
| freeze candidate sha256 | `b2786f85bf91573423577b027019cfc7d7acae620ed38cba7a50db3e5eaef298` |
| size | 1688094 bytes |
| candidate source | main `45ddc38` (second audit fix round merged; wasm inputs unchanged since `7412dfd`) |
| candidate built (UTC) | 2026-11-10T22:34Z |
| reproduced | main checkout and a second worktree: same sha |
| testnet rc (for comparison) | same bytes as the candidate (`release/arrow-tee-rc.*`, rc3 on arrow-v2.arrowhq.testnet); rc2 `5daa76fb…`, the first rc `73415b8f…` and the earlier candidate `d5ea438c…` are void |
| freeze commit | (filled at the freeze) |
| freeze built (UTC) | (filled at the freeze) |
