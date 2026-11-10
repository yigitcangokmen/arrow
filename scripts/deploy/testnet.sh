#!/usr/bin/env bash
# Testnet deploy of the market (WS1-T15). Every step is idempotent; `all` runs them in order.
#   bash scripts/deploy/testnet.sh build                 # arrow-testnet + arrow-usd wasm (scripts/build-contracts.sh --testnet)
#   bash scripts/deploy/testnet.sh program [<wasm> <url>] # check the rc wasm and its URL against each other, write .env PROGRAM_WASM_URL/SHA256
#   bash scripts/deploy/testnet.sh token                 # deploy arrow-usd only when its on-chain code differs from the build
#   bash scripts/deploy/testnet.sh contract [--fresh]    # deploy + init `new` (render-init.sh testnet); redeploy code when it changed
#   bash scripts/deploy/testnet.sh tank                  # fund_tank 1 NEAR when tank_available < 0.9 NEAR
#   bash scripts/deploy/testnet.sh secrets               # OutLayer secret row (profile arrow) for the program hash
#   bash scripts/deploy/testnet.sh pubkey                # init_program_key when program_pubkey is null, then wait for it
#   bash scripts/deploy/testnet.sh verify                # acceptance checks
#   bash scripts/deploy/testnet.sh all [<wasm> <url>]
# Keys stay in ~/.near-credentials (legacy keychain); NEARAI_API_KEY is read from .env and never printed.
# Every tx goes to evidence/testnet.json through scripts/src/evidence-add.ts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ENV_FILE=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' .env) # .env is a symlink in worktrees
envget() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
OWNER=arrowhq.testnet
C=$(envget ARROW_CONTRACT_TESTNET); C=${C:-arrow.arrowhq.testnet}
TOKEN=arrow-usd.arrowhq.testnet
RPC=https://rpc.testnet.near.org
CREDS=$HOME/.near-credentials/testnet
ARROW_WASM=target/wasm/arrow-testnet.wasm
USD_WASM=target/wasm/arrow-usd.wasm
LOG=target/deploy-testnet; mkdir -p "$LOG"
NET=(network-config testnet)
SIGN=(sign-with-legacy-keychain send)

rpc_query() { # rpc_query <params json> -> result json
  curl -sS --retry 3 "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":$1}" | jq -c '.result // .error'
}
view() { # view <account> <method> [<args json>] -> decoded JSON result
  local a=${3:-}; [ -n "$a" ] || a='{}'
  local args; args=$(printf '%s' "$a" | base64)
  rpc_query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$args\"}" | jq -r 'if .result then (.result | implode) else error(tostring) end'
}
account() { rpc_query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}"; }
code_hash_of() { python3 -c 'import hashlib,sys
A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; n=int.from_bytes(hashlib.sha256(open(sys.argv[1],"rb").read()).digest(),"big"); s=""
while n: n,r=divmod(n,58); s=A[r]+s
print(s)' "$1"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
near_ge() { python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)' "$1" "$2"; } # yocto compare
txid() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -m1 "Transaction ID" | awk '{print $NF}'; }
need() { [ -f "$1" ] || { echo "testnet.sh: $1 missing (run: bash scripts/deploy/testnet.sh ${2:-build})" >&2; exit 1; }; }

record() { # record <step> <tx> <sender> <expect> <observed>
  local id; id="deploy-testnet-$1-$(date -u +%Y%m%dT%H%M%SZ)"
  npx tsx scripts/src/evidence-add.ts --network testnet --sender "$3" \
    --run "$(jq -cn --arg id "$id" --arg tx "$2" --arg e "$4" --arg o "$5" '{id:$id,kind:"deploy",tx:$tx,chain:"near",expect:$e,observed:$o,script:"scripts/deploy/testnet.sh"}')"
}
send_tx() { # send_tx <step> <sender> <expect> <near args...>: runs one near-cli tx, fails without a tx id, records it
  local step=$1 sender=$2 expect=$3 out tx; shift 3
  out="$LOG/$step.log"
  near "$@" </dev/null >"$out" 2>&1 || { tail -20 "$out" >&2; echo "testnet.sh: $step failed (log $out)" >&2; exit 1; }
  tx=$(txid "$out"); [ -n "$tx" ] || { tail -20 "$out" >&2; echo "testnet.sh: $step: no transaction id" >&2; exit 1; }
  echo "$step tx $tx"
  if grep -qiE "panicked|Failure|ActionError" "$out"; then tail -20 "$out" >&2; record "$step" "$tx" "$sender" "$expect" "failed, see $out"; exit 1; fi
  TX=$tx
}

