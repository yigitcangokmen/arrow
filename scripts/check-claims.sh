#!/usr/bin/env bash
# Forbidden-claim check for judge-facing surfaces (WS7-T04a; DEC R-03, M-05, U-03, A-03/06/07, D-14, K-05).
#
#   bash scripts/check-claims.sh                 # judge-facing surfaces, exit 0/1
#   bash scripts/check-claims.sh --final         # + placeholder / TODO checks
#   bash scripts/check-claims.sh --files a.md b  # only these files
#
# One line per hit:  <file>:<line>: [<rule>] <text>
# Text between <!-- claims:quoted:start --> and <!-- claims:quoted:end --> is not scanned. The markers are
# allowed only in README sections "What we do not claim" and "Other projects by the same people".
# Portable on purpose: bash 3.2 (macOS), BSD and GNU grep. No mapfile, no grep -P, no word-boundary escapes.
set -euo pipefail
cd "$(dirname "$0")/.."

FINAL=0
FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --final) FINAL=1 ;;
    --files)
      shift
      while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do FILES+=("$1"); shift; done
      continue ;;
  esac
  shift
done

collect() {
  for f in README.md JUDGES.md sdk/src/x402.ts scripts/src/verify.ts; do [ -f "$f" ] && echo "$f"; done
  find docs/submission docs/video -type f \( -name '*.md' -o -name '*.txt' -o -name '*.srt' \) 2>/dev/null
  for f in invite followup seller-guide targets; do [ -f "docs/outreach/$f.md" ] && echo "docs/outreach/$f.md"; done
  find web/app web/components agent/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.*' ! -path '*/node_modules/*' ! -path '*/.next/*' 2>/dev/null
  return 0
}

if [ ${#FILES[@]} -eq 0 ]; then
  while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(collect | sort -u)
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/check-claims.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/out"
: > "$OUT"

# Substring rules. Format: rule ::: ERE (matched case-insensitively against the text of a line).
RULES='first-claim ::: (^|[^a-z])(world.?s )?first[ -](ndai|pay-if|implementation|live|mainnet|ever|of its kind|inspect)
first-claim ::: first-ever
x402-extension ::: x402 extension
x402-payment ::: x402 payment
x402-standard ::: x402[^.]{0,40}standard|standard[^.]{0,40}x402
no-bridge ::: no bridge
trustless ::: trustless
nothing-leaks ::: nothing leaks
evm-impossible ::: impossible on evm
funds-never-leave ::: funds never leave
refund-to-wallet ::: refunded to (your|the buyer.?s?) wallet|(came|comes|goes) back to (your|the) wallet|back to your wallet
deterministic-llm ::: deterministic llm|temperature 0 gives
npx-arrow ::: npx[ ]arrow([^-a-z]|$)
pay-if ::: pay[-_]if
tender-core ::: sealed[- ]bid|auction|(^|[^a-z])ckd([^a-z]|$)|identity-based encryption|(^|[^a-z])ibe([^a-z]|$)
seal-until ::: conditional seal|seal until
tee-escrow-headline ::: tee escrow
split-screen ::: split[- ]screen|twin (buyer|outcome)
pass-refund ::: pass[^.]{0,30}refund|refund[^.]{0,30}on pass
x402-compatible ::: x402[- ]compatible
verdict-leaves ::: only a (capped )?verdict leaves
own-chain-payout ::: (receives|paid|gets paid) on (their|its) own chain|seller (is )?paid on solana
zk ::: zero[- ]knowledge|zk[- ]proof'

# Only with --final, and only for prose files (md, txt, srt): code legitimately contains <T> and generics.
FINAL_RULES='final-placeholder ::: [{][{][A-Z0-9_]+[}][}]
final-placeholder ::: <(REPO_URL|LOCK_TX|WASM_SHA256|EVAL_ID|LISTING_ID|HOSTED_URL|MCP_CONFIG_SNIPPET|DATE|S1-b tx|S3c tx)>
final-placeholder ::: <(team|diagram|list|name|N|M|K|J|T|X|Y|a|b|c|captured|total|15)>
final-placeholder ::: <If [^>]*>
final-placeholder ::: <none[^>]*>
final-placeholder ::: XXXXXXXXXXX
final-placeholder ::: (^|[^a-z])(TODO|TBD|FIXME)([^a-z]|$)'

is_readme() { local b; b="$(basename "$1" | tr 'A-Z' 'a-z')"; case "$b" in readme*) return 0 ;; esac; return 1; }

# Quoted-block marker placement and balance; prints "line<TAB>text".
quoted_problems() {
  local readme="$1"
  awk -v readme="$readme" '
    /^## / { h = $0 }
    /<!-- claims:quoted:start -->/ {
      if (q) print FNR "\tnested quoted start"
      ok = (readme == 1 && (tolower(h) ~ /what we do not claim/ || tolower(h) ~ /other projects by the same people/))
      if (!ok) print FNR "\tquoted block outside an allowed section"
      q = 1; next
    }
    /<!-- claims:quoted:end -->/ { if (!q) print FNR "\tquoted end without start"; q = 0; next }
    END { if (q) print FNR "\tquoted block never closed" }
  ' "$2"
}

# "receipt tree" is allowed in the README only under the "How it works" heading, nowhere else.
receipt_tree() {
  local readme="$1"
  awk -v readme="$readme" '
    /<!-- claims:quoted:start -->/ { q = 1; next }
    /<!-- claims:quoted:end -->/ { q = 0; next }
    /^## / { h = tolower($0) }
    !q && tolower($0) ~ /receipt tree/ {
      if (readme == 1 && h ~ /^## how it works/) next
      print FNR "\t" $0
    }
  ' "$2"
}

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  readme=0; is_readme "$f" && readme=1
  # Scannable body: quoted blocks removed, original line numbers kept.
  awk '/<!-- claims:quoted:start -->/{q=1;next} /<!-- claims:quoted:end -->/{q=0;next} !q{print FNR "\t" $0}' "$f" > "$TMP/body"

  emit() { # rule, then "n<TAB>text" lines on stdin
    local rule="$1" n t
    while IFS=$'\t' read -r n t; do echo "$f:$n: [$rule] $t" >> "$OUT"; done
  }

  apply() { # newline-separated "rule ::: regex" table
    local line rule re
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      rule="${line%% ::: *}"; re="${line#* ::: }"
      grep -i -E -- "$re" "$TMP/body" | emit "$rule" || true
    done <<EOF
$1
EOF
  }

  apply "$RULES"

  # llm-cannot-buy: the sentence must carry its qualifier on the same line.
  { grep -i -E -- 'llm cannot produce buy' "$TMP/body" | grep -i -v -E -- 'unless the structural gates pass' || true; } | emit llm-cannot-buy

  receipt_tree "$readme" "$f" | emit receipt-tree-placement
  quoted_problems "$readme" "$f" | emit quoted-block-misplaced

  if [ "$FINAL" -eq 1 ]; then
    case "$f" in *.md|*.txt|*.srt) apply "$FINAL_RULES" ;; esac
  fi
done

if [ -s "$OUT" ]; then
  sort -t: -k1,1 -k2,2n "$OUT"
  echo "check-claims: $(wc -l < "$OUT" | tr -d ' ') hit(s)" >&2
  exit 1
fi
exit 0
