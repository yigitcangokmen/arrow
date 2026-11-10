#!/usr/bin/env bash
# Usage: bash scripts/check-all.sh [--strict]   (--strict after K1: a SKIP becomes a FAIL)
# Runs every local gate in order, prints PASS/FAIL/SKIP per step, exits non-zero on any FAIL.
# CI runs only a subset (DEC F-13); this script is the integration gate (PLAN §7.4).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
STRICT=0; [ "${1:-}" = --strict ] && STRICT=1

n=0; skipped=0; failed=()
step() { # step "<name>" <command...>
  local name=$1; shift
  n=$((n + 1))
  echo "== [$n] $name"
  local out rc
  out=$("$@" 2>&1); rc=$?
  printf '%s\n' "$out" | tail -20
  if [ $rc -eq 0 ]; then echo "-- PASS $name"; else echo "-- FAIL $name (exit $rc)"; failed+=("$name"); fi
}
skip() { # skip "<name>" "<reason>"
  n=$((n + 1)); skipped=$((skipped + 1))
  echo "== [$n] $1"
  echo "-- SKIP $1: $2"
  [ $STRICT = 1 ] && failed+=("$1 (skipped in --strict)")
}

[ -d node_modules ] || step "npm ci" npm ci
step "npm test" npm test
step "tsc --noEmit" npx tsc --noEmit -p tsconfig.json
step "cargo test arrow-core" cargo test -p arrow-core
step "clippy arrow-core" cargo clippy -p arrow-core -- -D warnings
step "clippy arrow-tee (wasm32-wasip2)" cargo clippy -p arrow-tee --target wasm32-wasip2 -- -D warnings
step "cargo test arrow-tee --bins" cargo test -p arrow-tee --bins
step "cargo test arrow --lib" cargo test -p arrow --lib
if [ -f scripts/build-contracts.sh ]; then
  step "build-contracts --sandbox" bash scripts/build-contracts.sh --sandbox
  if [ -f contracts/arrow/tests/sandbox.rs ]; then
    step "sandbox tests" cargo test -p arrow --test sandbox -- --test-threads=4
  else
    skip "sandbox tests" "contracts/arrow/tests/sandbox.rs not written yet (WS2-T11)"
  fi
else
  skip "build-contracts --sandbox" "scripts/build-contracts.sh not written yet (WS2-T12a)"
  skip "sandbox tests" "needs scripts/build-contracts.sh (WS2-T12a) and contracts/arrow/tests/sandbox.rs (WS2-T11)"
fi
if [ -f scripts/build-tee.sh ]; then
  step "build-tee" bash scripts/build-tee.sh target/rel-tee
else
  step "build arrow-tee wasm (build-tee.sh not written yet, WS3-T11a)" cargo build -p arrow-tee --target wasm32-wasip2 --release
fi
if [ -f scripts/check-claims.sh ]; then
  step "check-claims" bash scripts/check-claims.sh
else
  skip "check-claims" "scripts/check-claims.sh not written yet (WS7-T04a)"
fi
step "secret-scan" bash scripts/secret-scan.sh --no-gitleaks

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "CHECK-ALL: PASS ($n steps, $skipped skipped)"
else
  echo "CHECK-ALL: FAIL ($(IFS=,; echo "${failed[*]}"))"
  exit 1
fi