program_env() { # program_env [<wasm> <url>]: both or neither
  local wasm=${1:-} url=${2:-} rc served
  if [ -z "$wasm" ]; then
    url=$(envget PROGRAM_WASM_URL); rc=$(envget PROGRAM_WASM_SHA256)
    [ -n "$url" ] && [ -n "$rc" ] || { echo "testnet.sh: .env PROGRAM_WASM_URL/SHA256 empty; run: testnet.sh program <wasm> <url>" >&2; exit 1; }
  else
    [ -n "$url" ] || { echo "usage: testnet.sh program <wasm> <url>" >&2; exit 2; }
    need "$wasm"
    rc=$(sha "$wasm")
    if [ -f "${wasm%.wasm}.sha256" ]; then [ "$(tr -d ' \n' <"${wasm%.wasm}.sha256")" = "$rc" ] || { echo "testnet.sh: $wasm does not match ${wasm%.wasm}.sha256" >&2; exit 1; }; fi
  fi
  served=$(curl -sSL --retry 3 "$url" | shasum -a 256 | cut -d' ' -f1) # GET: FastFS HEAD can 404
  [ "$served" = "$rc" ] || { echo "testnet.sh: $url serves $served, expected $rc" >&2; exit 1; }
  if [ "$(envget PROGRAM_WASM_URL)" != "$url" ] || [ "$(envget PROGRAM_WASM_SHA256)" != "$rc" ]; then
    sed -i '' -e "s#^PROGRAM_WASM_URL=.*#PROGRAM_WASM_URL=$url#" -e "s#^PROGRAM_WASM_SHA256=.*#PROGRAM_WASM_SHA256=$rc#" "$ENV_FILE"
    [ "$(envget PROGRAM_WASM_SHA256)" = "$rc" ] || { echo "testnet.sh: .env has no PROGRAM_WASM_* lines to fill" >&2; exit 1; }
  fi
  echo "program: rc $rc served by $url (.env set)"
}

step_token() {
  need "$USD_WASM"
  local local_h remote_h
  local_h=$(code_hash_of "$USD_WASM"); remote_h=$(account $TOKEN | jq -r .code_hash)
  if [ "$local_h" = "$remote_h" ]; then echo "token: $TOKEN code is current ($local_h)"; return; fi
  send_tx token $TOKEN "arrow-usd code $local_h" contract deploy $TOKEN use-file "$USD_WASM" without-init-call "${NET[@]}" "${SIGN[@]}"
  record token "$TX" $TOKEN "arrow-usd code $local_h" "deployed (was $remote_h)"
}

step_contract() {
  need "$ARROW_WASM"
  local local_h acct remote_h bal init
  local_h=$(code_hash_of "$ARROW_WASM"); acct=$(account "$C"); remote_h=$(echo "$acct" | jq -r .code_hash)
  if [ "${1:-}" = --fresh ] && [ "$remote_h" != 11111111111111111111111111111111 ]; then
    local state=$(( $(echo "$acct" | jq -r .storage_usage) - $(wc -c <"$ARROW_WASM") ))
    if [ "$state" -ge 10000 ]; then
      echo "testnet.sh: $C state ~$state bytes >= 10000 cannot be deleted; deploy to arrow-v2.arrowhq.testnet (set ARROW_CONTRACT_TESTNET in .env)" >&2; exit 1
    fi
    local pk; pk=$(jq -r .public_key "$CREDS/$C.json")
    send_tx delete "$C" "delete $C for a fresh state" account delete-account "$C" beneficiary $OWNER "${NET[@]}" "${SIGN[@]}"
    record delete "$TX" "$C" "delete $C for a fresh state" "deleted, balance to $OWNER"
    send_tx create $OWNER "recreate $C" account create-account fund-myself "$C" '10 NEAR' use-manually-provided-public-key "$pk" sign-as $OWNER "${NET[@]}" "${SIGN[@]}"
    record create "$TX" $OWNER "recreate $C with 10 NEAR" "created"
    remote_h=11111111111111111111111111111111
  fi
  if [ "$local_h" = "$remote_h" ]; then echo "contract: $C code is current ($local_h)"; return; fi
  if [ "$remote_h" = 11111111111111111111111111111111 ]; then
    bal=$(account "$C" | jq -r .amount)
    if ! near_ge "$bal" 5000000000000000000000000; then
      send_tx topup $OWNER "9 NEAR to $C" tokens $OWNER send-near "$C" '9 NEAR' "${NET[@]}" "${SIGN[@]}"
      record topup "$TX" $OWNER "9 NEAR to $C" "sent"
    fi
    init=$(bash scripts/deploy/render-init.sh testnet)
    send_tx deploy "$C" "deploy + new(cfg) code $local_h" contract deploy "$C" use-file "$ARROW_WASM" with-init-call new json-args "$init" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' "${NET[@]}" "${SIGN[@]}"
    record deploy "$TX" "$C" "deploy + new(cfg) code $local_h" "init ok, code_hash $(account "$C" | jq -r .code_hash)"
  else
    send_tx redeploy "$C" "code $local_h, state kept" contract deploy "$C" use-file "$ARROW_WASM" without-init-call "${NET[@]}" "${SIGN[@]}"
    record redeploy "$TX" "$C" "code $local_h, state kept" "redeployed (was $remote_h)"
  fi
}

