#!/usr/bin/env bash
# Usage: bash scripts/secret-scan.sh [--ci] [--no-gitleaks]
# Exit 0 = clean. Prints the raw grep count for human review, fails only on real secret shapes.
# --ci runs the regexes only (the ts job has no gitleaks); the CI job "secrets" runs this script without --ci, with gitleaks installed.
# Banned words: one ERE per line (blank lines and # comments ignored, matched case-insensitively) in
# <git-common-dir>/info/banned-words. That file is local and never committed, so the words are never in the repo.
# Any match in a tracked or untracked-not-ignored file fails the scan; --public also fails on a match in any commit
# diff or message of any ref (run it before making the repo public).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
CI=0; GL=1; for a in "$@"; do [ "$a" = --ci ] && { CI=1; GL=0; }; [ "$a" = --no-gitleaks ] && GL=0; done
echo "== S-04 raw grep (review only)"
git log -p --all | grep -n -i -E "ed25519:|secp256k1:|PRIVATE_KEY=|sk-|BLOB_READ_WRITE_TOKEN=|PROTECTED_" | wc -l
STRICT='ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|secp256k1:[1-9A-HJ-NP-Za-km-z]{80,}|(PRIVATE_KEY|BLOB_READ_WRITE_TOKEN|NEARAI_API_KEY|ONECLICK_JWT)=[A-Za-z0-9+/_:.-]{16,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|vercel_blob_rw_[A-Za-z0-9_]{16,}|(private_?key|secret_?key|privateKey|secretKey)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?(0x)?([0-9a-fA-F]{64}|ed25519:)|"(NEARAI_API_KEY(_MAINNET)?|PROTECTED_MASTER|RELAYER_(ESCROW_)?PRIVATE_KEY|TESTNET_SPONSOR_PRIVATE_KEY|ONECLICK_JWT)"[[:space:]]*:[[:space:]]*"[^"]{16,}"|PROTECTED_[A-Z_]+["'"'"']?=["'"'"']?[0-9a-fA-F]{32,}'
fail=0
echo "== strict patterns in history"; git log -p --all | grep -n -E "$STRICT" && fail=1
# Judge by output, not exit status: BSD xargs exits 0 on empty input without running grep.
echo "== strict patterns in untracked, not ignored files"
hits=$(git ls-files -o --exclude-standard -z | xargs -0 -r grep -n -E "$STRICT")
[ -n "$hits" ] && { printf '%s\n' "$hits"; fail=1; }
BW="$(git rev-parse --git-common-dir)/info/banned-words"
if [ -f "$BW" ]; then
  PAT=$(grep -v -E '^[[:space:]]*(#|$)' "$BW" | paste -sd'|' -)
  if [ -n "$PAT" ]; then
    echo "== banned words in the working tree (file:line only)"
    # Print only file:line so a CI or terminal log never repeats the word.
    hits=$(git grep -n -I -i -E -e "$PAT" --untracked --exclude-standard | cut -d: -f1,2)
    [ -n "$hits" ] && { printf '%s\n' "$hits"; fail=1; }
    for a in "$@"; do
      if [ "$a" = --public ]; then
        echo "== banned words in history, all refs (commit only)"
        hist=$({ git log --all -i -G "$PAT" --format='diff %h'; git log --all -i -E --grep "$PAT" --format='message %h'; } | sort -u)
        [ -n "$hist" ] && { printf '%s\n' "$hist"; fail=1; }
      fi
    done
  fi
fi
if [ $GL = 1 ]; then echo "== gitleaks"; gitleaks git --no-banner --redact -v . || fail=1; fi
[ $fail = 0 ] && echo "SECRET_SCAN: PASS" || echo "SECRET_SCAN: FAIL"
exit $fail
