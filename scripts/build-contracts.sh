#!/usr/bin/env bash
# Usage: bash scripts/build-contracts.sh [--sandbox | --testnet | --reproducible]
#   --sandbox (default)  6 wasm for the sandbox suite: arrow-mainnet, arrow-mainnet-escrow, arrow-testnet,
#                        arrow-testnet-escrow, arrow-usd, mock-outlayer
#   --testnet            arrow-testnet + arrow-usd only (deploy)
#   --reproducible       NEP-330 mainnet build of contracts/arrow in Docker ([package.metadata.near.reproducible_build]),
#                        run twice from the committed HEAD; identical sha256 -> release/contracts/{arrow-mainnet.wasm,
#                        SHA256SUMS,BUILD.md} and evidence/mainnet.json contract_wasm_sha256 (via the evidence CLI).
# Output (--sandbox/--testnet): target/wasm/<name>.wasm, target/wasm/SHA256SUMS, and one base58 code hash line per file.
# The "notify" variants build with ARROW_PAYMENT_PATH unset, so they follow the committed default in
# contracts/arrow/src/paths.rs (what the reproducible mainnet build runs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode=${1:---sandbox}
case "$mode" in
  --sandbox | --testnet | --reproducible) ;;
  *) echo "usage: build-contracts.sh [--sandbox | --testnet | --reproducible]" >&2; exit 2 ;;
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

code_hashes() { # one "code_hash <base58 sha256>  <path>" line per wasm (what NEAR shows as the account's code hash)
  python3 - "$@" <<'PY2'
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
PY2
}

if [ "$mode" = --reproducible ]; then
  [ -z "$(git status --porcelain)" ] || { echo "build-contracts: dirty tree (commit first; the build reads the committed HEAD)" >&2; exit 1; }
  if ! docker info >/dev/null 2>&1; then
    orb start || true
    sleep 60
    docker info >/dev/null 2>&1 || { echo "build-contracts: docker is not running after 'orb start' (HANDOFF H-WS2-a)" >&2; exit 1; }
  fi
  sums=()
  for run in 1 2; do
    out=target/near/arrow-repro-$run
    rm -rf "$out"
    echo "== reproducible run $run"
    cargo near build reproducible-wasm --manifest-path "$ARROW" --out-dir "$out"
    files=("$out"/*.wasm)
    [ ${#files[@]} -eq 1 ] || { echo "build-contracts: expected one wasm in $out" >&2; exit 1; }
    sums+=("$(shasum -a 256 "${files[0]}" | cut -d' ' -f1)")
  done
  [ "${sums[0]}" = "${sums[1]}" ] || { echo "build-contracts: reproducible runs differ: ${sums[0]} vs ${sums[1]}" >&2; exit 1; }
  sha=${sums[0]}
  mkdir -p release/contracts
  cp target/near/arrow-repro-1/*.wasm release/contracts/arrow-mainnet.wasm
  (cd release/contracts && shasum -a 256 arrow-mainnet.wasm > SHA256SUMS)
  image=$(sed -n 's/^image = "\(.*\)"$/\1/p' "$ARROW")
  digest=$(sed -n 's/^image_digest = "\(.*\)"$/\1/p' "$ARROW")
  container_rustc=$(docker run --rm --platform linux/amd64 "$image@$digest" rustc -V)
  code_hash=$(code_hashes release/contracts/arrow-mainnet.wasm | cut -d' ' -f2)
  if [ ! -f release/contracts/BUILD.md ]; then
    cat > release/contracts/BUILD.md <<'MD'
# release/contracts

`arrow-mainnet.wasm` is the NEP-330 reproducible build of `contracts/arrow` (mainnet features, committed default
payment path). Rebuild from the listed commit with `bash scripts/build-contracts.sh --reproducible` (Docker), or with
`cargo near build reproducible-wasm --manifest-path contracts/arrow/Cargo.toml`, and compare the sha256.

| Built (UTC) | Commit | Image | cargo-near (host) | rustc (container) | sha256 | Code hash (base58) |
|---|---|---|---|---|---|---|
MD
  fi
  printf '| %s | %s | %s@%s | %s | %s | %s | %s |\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse HEAD)" \
    "$image" "$digest" "$(cargo near --version)" "$container_rustc" "$sha" "$code_hash" >> release/contracts/BUILD.md
  npx tsx scripts/src/evidence-add.ts --network mainnet --set "contract_wasm_sha256=$sha"
  echo "reproducible: identical sha256 $sha (2 runs)"
  echo "code_hash $code_hash  release/contracts/arrow-mainnet.wasm"
  exit 0
fi

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
code_hashes target/wasm/*.wasm
