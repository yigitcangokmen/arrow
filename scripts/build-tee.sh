#!/usr/bin/env bash
# Usage: bash scripts/build-tee.sh [<target-dir-inside-repo>]   (default target/rel-tee) → prints sha256 of arrow-tee.wasm
# The one build for the rc, the freeze candidate and the freeze (W1-11). The remaps keep absolute paths
# out of the wasm, so the same source gives the same sha256 in any checkout, worktree or CARGO_HOME.
set -euo pipefail
# No git: build-tee-docker.sh runs this on a git archive. pwd -P: ROOT, the target dir and the $ROOT remap below all name
# the physical checkout, also when the script is reached through a symlink (macOS /tmp is /private/tmp).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"; cd "$ROOT"
OUT="${1:-target/rel-tee}"; case "$OUT" in /*) echo "target dir must be relative to the repo" >&2; exit 2;; esac
# CARGO_ENCODED_RUSTFLAGS beats RUSTFLAGS and CARGO_PROFILE_RELEASE_* beats the release profile; either would change the sha silently.
unset CARGO_ENCODED_RUSTFLAGS
if [ -n "$(env | grep -E '^CARGO_PROFILE_RELEASE_' || true)" ]; then echo "build-tee: unset CARGO_PROFILE_RELEASE_* (it changes the wasm)" >&2; exit 2; fi
CH="${CARGO_HOME:-$HOME/.cargo}"   # dependency sources sit under CARGO_HOME, which is not always under HOME (Docker: /usr/local/cargo)
export CARGO_TARGET_DIR="$ROOT/$OUT"
export RUSTFLAGS="--remap-path-prefix=$HOME=/h --remap-path-prefix=$CH=/h/.cargo --remap-path-prefix=$ROOT=/w"   # $ROOT last: last match wins
cargo build -p arrow-tee --target wasm32-wasip2 --release --locked 1>&2
shasum -a 256 "$CARGO_TARGET_DIR/wasm32-wasip2/release/arrow-tee.wasm" | cut -d' ' -f1
