#!/usr/bin/env bash
# Usage: bash scripts/csp-browser.sh [<port>]   (default 3927)
# Runs web/scripts/csp-browser-check.mjs against a local `next start -p <port>` of the web build, in headless Chromium
# inside Docker (never the user's browser). Prints CSP_BROWSER: PASS when no page reports a CSP violation.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
PORT="${1:-3927}"
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "csp-browser: start the build first: npm run -w @arrow/web start -- -p $PORT" >&2; exit 2; }
docker run --rm --add-host=host.docker.internal:host-gateway -v "$ROOT/web/scripts:/check:ro" node:24.22.2-bookworm bash -c "
  set -e
  apt-get update -qq >/dev/null && apt-get install -y -qq chromium >/dev/null 2>&1
  chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 about:blank >/dev/null 2>&1 &
  for i in \$(seq 50); do curl -fsS -o /dev/null http://127.0.0.1:9222/json/version && break; sleep 0.2; done
  node /check/csp-browser-check.mjs http://host.docker.internal:$PORT
"
