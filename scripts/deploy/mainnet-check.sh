#!/usr/bin/env bash
# Read-only checks around the mainnet deploy (H-12, WS1-T17). Signs nothing, prints no key.
#   bash scripts/deploy/mainnet-check.sh pre  [<market> <owner> <network>]   # runbook step 0, before any transaction
#   bash scripts/deploy/mainnet-check.sh post [<market> <network>]           # runbook step 8, after the program key (step 7)
#   bash scripts/deploy/mainnet-check.sh guard storage|tank [<market> <network>]   # stop line in front of runbook step 2 / step 4
#   bash scripts/deploy/mainnet-check.sh wasm                                # offline: the contract wasm against SHA256SUMS and this tree
# Defaults: arrow-market.near, arrowhq.near, mainnet. There is no usable testnet twin: the frozen program serves only
# arrow.arrowhq.testnet (locked by the 13 Nov rehearsal) and arrow-v2.arrowhq.testnet (the live /try market) on testnet, and
# `post` on any other market fails config_matches_init, because it swaps only secrets_ref into the mainnet template.
# Every row prints PASS or FAIL; the exit code is 1 when any row failed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ENV_FILE=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' .env) # .env is a symlink in worktrees
envget() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
W=release/contracts/arrow-mainnet.wasm
FAIL=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAIL=1; }

rpc_query() { # rpc_query <params json> -> result json; falls over to FastNEAR when the first RPC rate-limits (-429)
  local u out=
  for u in "$RPC" "$RPC2"; do
    out=$(curl -sS --max-time 20 --retry 2 --retry-max-time 30 "$u" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":$1}" | jq -c '.result // .error') || continue
    [ "$(echo "$out" | jq -r '.code? // empty')" = -429 ] || break
  done
  echo "$out"
}
view() { # view <account> <method> [<args json>] -> decoded JSON result
  local a=${3:-}; [ -n "$a" ] || a='{}'
  rpc_query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$a" | base64 | tr -d '\n')\"}" | jq -r 'if .result then (.result | implode) else error(tostring) end'
}
account() { rpc_query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}"; }
near_ge() { python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)' "$1" "$2"; }
to_near() { python3 -c 'import sys; print(f"{int(sys.argv[1])/1e24:.4f}")' "$1"; }
code_hash_of() { python3 -c 'import hashlib,sys
A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; n=int.from_bytes(hashlib.sha256(open(sys.argv[1],"rb").read()).digest(),"big"); s=""
while n: n,r=divmod(n,58); s=A[r]+s
print(s)' "$1"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
secret_row() { # secret_row <market> <wasm sha>: the (profile arrow, WasmHash) row, or empty
  view "$OUTLAYER" list_user_secrets "{\"account_id\":\"$1\"}" | jq -c --arg h "$2" '.[] | select(.profile=="arrow" and .accessor.WasmHash.hash==$h)'
}
set_net() {
  case "$1" in
    # FastNEAR first, as in sdk/src/config.ts (QA-16): rpc.*.near.org is deprecated and answers -429 often, so it is only the fallback
    mainnet) RPC=$(envget MAINNET_RPC_URL); RPC=${RPC:-https://rpc.mainnet.fastnear.com}; RPC2=https://rpc.mainnet.near.org; OUTLAYER=outlayer.near ;;
    testnet) RPC=$(envget TESTNET_RPC_URL); RPC=${RPC:-https://rpc.testnet.fastnear.com}; RPC2=https://rpc.testnet.near.org; OUTLAYER=outlayer.testnet ;;
    *) echo "network must be mainnet or testnet" >&2; exit 2 ;;
  esac
}

contract_wasm() { # the deployed contract wasm must be the one built from this tree's contract source (STATE-7, CI-1)
  local want sums rev changed
  want=$(sha "$W"); sums=$(awk '$2=="arrow-mainnet.wasm"{print $1}' release/contracts/SHA256SUMS)
  [ "$want" = "$sums" ] && pass "contract_wasm_sha256 $want (= SHA256SUMS)" || fail "contract_wasm_sha256 $want != SHA256SUMS $sums"
  # NEP-330 metadata inside the wasm names the commit it was built from (source_code_snapshot ...?rev=<40 hex>)
  rev=$(LC_ALL=C grep -a -o 'source_code_snapshot":"[^"]*rev=[0-9a-f]\{40\}' "$W" | grep -o '[0-9a-f]\{40\}$' | head -1 || true)
  if [ -z "$rev" ]; then fail "contract_wasm_stale: $W carries no NEP-330 source rev (rebuild: bash scripts/build-contracts.sh --reproducible)"; return; fi
  git cat-file -e "$rev^{commit}" 2>/dev/null || { fail "contract_wasm_stale: built from $rev, which is not in this clone"; return; }
  # What changes the contract wasm, or its wire format against the enclave: the contract source, the lockfile, the toolchain and the
  # shared input/output/msg vectors that contracts/arrow and enclave/arrow-tee both parse (tests and docs are not in the wasm).
  changed=$(git diff --name-only "$rev" -- contracts/arrow ':(exclude)contracts/arrow/tests' ':(exclude)contracts/arrow/*.md' Cargo.lock rust-toolchain.toml \
    fixtures/input-vectors.json fixtures/output-vectors.json fixtures/msg-vectors.json | tr '\n' ' ')
  if [ -z "$changed" ]; then pass "contract_wasm_fresh built from ${rev:0:10}; no contract source, lockfile, toolchain or wire vector changed since"
  else fail "contract_wasm_stale: ${rev:0:10} -> working tree changed: ${changed}(rebuild: bash scripts/build-contracts.sh --reproducible, then commit release/contracts)"; fi
}