step_tank() {
  local avail; avail=$(view "$C" get_config | jq -r .tank_available)
  if near_ge "$avail" 900000000000000000000000; then echo "tank: $avail yocto available"; return; fi
  send_tx tank $OWNER "fund_tank 1 NEAR" contract call-function as-transaction "$C" fund_tank json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '1 NEAR' sign-as $OWNER "${NET[@]}" "${SIGN[@]}"
  record tank "$TX" $OWNER "fund_tank 1 NEAR" "tank_available $(view "$C" get_config | jq -r .tank_available)"
}

outlayer_login() {
  printf '%s\n%s\n' "$C" "$(jq -r .private_key "$CREDS/$C.json")" | outlayer login testnet >/dev/null 2>&1
  OUTLAYER_NETWORK=testnet outlayer whoami | grep -q "Account: *$C" || { echo "testnet.sh: outlayer login as $C failed" >&2; exit 1; }
}
secret_row() { # the (WasmHash rc, profile arrow) row of $C, or empty
  view outlayer.testnet list_user_secrets "{\"account_id\":\"$C\"}" | jq -c --arg h "$1" '.[] | select(.profile=="arrow" and .accessor.WasmHash.hash==$h)'
}

step_secrets() {
  local rc key row json
  rc=$(envget PROGRAM_WASM_SHA256); [ -n "$rc" ] || { echo "testnet.sh: run program first" >&2; exit 1; }
  key=$(envget NEARAI_API_KEY)
  row=$(secret_row "$rc")
  outlayer_login
  if [ -z "$row" ]; then
    if [ -n "$key" ]; then json=$(jq -cn --arg k "$key" '{NEARAI_API_KEY:$k}'); else json='{}'; fi
    OUTLAYER_NETWORK=testnet outlayer secrets set "$json" --profile arrow --wasm-hash "$rc" --generate PROTECTED_MASTER:hex32 \
      --access allow-all --via "$C" --build "$rc" 2>&1 | tail -4
  elif [ -n "$key" ]; then
    # update keeps PROTECTED_MASTER (so the program key stays) and the access condition; it merges NEARAI_API_KEY in
    OUTLAYER_NETWORK=testnet outlayer secrets update "$(jq -cn --arg k "$key" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash "$rc" 2>&1 | tail -4
  else
    echo "secrets: row exists; NEARAI_API_KEY is empty in .env, so it holds PROTECTED_MASTER only (waiting H-01a; rerun this step when the key is in .env)"
  fi
  row=$(secret_row "$rc"); [ -n "$row" ] || { echo "testnet.sh: no secret row for $rc after set" >&2; exit 1; }
  echo "secrets: $(echo "$row" | jq -c '{accessor, access, updated_at}')"
  [ -n "$key" ] && echo "secrets: NEARAI_API_KEY included" || echo "secrets: NEARAI_API_KEY NOT included (waiting H-01a)"
}

