#!/usr/bin/env bash
# Usage: bash scripts/dev/perf-local.sh [--llm real|fake] [--runs 10] [--no-fuel] [--json <out.json>]
# Local enclave timing for WS3-T11b: builds the dev-endpoints arrow-tee wasm, precompiles it (so the times leave
# out wasmtime's compile step, which OutLayer reports separately as compile_time_ms), serves the blobs from
# scripts/dev/fake-nearai.ts on 127.0.0.1:8788 and runs scripts/dev/perf-local.ts with T_PAD off.
# Default --llm is real when NEARAI_API_KEY is set in .env, fake otherwise. Needs wasmtime on PATH.
# Prints: local work p50=…s p95=…s ; maxcase OK fuel=…
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" && nvm use --silent >/dev/null 2>&1; fi
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

args=("$@")
if ! printf '%s\n' "${args[@]+"${args[@]}"}" | grep -qx -- --llm; then
  envfile="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.env"
  if [ -n "$(sed -n 's/^NEARAI_API_KEY=//p' "$envfile" 2>/dev/null | head -1)" ]; then llm=real; else llm=fake; fi
  echo "NEARAI_API_KEY in .env: $([ $llm = real ] && echo set || echo empty) → --llm $llm"
  args+=(--llm "$llm")
fi

cargo build -q -p arrow-tee --target wasm32-wasip2 --release --features dev-endpoints --target-dir target/dev-tee
wasm=target/dev-tee/wasm32-wasip2/release/arrow-tee.wasm
cwasm=target/dev-tee/arrow-tee-perf.cwasm
cwasm_fuel=target/dev-tee/arrow-tee-perf-fuel.cwasm
wasmtime compile -o "$cwasm" "$wasm"
wasmtime compile -W fuel=1 -o "$cwasm_fuel" "$wasm" # fuel needs its own build; it also slows the code, so timings use the other one

tmp=$(mktemp -d)
mkdir -p "$tmp/blobs"
node --import tsx scripts/dev/fake-nearai.ts --port 8788 --blobs "$tmp/blobs" >"$tmp/server.out" 2>&1 &
server=$!
cleanup() { local s=$?; { kill $server; wait $server; } 2>/dev/null || true; rm -rf "$tmp"; exit $s; }
trap cleanup EXIT
for _ in $(seq 1 50); do
  grep -q listening "$tmp/server.out" 2>/dev/null && break
  sleep 0.2
done
grep -q listening "$tmp/server.out" || { cat "$tmp/server.out"; echo "fake-nearai did not start" >&2; exit 1; }

node --import tsx scripts/dev/perf-local.ts --wasm "$PWD/$cwasm" --wasm-fuel "$PWD/$cwasm_fuel" --fake http://127.0.0.1:8788 --blobs "$tmp/blobs" "${args[@]}"
