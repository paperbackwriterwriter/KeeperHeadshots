#!/usr/bin/env bash
# DEV/QA ONLY — runs every server test suite the way CI does
# (.github/workflows/ci.yml): the stand-in AI/email/payment service
# (scripts/dev/mock-ai.js) plus two app servers sharing one throwaway store.
#   bash scripts/dev/ci.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

WORK=$(mktemp -d)
DATA="$WORK/data"
MOCKLOG="$WORK/mock.log"
mkdir -p "$DATA"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== syntax"
for f in server.js lib/*.js scripts/*.js scripts/dev/*.js public/js/*.js public/js/views/*.js public/js/shared/*.js; do node --check "$f"; done

MOCK_QA_FAIL=none node scripts/dev/mock-ai.js >"$MOCKLOG" 2>&1 &
PIDS+=($!)

M=http://localhost:4010
server() {
  env DATA_DIR="$DATA" PORT="$1" SESSION_SECRET=ci-session-secret-ci-session-secret \
    ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=$M GEMINI_API_KEY=test GEMINI_BASE_URL=$M \
    RESEND_API_KEY=re_test RESEND_BASE_URL=$M META_PIXEL_ID=123456 META_CAPI_TOKEN=tok META_GRAPH_BASE=$M \
    STRIPE_SECRET_KEY=sk_test_mock STRIPE_API_BASE=$M STRIPE_PUBLISHABLE_KEY=pk_test_mockmockmock \
    ADMIN_TOKEN=ci-admin-token-ci-admin-token OWNER_EMAILS=owner-ci@example.com,funnel-owner@example.com,slots-owner@example.com RENDER_SLOTS=3 \
    node server.js >"$WORK/server-$1.log" 2>&1 &
  PIDS+=($!)
}
server 3100
server 3101
for i in $(seq 1 60); do
  curl -sf localhost:3100/api/version >/dev/null && curl -sf localhost:3101/api/version >/dev/null && curl -s localhost:4010 >/dev/null && break
  sleep 0.5
done

status=0
run() {
  echo "== $1"
  if ! "${@:2}" >"$WORK/$1.out" 2>&1; then
    status=1
    echo "FAILED: $1"
    grep -v '^PASS' "$WORK/$1.out" | tail -40
  else
    tail -1 "$WORK/$1.out"
  fi
}
run race node scripts/dev/race-tests.js
run reset node scripts/dev/reset-tests.js
run hardening env DATA_DIR="$DATA" QA_ADMIN_TOKEN=ci-admin-token-ci-admin-token BASE2=http://localhost:3101 node scripts/dev/hardening-tests.js
run cleanup node scripts/dev/cleanup-tests.js
run backup node scripts/dev/backup-tests.js
run env node scripts/dev/env-tests.js
run alerts node scripts/dev/alert-tests.js
run growth node scripts/dev/growth-tests.js
run e2e node scripts/dev/api-e2e.js
run team node scripts/dev/team-tests.js
run render-race env MOCKLOG="$MOCKLOG" EMAIL=owner-ci@example.com node scripts/dev/render-race.js
run slots env MOCKLOG="$MOCKLOG" RENDER_SLOTS=3 node scripts/dev/slots-test.js

if [ $status -ne 0 ]; then
  echo "== server log (3100)"; tail -60 "$WORK/server-3100.log"
fi
exit $status
