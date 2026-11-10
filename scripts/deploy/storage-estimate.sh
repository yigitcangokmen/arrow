#!/usr/bin/env bash
# Usage: bash scripts/deploy/storage-estimate.sh [<wasm>]   (default release/contracts/arrow-mainnet.wasm)
# Prints the NEAR to send to the market account before the deploy: wasm bytes × 1e-5 NEAR (storage price
# 1e19 yoctoNEAR per byte) + 0.5 NEAR for state, rounded up to 0.1 NEAR (WS1-T17).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
W=${1:-release/contracts/arrow-mainnet.wasm}
[ -f "$W" ] || { echo "storage-estimate: $W missing" >&2; exit 1; }
B=$(wc -c <"$W" | tr -d ' ')
T=$(( (B + 9999) / 10000 + 5 )) # tenths of NEAR: ceil(B × 1e-5 × 10) + 0.5 NEAR
echo "wasm: $W $B bytes"
echo "deposit: $((T / 10)).$((T % 10)) NEAR"
