#!/usr/bin/env bash
# Usage: bash scripts/secret-scan.sh [--ci] [--no-gitleaks]
# Exit 0 = clean. Prints the DECISIONS S-04 raw grep count for human review, fails only on real secret shapes.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
CI=0; GL=1; for a in "$@"; do [ "$a" = --ci ] && { CI=1; GL=0; }; [ "$a" = --no-gitleaks ] && GL=0; done
echo "== S-04 raw grep (review only)"
git log -p --all | grep -n -i -E "ed25519:|secp256k1:|PRIVATE_KEY=|sk-|BLOB_READ_WRITE_TOKEN=|PROTECTED_" | wc -l
STRICT='ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|secp256k1:[1-9A-HJ-NP-Za-km-z]{80,}|(PRIVATE_KEY|BLOB_READ_WRITE_TOKEN|NEARAI_API_KEY|ONECLICK_JWT)=[A-Za-z0-9+/_:.-]{16,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|vercel_blob_rw_[A-Za-z0-9_]{16,}|(private_?key|secret_?key|privateKey|secretKey)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?(0x)?([0-9a-fA-F]{64}|ed25519:)'
fail=0
echo "== strict patterns in history"; git log -p --all | grep -n -E "$STRICT" && fail=1
echo "== strict patterns in untracked, not ignored files"; git ls-files -o --exclude-standard -z | xargs -0 -r grep -n -E "$STRICT" && fail=1
if [ $GL = 1 ]; then echo "== gitleaks"; gitleaks git --no-banner --redact -v . || fail=1; fi
[ $fail = 0 ] && echo "SECRET_SCAN: PASS" || echo "SECRET_SCAN: FAIL"
exit $fail
