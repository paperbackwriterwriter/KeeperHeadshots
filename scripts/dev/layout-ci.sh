#!/usr/bin/env bash
# DEV/QA ONLY — runs the layout audit (scripts/dev/layout-audit.mjs) the way
# CI does (.github/workflows/layout.yml): the stand-in AI/email/payment
# service plus one app server on a fresh throwaway store.
#   bash scripts/dev/layout-ci.sh [chromium|webkit] [outDir]
set -euo pipefail
cd "$(dirname "$0")/../.."

BROWSER="${1:-chromium}"
OUT="${2:-layout-audit-$BROWSER}"
WORK=$(mktemp -d)
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

MOCK_QA_FAIL=none MOCK_DELAY_MS=600 node scripts/dev/mock-ai.js >"$WORK/mock.log" 2>&1 &
PIDS+=($!)
M=http://localhost:4010
env DATA_DIR="$WORK/data" PORT=3100 SESSION_SECRET=layout-audit-secret-layout-audit-secret \
  ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=$M GEMINI_API_KEY=test GEMINI_BASE_URL=$M \
  RESEND_API_KEY=re_test RESEND_BASE_URL=$M META_PIXEL_ID=123456 META_CAPI_TOKEN=tok META_GRAPH_BASE=$M \
  STRIPE_SECRET_KEY=sk_test_mock STRIPE_API_BASE=$M STRIPE_PUBLISHABLE_KEY=pk_test_mockmockmock \
  GOOGLE_CLIENT_ID=audit-client.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=gs-audit GOOGLE_AUTH_URL=$M/google/auth GOOGLE_TOKEN_URL=$M/google/token \
  OWNER_EMAILS=audit-owner@example.com \
  node server.js >"$WORK/server.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 60); do
  curl -sf localhost:3100/api/version >/dev/null && curl -s localhost:4010 >/dev/null && break
  sleep 0.5
done

status=0
BROWSER="$BROWSER" node scripts/dev/layout-audit.mjs "$OUT" || status=$?
if [ $status -ne 0 ]; then echo "== server log"; tail -40 "$WORK/server.log"; fi
exit $status