step_pubkey() {
  local pk i
  pk=$(view "$C" program_pubkey | jq -r '. // empty')
  if [ -n "$pk" ] && [ "${1:-}" != --force ]; then echo "pubkey: ${pk:0:10}… already set"; return; fi
  send_tx pubkey "$C" "program_pubkey 04+128 hex" contract call-function as-transaction "$C" init_program_key json-args '{}' prepaid-gas '300.0 Tgas' attached-deposit '0.05 NEAR' sign-as "$C" "${NET[@]}" "${SIGN[@]}"
  local tx=$TX
  if grep -q "program key derive failed" "$LOG/pubkey.log"; then # the callback ran and kept the old key
    record pubkey "$tx" "$C" "program_pubkey 04+128 hex" "$(grep -o 'arrow: program key derive failed: [a-z_]*' "$LOG/pubkey.log" | head -1)"
    echo "testnet.sh: derive failed; check outlayer secrets list and $LOG/pubkey.log" >&2; exit 1
  fi
  for i in $(seq 1 12); do # the callback arrives through yield/resume
    pk=$(view "$C" program_pubkey | jq -r '. // empty')
    [ -n "$pk" ] && break
    sleep 10
  done
  if [ -z "$pk" ]; then
    record pubkey "$tx" "$C" "program_pubkey 04+128 hex" "null after 120 s: $(grep -o 'arrow: program key[^"]*' "$LOG/pubkey.log" | head -1)"
    echo "testnet.sh: program_pubkey still null; check outlayer secrets list, the callback log in $LOG/pubkey.log" >&2; exit 1
  fi
  record pubkey "$tx" "$C" "program_pubkey 04+128 hex" "program_pubkey ${pk:0:10}… (${#pk} hex)"
  echo "pubkey: ${pk:0:10}… (${#pk} hex)"
}

step_verify() {
  local fail=0 pk cfg want avail rc url
  pk=$(view "$C" program_pubkey | jq -r '. // "null"')
  [[ "$pk" =~ ^04[0-9a-f]{128}$ ]] && echo "PASS program_pubkey_130hex ${pk:0:10}…" || { echo "FAIL program_pubkey_130hex ($pk)"; fail=1; }
  cfg=$(view "$C" get_config); want=$(bash scripts/deploy/render-init.sh testnet | jq -S .cfg)
  [ "$(echo "$cfg" | jq -S .config)" = "$want" ] && echo "PASS config_matches_init" || { echo "FAIL config_matches_init"; diff <(echo "$cfg" | jq -S .config) <(echo "$want") || true; fail=1; }
  avail=$(echo "$cfg" | jq -r .tank_available)
  near_ge "$avail" 900000000000000000000000 && echo "PASS tank_funded $avail yocto" || { echo "FAIL tank_funded $avail"; fail=1; }
  rc=$(envget PROGRAM_WASM_SHA256); url=$(envget PROGRAM_WASM_URL)
  [ "$(curl -sSL --retry 3 "$url" | shasum -a 256 | cut -d' ' -f1)" = "$rc" ] && echo "PASS rc_url_hash $rc" || { echo "FAIL rc_url_hash"; fail=1; }
  echo "build=$(echo "$cfg" | jq -r .build) paused=$(echo "$cfg" | jq -r .paused) version=$(view "$C" version | jq -c .)"
  [ -n "$(secret_row "$rc")" ] && echo "secret row: present" || echo "secret row: MISSING"
  return $fail
}

case "${1:-}" in
  build) bash scripts/build-contracts.sh --testnet ;;
  program) shift; program_env "$@" ;;
  token) step_token ;;
  contract) step_contract "${2:-}" ;;
  tank) step_tank ;;
  secrets) step_secrets ;;
  pubkey) step_pubkey "${2:-}" ;;
  verify) step_verify ;;
  all)
    shift
    bash scripts/build-contracts.sh --testnet >"$LOG/build.log" 2>&1 || { tail -20 "$LOG/build.log"; exit 1; }
    program_env "$@"; step_token; step_contract; step_tank; step_secrets; step_pubkey; step_verify
    npx tsx scripts/src/evidence-add.ts --network testnet --set "contract=$C" --set "contract_wasm_sha256=$(sha "$ARROW_WASM")" \
      --set "program_wasm_sha256=$(envget PROGRAM_WASM_SHA256)" --set "program_wasm_url=$(envget PROGRAM_WASM_URL)"
    ;;
  *) sed -n '2,11p' "$0" >&2; exit 2 ;;
esac
