#!/usr/bin/env bash
# Usage: bash scripts/deploy/render-init.sh <testnet|mainnet>
# Prints the one-line init argument for `new`: {"cfg": <Config>} with the program URL and sha256
# from .env filled in. Writes no file; the templates stay bare Config objects.
#   near contract deploy <acct> use-file <wasm> with-init-call new json-args "$(bash scripts/deploy/render-init.sh mainnet)" …
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
net=${1:-}
case "$net" in testnet|mainnet) ;; *) echo "usage: render-init.sh <testnet|mainnet>" >&2; exit 2 ;; esac

PROGRAM_WASM_URL=${PROGRAM_WASM_URL:-}
PROGRAM_WASM_SHA256=${PROGRAM_WASM_SHA256:-}
if [ -f .env ]; then
  [ -n "$PROGRAM_WASM_URL" ] || PROGRAM_WASM_URL=$(grep -E '^PROGRAM_WASM_URL=' .env | tail -1 | cut -d= -f2- || true)
  [ -n "$PROGRAM_WASM_SHA256" ] || PROGRAM_WASM_SHA256=$(grep -E '^PROGRAM_WASM_SHA256=' .env | tail -1 | cut -d= -f2- || true)
fi
[ -n "$PROGRAM_WASM_URL" ] || { echo "render-init: PROGRAM_WASM_URL is empty (.env)" >&2; exit 1; }
[ -n "$PROGRAM_WASM_SHA256" ] || { echo "render-init: PROGRAM_WASM_SHA256 is empty (.env)" >&2; exit 1; }
case "$PROGRAM_WASM_URL" in https://*) ;; *) echo "render-init: PROGRAM_WASM_URL must start with https://" >&2; exit 1 ;; esac
[[ "$PROGRAM_WASM_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "render-init: PROGRAM_WASM_SHA256 must be 64 lowercase hex" >&2; exit 1; }

jq -c --arg url "$PROGRAM_WASM_URL" --arg hash "$PROGRAM_WASM_SHA256" \
  '.program_wasm_url = $url | .program_wasm_hash = $hash | {cfg: .}' "scripts/deploy/init-$net.json"
