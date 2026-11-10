#!/usr/bin/env bash
# Usage: bash scripts/build-contracts.sh [--sandbox | --testnet]
#   --sandbox (default)  6 wasm for the sandbox suite: arrow-mainnet, arrow-mainnet-escrow, arrow-testnet,
#                        arrow-testnet-escrow, arrow-usd, mock-outlayer
#   --testnet            arrow-testnet + arrow-usd only (deploy)
# Output: target/wasm/<name>.wasm, target/wasm/SHA256SUMS, and one base58 code hash line per file.
# The "notify" variants build with ARROW_PAYMENT_PATH unset, so they follow the committed default in
# contracts/arrow/src/paths.rs (what the reproducible mainnet build runs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode=${1:---sandbox}
case "$mode" in
  --sandbox | --testnet) ;;
  --reproducible) echo "build-contracts: --reproducible is not written yet (WS2-T12b)" >&2; exit 2 ;;
  *) echo "usage: build-contracts.sh [--sandbox | --testnet]" >&2; exit 2 ;;
esac

ARROW=contracts/arrow/Cargo.toml
USD=contracts/arrow-usd/Cargo.toml
MOCK=contracts/mock-outlayer/Cargo.toml

build() { # build <name> <manifest> <payment path: default|escrow> [extra cargo-near flags...]
  local name=$1 manifest=$2 path=$3; shift 3
  local out=target/near/variants/$name
  rm -rf "$out"
  echo "== $name"
  if [ "$path" = escrow ]; then
    ARROW_PAYMENT_PATH=escrow cargo near build non-reproducible-wasm --manifest-path "$manifest" --no-abi --locked --out-dir "$out" "$@"
  else
    env -u ARROW_PAYMENT_PATH cargo near build non-reproducible-wasm --manifest-path "$manifest" --no-abi --locked --out-dir "$out" "$@"
  fi
  local files=("$out"/*.wasm)
  [ ${#files[@]} -eq 1 ] || { echo "build-contracts: expected one wasm in $out" >&2; exit 1; }
  cp "${files[0]}" "target/wasm/$name.wasm"
}

mkdir -p target/wasm
if [ "$mode" = --sandbox ]; then
  rm -f target/wasm/*.wasm target/wasm/SHA256SUMS
  build arrow-mainnet "$ARROW" default
  build arrow-mainnet-escrow "$ARROW" escrow
  build arrow-testnet "$ARROW" default --features testnet
  build arrow-testnet-escrow "$ARROW" escrow --features testnet
  build arrow-usd "$USD" default
  build mock-outlayer "$MOCK" default
else
  build arrow-testnet "$ARROW" default --features testnet
  build arrow-usd "$USD" default
fi

(cd target/wasm && shasum -a 256 ./*.wasm | sed 's#  \./#  target/wasm/#' > SHA256SUMS)
cat target/wasm/SHA256SUMS
python3 - target/wasm/*.wasm <<'PY'
import hashlib, sys
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58(b):
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = ALPHABET[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
for path in sys.argv[1:]:
    with open(path, "rb") as f:
        print(f"code_hash {b58(hashlib.sha256(f.read()).digest())}  {path}")
PY
