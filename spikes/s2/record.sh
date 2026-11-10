#!/usr/bin/env bash
# record.sh <kind> <tx> <expect> <observed>: one S2 testnet run through the single evidence CLI
# (scripts/src/evidence-add.ts in the main checkout, which writes evidence/testnet.json under
# evidence/.lock). Until that CLI exists (WS1-T05), runs are appended to spikes/s2/out/runs.jsonl
# (gitignored) and imported later with --file. Never edits evidence/ directly.
set -euo pipefail
[ $# -eq 4 ] || { echo "usage: record.sh <kind> <tx> <expect> <observed>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(git -C "$HERE" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
ID="${S2_ID:-s2-$(date -u +%Y%m%d%H%M%S)}"
RUN=$(jq -cn --arg id "$ID" --arg kind "$1" --arg tx "$2" --arg expect "$3" --arg observed "$4" \
  '{id:$id, kind:$kind, tx:(if $tx == "" then null else $tx end), chain:"near", expect:$expect, observed:$observed, script:"spikes/s2/run-testnet.sh"}')
if [ -f "$MAIN/scripts/src/evidence-add.ts" ]; then
  (cd "$MAIN" && npx tsx scripts/src/evidence-add.ts --network testnet --run "$RUN" --sender arrowhq.testnet)
else
  mkdir -p "$HERE/out"
  printf '%s\n' "$RUN" >>"$HERE/out/runs.jsonl"
  echo "recorded $ID to spikes/s2/out/runs.jsonl (evidence CLI not on main yet)"
fi
[ -n "$2" ] && echo "https://testnet.nearblocks.io/txns/$2" || true
