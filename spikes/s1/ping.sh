#!/usr/bin/env bash
# Usage: bash spikes/s1/ping.sh  → prints "HTTP <code>"; never prints the key
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"; if [ -z "${NEARAI_API_KEY:-}" ]; then set -a; source .env; set +a; fi
: "${NEARAI_API_KEY:?missing NEARAI_API_KEY in .env}"
curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 60 https://cloud-api.near.ai/v1/chat/completions \
  -H "Authorization: Bearer ${NEARAI_API_KEY}" -H 'content-type: application/json' \
  -d '{"model":"Qwen/Qwen3.8-27B","messages":[{"role":"user","content":"ping"}],"max_tokens":1}'