pre() {
  local market=${1:-arrow-market.near} owner=${2:-arrowhq.near} net=${3:-mainnet} url rc frozen dep acct ob init
  set_net "$net"
  contract_wasm
  url=$(envget PROGRAM_WASM_URL); rc=$(envget PROGRAM_WASM_SHA256)
  frozen=$([ -f release/sha256.txt ] && tr -d ' \n' <release/sha256.txt || true)
  if [ -z "$frozen" ]; then fail "program_frozen: release/sha256.txt missing (K3 freeze not done)"
  elif [ "$frozen" = "$rc" ]; then pass "program_frozen .env PROGRAM_WASM_SHA256 = release/sha256.txt $rc"
  else fail "program_frozen: .env PROGRAM_WASM_SHA256 $rc != release/sha256.txt $frozen"; fi
  [ -n "$url" ] && [ "$(curl -sSL --retry 3 "$url" | shasum -a 256 | cut -d' ' -f1)" = "$rc" ] \
    && pass "program_url_serves_sha $url" || fail "program_url_serves_sha: $url does not serve $rc"
  [ -n "$(envget NEARAI_API_KEY_MAINNET)" ] && pass "nearai_key_mainnet set in .env (H-01b)" || fail "nearai_key_mainnet: .env NEARAI_API_KEY_MAINNET is empty (H-01b)"
  if init=$(bash scripts/deploy/render-init.sh mainnet 2>&1); then
    [ "$(echo "$init" | jq -r .cfg.secrets_ref.account_id)" = "arrow-market.near" ] && [ "$(echo "$init" | jq -r .cfg.program_wasm_hash)" = "$rc" ] \
      && pass "init_json secrets_ref arrow-market.near, program_wasm_hash $rc" || fail "init_json: $(echo "$init" | jq -c '{s:.cfg.secrets_ref, h:.cfg.program_wasm_hash}')"
  else fail "init_json: $init"; fi
  dep=$(bash scripts/deploy/storage-estimate.sh | awk '/^deposit:/{print $2}')
  acct=$(account "$market")
  if [ "$(echo "$acct" | jq -r '.code_hash // empty')" = 11111111111111111111111111111111 ]; then
    pass "market_empty $market exists, no code, $(to_near "$(echo "$acct" | jq -r .amount)") NEAR"
  else fail "market_empty: $market $(echo "$acct" | jq -c '{code_hash, name, cause}')"; fi
  ob=$(account "$owner" | jq -r '.amount // "0"')
  near_ge "$ob" "$(python3 -c 'import sys; print(int((float(sys.argv[1]) + 1) * 10**24))' "$dep")" \
    && pass "owner_balance $owner $(to_near "$ob") NEAR >= deposit $dep + 1" || fail "owner_balance $owner $(to_near "$ob") NEAR < deposit $dep + 1"
  echo "deposit (runbook step 2): $dep NEAR"
  if OUTLAYER_NETWORK=$net outlayer whoami >/dev/null 2>&1; then fail "outlayer_logged_out: outlayer is logged in on $net (run the logout line first)"
  else pass "outlayer_logged_out on $net"; fi
  return $FAIL
}

