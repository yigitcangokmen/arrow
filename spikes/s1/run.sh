#!/usr/bin/env bash
# S1-b on testnet (WS1-T07b). Usage:
#   bash spikes/s1/run.sh fastfs              # upload release/spike-tee.wasm to testnet FastFS, check sha256
#   bash spikes/s1/run.sh deploy              # deploy + init the spike contract on spike.arrowhq.testnet
#   bash spikes/s1/run.sh secrets             # OutLayer secrets for profile "arrow" (NEARAI_API_KEY from .env if set)
#   bash spikes/s1/run.sh pos <n> [mode] [secrets=true|false]   # one run signed by arrowhq.testnet (signer != predecessor)
#   bash spikes/s1/run.sh neg                 # attacker calls OutLayer directly with the spike's secrets_ref
#   bash spikes/s1/run.sh read <tx> <signer> [extra read-result.ts flags]
# Raw output goes to spikes/s1/out/ (gitignored). Keys stay in ~/.near-credentials (legacy keychain, W1-01).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
S1=spikes/s1
OUT=$S1/out
SPIKE=spike.arrowhq.testnet
SIGNER=arrowhq.testnet
H=$(cat $S1/release/sha256.txt)
mkdir -p $OUT
url() { grep "FastFS URL" $OUT/fastfs.txt | awk '{print $3}'; }
txid() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -m1 "Transaction ID" | awk '{print $NF}'; }
login() {
  printf '%s\n%s\n' $SPIKE "$(jq -r .private_key ~/.near-credentials/testnet/$SPIKE.json)" | outlayer login testnet >/dev/null
  outlayer whoami | grep -q "Account: *$SPIKE"
}

case "${1:-}" in
  fastfs)
    login
    OUTLAYER_NETWORK=testnet outlayer upload $S1/release/spike-tee.wasm >$OUT/fastfs.txt 2>&1
    echo "url: $(url)"
    echo "sha256 served: $(curl -sL "$(url)" | shasum -a 256 | cut -d' ' -f1) expected: $H"
    ;;
  deploy)
    near contract deploy $SPIKE use-file $S1/spike-contract/target/near/s1_spike.wasm \
      with-init-call new json-args "{\"outlayer\":\"outlayer.testnet\",\"wasm_url\":\"$(url)\",\"wasm_hash\":\"$H\",\"profile\":\"arrow\"}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send </dev/null 2>&1 | grep -E "Transaction ID|deployed|rror"
    ;;
  secrets)
    login
    set -a; source .env; set +a
    # The key goes into the JSON argument only; nothing is echoed or tee'd.
    if [ -n "${NEARAI_API_KEY:-}" ]; then json=$(jq -cn --arg k "$NEARAI_API_KEY" '{NEARAI_API_KEY:$k}'); else json='{}'; fi
    OUTLAYER_NETWORK=testnet outlayer secrets set "$json" --profile arrow --wasm-hash "$H" \
      --generate PROTECTED_MASTER:hex32 --access allow-all --via $SPIKE --build "$H" 2>&1 | tail -4
    OUTLAYER_NETWORK=testnet outlayer secrets list | tail -2
    ;;
  pos)
    n=${2:?n}; mode=${3:-echo+ai}; sec=${4:-true}
    near contract call-function as-transaction $SPIKE run \
      json-args "{\"input\":\"{\\\"mode\\\":\\\"$mode\\\"}\",\"secrets\":$sec,\"max_seconds\":100}" \
      prepaid-gas '300.0 Tgas' attached-deposit '0.02 NEAR' sign-as $SIGNER network-config testnet sign-with-legacy-keychain send \
      </dev/null >$OUT/pos$n.txt 2>&1
    tx=$(txid $OUT/pos$n.txt); echo "tx: $tx"
    npx tsx $S1/read-result.ts "$tx" $SIGNER --input "{\"mode\":\"$mode\"}" | tee $OUT/pos$n.json | grep -v '"out"'
    ;;
  neg)
    cat >$OUT/neg-args.json <<EOF
{"source":{"WasmUrl":{"url":"$(url)","hash":"$H","build_target":"wasm32-wasip2"}},
 "resource_limits":{"max_instructions":2000000000,"max_memory_mb":128,"max_execution_seconds":30},
 "input_data":"{\"mode\":\"echo\"}","secrets_ref":{"profile":"arrow","account_id":"$SPIKE"},
 "response_format":"Json","payer_account_id":null,"params":null}
EOF
    near contract call-function as-transaction outlayer.testnet request_execution file-args $OUT/neg-args.json \
      prepaid-gas '300.0 Tgas' attached-deposit '0.02 NEAR' sign-as attacker.arrowhq.testnet network-config testnet \
      sign-with-legacy-keychain send </dev/null >$OUT/neg.txt 2>&1
    tx=$(txid $OUT/neg.txt); echo "tx: $tx"
    sed 's/\x1b\[[0-9;]*m//g' $OUT/neg.txt | grep -o '"error_message":"[^"]*"' | head -1 || true
    npx tsx $S1/read-result.ts "$tx" attacker.arrowhq.testnet --no-callback --input '{"mode":"echo"}' | tee $OUT/neg.json | grep -E '"out"|request_id'
    ;;
  read)
    shift; npx tsx $S1/read-result.ts "$@"
    ;;
  *)
    sed -n 2,9p "$0"; exit 2
    ;;
esac
