#!/usr/bin/env bash
# S2 gate, testnet part: (1) deploy arrow-usd + mint (+ over-cap mint rejected),
# (2) ft_transfer_call to the S2 receiver: refund_all keeps the buyer's balance, keep moves 100000.
# Needs the WS1-T05 accounts arrowhq.testnet, arrow-usd.arrowhq.testnet, s2.arrowhq.testnet in the
# near-cli-rs legacy keychain (~/.near-credentials/testnet). Logs go to a scratch dir, never the repo.
# Prints "S2-TESTNET PASS" or "S2-TESTNET FAIL: <step>".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC=https://rpc.testnet.near.org
USD=arrow-usd.arrowhq.testnet
SPIKE=s2.arrowhq.testnet # the S2 receiver; spike.arrowhq.testnet belongs to S1-b and is not touched
BUYER=arrowhq.testnet
LOG_DIR="${S2_LOG_DIR:-$(mktemp -d)}"
USD_WASM="$ROOT/target/near/variants/arrow-usd/arrow_usd.wasm"
RECV_WASM="$ROOT/spikes/s2/receiver/target/near/s2-receiver/s2_receiver.wasm"
SIGN=(network-config testnet sign-with-legacy-keychain send)

for a in "$BUYER" "$USD" "$SPIKE"; do
  [ -f "$HOME/.near-credentials/testnet/$a.json" ] || { echo "S2-TESTNET FAIL: no key for $a (WS1-T05)"; exit 1; }
done
for f in "$USD_WASM" "$RECV_WASM"; do
  [ -f "$f" ] || { echo "S2-TESTNET FAIL: missing $f (build commands: tasks card WS2-T03)"; exit 1; }
done
echo "logs: $LOG_DIR"

view() { # $1 contract $2 method $3 json-args -> raw result text
  curl -s "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64)\"}}" \
    | jq -r 'if .result.result then (.result.result | implode) else "" end'
}
bal() { view "$USD" ft_balance_of "{\"account_id\":\"$1\"}" | tr -d '"'; }
txhash() { grep -Eo '(Transaction ID: |/txns/|/transactions/)[1-9A-HJ-NP-Za-km-z]{43,44}' "$1" | head -1 | grep -Eo '[1-9A-HJ-NP-Za-km-z]{43,44}$' || true; }
SEQ=0
record() { # kind log expect observed
  SEQ=$((SEQ + 1))
  S2_ID="$(printf 's2-%03d' "$SEQ")" bash "$ROOT/spikes/s2/record.sh" "$1" "$(txhash "$2")" "$3" "$4"
}
fail() { echo "S2-TESTNET FAIL: $1"; exit 1; }
deployed() { [ -n "$(view "$1" "$2" '{}')" ]; }

# 1) deploy arrow-usd and the receiver (init only on the first deploy)
L="$LOG_DIR/s2-1.log"
if deployed "$USD" ft_metadata; then
  near contract deploy "$USD" use-file "$USD_WASM" without-init-call "${SIGN[@]}" >"$L" 2>&1 || fail "deploy arrow-usd"
else
  near contract deploy "$USD" use-file "$USD_WASM" with-init-call new json-args '{}' prepaid-gas '100 TGas' attached-deposit '0 NEAR' "${SIGN[@]}" >"$L" 2>&1 || fail "deploy arrow-usd"
fi
record deploy "$L" "arrow-usd deployed at $USD" "ft_metadata: $(view "$USD" ft_metadata '{}' | jq -c '{symbol,decimals}')"

L="$LOG_DIR/s2-2.log"
near contract deploy "$SPIKE" use-file "$RECV_WASM" with-init-call new json-args '{"outlayer":"outlayer.testnet"}' prepaid-gas '100 TGas' attached-deposit '0 NEAR' "${SIGN[@]}" >"$L" 2>&1 \
  || near contract deploy "$SPIKE" use-file "$RECV_WASM" without-init-call "${SIGN[@]}" >"$L" 2>&1 \
  || fail "deploy receiver"
record deploy "$L" "s2 receiver deployed at $SPIKE" "deployed"

L="$LOG_DIR/s2-3.log"
B_PRE=$(bal "$BUYER"); B_PRE=${B_PRE:-0}
near contract call-function as-transaction "$USD" mint json-args "{\"receiver_id\":\"$BUYER\",\"amount\":\"10000000\"}" prepaid-gas '30 TGas' attached-deposit '0 NEAR' sign-as "$BUYER" "${SIGN[@]}" >"$L" 2>&1 || fail "mint"
sleep 5; B0=$(bal "$BUYER")
[ "$B0" -ge 10000000 ] && [ "$B0" -eq $((B_PRE + 10000000)) ] || fail "mint balance $B_PRE -> $B0"
record mint "$L" "buyer +10000000" "buyer $B_PRE -> $B0"

L="$LOG_DIR/s2-4.log"
if near contract call-function as-transaction "$USD" mint json-args "{\"receiver_id\":\"$BUYER\",\"amount\":\"10000001\"}" prepaid-gas '30 TGas' attached-deposit '0 NEAR' sign-as "$BUYER" "${SIGN[@]}" >"$L" 2>&1 \
  && ! grep -q "mint cap" "$L"; then
  fail "over-cap mint was accepted"
fi
grep -q "mint cap" "$L" || fail "over-cap mint failed without the cap message"
record mint_cap "$L" "mint 10000001 rejected with 'mint cap'" "rejected: $(grep -o 'Arrow-USD: mint cap[^"]*' "$L" | head -1)"

# 2a) refund_all: balances unchanged
L="$LOG_DIR/s2-5.log"
S0=$(bal "$SPIKE"); S0=${S0:-0}
near contract call-function as-transaction "$USD" ft_transfer_call json-args "{\"receiver_id\":\"$SPIKE\",\"amount\":\"100000\",\"msg\":\"refund_all\"}" prepaid-gas '300 TGas' attached-deposit '1 yoctoNEAR' sign-as "$BUYER" "${SIGN[@]}" >"$L" 2>&1 || fail "refund_all tx"
sleep 5; B1=$(bal "$BUYER"); S1=$(bal "$SPIKE"); S1=${S1:-0}
[ "$B1" -eq "$B0" ] && [ "$S1" -eq "$S0" ] || fail "refund_all buyer $B0 -> $B1, receiver $S0 -> $S1"
record refund_all "$L" "buyer and receiver unchanged" "buyer $B0 -> $B1, receiver $S0 -> $S1"

# 2b) keep: buyer -100000, receiver +100000
L="$LOG_DIR/s2-6.log"
near contract call-function as-transaction "$USD" ft_transfer_call json-args "{\"receiver_id\":\"$SPIKE\",\"amount\":\"100000\",\"msg\":\"keep\"}" prepaid-gas '300 TGas' attached-deposit '1 yoctoNEAR' sign-as "$BUYER" "${SIGN[@]}" >"$L" 2>&1 || fail "keep tx"
sleep 5; B2=$(bal "$BUYER"); S2=$(bal "$SPIKE")
[ "$B2" -eq $((B1 - 100000)) ] && [ "$S2" -eq $((S1 + 100000)) ] || fail "keep buyer $B1 -> $B2, receiver $S1 -> $S2"
record keep "$L" "buyer -100000, receiver +100000" "buyer $B1 -> $B2, receiver $S1 -> $S2"

echo "S2-TESTNET PASS"
