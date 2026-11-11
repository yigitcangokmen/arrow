#!/usr/bin/env bash
# Usage: RUSTC=scripts/dev/rustc-fixed-host.sh bash scripts/build-tee.sh target/rel-tee-shim   (a check, not the canonical build)
# Proof of why the arrow-tee sha depends on the build host (release/BUILD.md): Cargo hashes the `host:` line of `rustc -vV`
# into the -C metadata of build scripts and proc macros. This passes every call to the real rustc and only reports the
# canonical host triple to that query, so a native build on another host prints the canonical sha.
REAL="$(rustup which rustc)"
if [ "$*" = "-vV" ]; then "$REAL" -vV | sed 's/^host: .*/host: x86_64-unknown-linux-gnu/'; else exec "$REAL" "$@"; fi
