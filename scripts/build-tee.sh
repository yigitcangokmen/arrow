#!/usr/bin/env bash
# Usage: bash scripts/build-tee.sh [<target-dir-inside-repo>]   (default target/rel-tee) → prints sha256 of arrow-tee.wasm
# The one build for the rc, the freeze candidate and the freeze (W1-11). The remaps keep absolute paths
# out of the wasm, so the same source gives the same sha256 in any checkout or worktree.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
OUT="${1:-target/rel-tee}"; case "$OUT" in /*) echo "target dir must be relative to the repo" >&2; exit 2;; esac
export CARGO_TARGET_DIR="$ROOT/$OUT"
export RUSTFLAGS="--remap-path-prefix=$HOME=/h --remap-path-prefix=$ROOT=/w"   # $ROOT after $HOME: last match wins
cargo build -p arrow-tee --target wasm32-wasip2 --release --locked 1>&2
shasum -a 256 "$CARGO_TARGET_DIR/wasm32-wasip2/release/arrow-tee.wasm" | cut -d' ' -f1
