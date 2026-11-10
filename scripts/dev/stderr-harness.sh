#!/usr/bin/env bash
# Usage: bash scripts/dev/stderr-harness.sh [--only <case>]
# Builds the release and dev-endpoints arrow-tee wasm, starts the fake blob/NEAR AI server on
# 127.0.0.1:8787 and runs enclave/arrow-tee/tests/stderr.rs (no_stderr_on_any_error, WS3-T10).
# Needs wasmtime on PATH. Eval cases are padded to 45 s, 8 run in parallel: about 5 minutes.
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" && nvm use --silent >/dev/null 2>&1; fi
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

only=""
if [ "${1:-}" = --only ]; then only=${2:?usage: --only <case>}; fi

bash scripts/build-tee.sh target/rel-tee >/dev/null 2>&1
cargo build -q -p arrow-tee --target wasm32-wasip2 --release --features dev-endpoints --target-dir target/dev-tee

tmp=$(mktemp -d)
mkdir -p "$tmp/blobs" "$tmp/log"
node --import tsx scripts/dev/fake-nearai.ts --port 8787 --blobs "$tmp/blobs" --log "$tmp/log" >"$tmp/server.out" 2>&1 &
server=$!
cleanup() { local s=$?; { kill $server; wait $server; } 2>/dev/null || true; rm -rf "$tmp"; exit $s; }
trap cleanup EXIT
for _ in $(seq 1 50); do
  grep -q listening "$tmp/server.out" 2>/dev/null && break
  sleep 0.2
done
grep -q listening "$tmp/server.out" || { cat "$tmp/server.out"; echo "fake-nearai did not start" >&2; exit 1; }

rc=0
WASM_REL="$PWD"/target/rel-tee/wasm32-wasip2/release/arrow-tee.wasm \
WASM_DEV="$PWD"/target/dev-tee/wasm32-wasip2/release/arrow-tee.wasm \
FAKE_URL=http://127.0.0.1:8787 FAKE_BLOB_DIR="$tmp/blobs" ARROW_ONLY="$only" \
  cargo test -q -p arrow-tee --test stderr -- --nocapture || rc=$?

# Request fields the fake server saw (sizes and parameters only, never the body).
if ls "$tmp/log"/*.json >/dev/null 2>&1; then
  node -e '
    const fs = require("fs"), d = process.argv[1];
    const rows = fs.readdirSync(d).map((f) => JSON.parse(fs.readFileSync(d + "/" + f, "utf8")));
    const uniq = (k) => [...new Set(rows.map((r) => JSON.stringify(r[k])))].join("|");
    const bytes = rows.map((r) => r.body_bytes);
    console.log(`fake-nearai log: ${rows.length} chat requests, body ${Math.min(...bytes)}-${Math.max(...bytes)} B, ` +
      `max_tokens ${uniq("max_tokens")}, temperature ${uniq("temperature")}, response_format ${uniq("response_format_type")}, ` +
      `model ${uniq("model")}, enable_thinking ${uniq("enable_thinking")}`);' "$tmp/log"
fi
exit $rc
