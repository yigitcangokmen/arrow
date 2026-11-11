#!/usr/bin/env bash
# Usage: bash scripts/build-tee-docker.sh → the canonical arrow-tee build (release/BUILD.md); prints the sha256 of
# target/tee-docker/arrow-tee.wasm. It builds the committed HEAD (git archive: uncommitted edits are not in it) with
# scripts/build-tee.sh inside a pinned linux/amd64 image. Why a fixed host: Cargo hashes the `host:` line of `rustc -vV`
# into the -C metadata of every build script and proc macro, and every crate that depends on one inherits that hash
# (symbol names, TypeIds, code layout). So the sha differs per host triple; the canonical one is x86_64-unknown-linux-gnu,
# on any machine with Docker (Apple silicon runs the image under emulation).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
# Same image and digest as the NEP-330 contract build (contracts/arrow/Cargo.toml), written out here so a bump of the
# contract image never moves this build silently. rust-toolchain.toml picks the compiler inside it.
IMAGE=sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234
OUT=target/tee-docker; mkdir -p "$OUT"
[ -z "$(git status --porcelain)" ] || echo "build-tee-docker: uncommitted changes are not built (git archive HEAD)" >&2
echo "build-tee-docker: HEAD $(git rev-parse HEAD), image $IMAGE, linux/amd64" >&2
git archive --format=tar HEAD | docker run --rm -i --platform linux/amd64 "$IMAGE" bash -c '
  set -euo pipefail; mkdir -p /tmp/w && tar -x -C /tmp/w && cd /tmp/w
  unset RUSTUP_TOOLCHAIN   # the image pins its toolchain through this; rust-toolchain.toml decides (and adds wasm32-wasip2)
  rustc -vV | grep -E "^(release|host):" >&2
  echo "build-tee-docker: container sha256 $(bash scripts/build-tee.sh)" >&2
  cat target/rel-tee/wasm32-wasip2/release/arrow-tee.wasm' > "$OUT/arrow-tee.wasm.part"
mv "$OUT/arrow-tee.wasm.part" "$OUT/arrow-tee.wasm"
shasum -a 256 "$OUT/arrow-tee.wasm" | cut -d' ' -f1