post() {
  local market=${1:-arrow-market.near} net=${2:-mainnet} cfg build want pk i rc row avail keys usdc bal
  set_net "$net"
  cfg=$(view "$market" get_config); build=$(echo "$cfg" | jq -r .build)
  # `new` requires secrets_ref.account_id == the contract itself, so the twin renders it with its own name
  want=$(bash scripts/deploy/render-init.sh "$build" | jq -S --arg m "$market" '.cfg | .secrets_ref.account_id = $m')
  [ "$(echo "$cfg" | jq -S .config)" = "$want" ] && pass "config_matches_init ($build template, secrets_ref $market)" || { fail "config_matches_init"; diff <(echo "$cfg" | jq -S .config) <(echo "$want") || true; }
  [ "$(echo "$cfg" | jq -c '[.build, .payment_path, .result_path, .paused]')" = '["mainnet","notify","chain",false]' ] \
    && pass "build mainnet, payment notify, result chain, not paused" || fail "build/paths: $(echo "$cfg" | jq -c '[.build, .payment_path, .result_path, .paused]')"
  [ "$(account "$market" | jq -r .code_hash)" = "$(code_hash_of "$W")" ] && pass "code_hash = $W" || fail "code_hash differs from $W"
  avail=$(echo "$cfg" | jq -r .tank_available)
  near_ge "$avail" 400000000000000000000000 && pass "tank_available $(to_near "$avail") NEAR" || fail "tank_available $(to_near "$avail") NEAR < 0.4"
  rc=$(echo "$cfg" | jq -r .config.program_wasm_hash); row=$(secret_row "$market" "$rc")
  if [ -n "$row" ] && [ "$(echo "$row" | jq -c '[.access.Logic.operator, (.access.Logic.conditions | map(keys[0])), (.access.Logic.conditions[1].Predecessor.condition.Whitelist.accounts)]')" = "[\"And\",[\"WasmHash\",\"Predecessor\"],[\"$market\"]]" ]; then
    pass "secret_row profile arrow, WasmHash $rc AND Predecessor $market"
  else fail "secret_row for $rc: ${row:-missing}"; fi
  if [ "$net" = mainnet ]; then # what the lock freezes for good (S5): a key on intents.near, or USDC parked on the market's Intents account
    keys=$(view intents.near public_keys_of "{\"account_id\":\"$market\"}" | jq -c .) || keys="(unreadable)"
    [ "$keys" = "[]" ] && pass "intents_keys_empty intents.near public_keys_of $market = []" \
      || fail "intents_keys_empty: intents.near public_keys_of $market = $keys (such a key could move the market's Intents balance after the lock)"
    usdc=$(echo "$cfg" | jq -r .config.usdc_token_id)
    bal=$(view intents.near mt_balance_of "{\"account_id\":\"$market\",\"token_id\":\"$usdc\"}" | jq -r .) || bal="(unreadable)"
    [ "$bal" = 0 ] && pass "market_usdc_idle intents.near USDC on $market = 0" \
      || fail "market_usdc_idle: $market holds $bal USDC base units on intents.near (a payment in flight or an owed payout; the lock would freeze it)"
  fi
  for i in $(seq 1 12); do # the derive answer arrives through yield/resume
    pk=$(view "$market" program_pubkey | jq -r '. // empty')
    [ -n "$pk" ] && break
    [ "$i" = 12 ] || sleep 10
  done
  [[ "$pk" =~ ^04[0-9a-f]{128}$ ]] && pass "program_pubkey_130hex ${pk:0:10}…" || fail "program_pubkey_130hex (${pk:-null} after 120 s)"
  return $FAIL
}

guard() { # QA-03: a second paste of step 2 or step 4 would send the NEAR again into an account that is locked later
  local what=${1:-} market=${2:-arrow-market.near} net=${3:-mainnet} acct amount code avail
  set_net "$net"
  case "$what" in
    storage)
      acct=$(account "$market"); amount=$(echo "$acct" | jq -r '.amount // empty'); code=$(echo "$acct" | jq -r '.code_hash // empty')
      if [ -z "$amount" ]; then fail "guard_storage: cannot read $market ($(echo "$acct" | jq -c .)); read it again, send nothing yet"
      elif [ "$code" != 11111111111111111111111111111111 ]; then fail "guard_storage: $market already has code: step 2 is done, do not send it again"
      elif near_ge "$amount" 1000000000000000000000000; then fail "guard_storage: $market holds $(to_near "$amount") NEAR (> 1): step 2 already landed, do not send it again"
      else pass "guard_storage: $market holds $(to_near "$amount") NEAR and no code: send step 2 once"; fi ;;
    tank)
      if ! avail=$(view "$market" get_config | jq -r '.tank_available // empty') || [ -z "$avail" ]; then fail "guard_tank: cannot read get_config of $market; read it again, send nothing yet"
      elif near_ge "$avail" 900000000000000000000000; then fail "guard_tank: tank_available $(to_near "$avail") NEAR (>= 0.9): step 4 already landed, do not send it again"
      else pass "guard_tank: tank_available $(to_near "$avail") NEAR: send step 4 once"; fi ;;
    *) echo "usage: mainnet-check.sh guard storage|tank [<market> <network>]" >&2; exit 2 ;;
  esac
  return $FAIL
}

case "${1:-}" in
  pre) shift; pre "$@" ;;
  post) shift; post "$@" ;;
  guard) shift; guard "$@" ;;
  wasm) contract_wasm; exit $FAIL ;;
  *) sed -n '2,8p' "$0" >&2; exit 2 ;;
esac
