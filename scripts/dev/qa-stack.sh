#!/usr/bin/env bash
# DEV/QA ONLY — one app server plus the stand-in services (scripts/dev/mock-ai.js)
# on ports of your choosing, with a fresh throwaway data folder, for reviewers
# working alongside ci.sh (which uses the fixed ports 3100/3101/4010/2525).
#   bash scripts/dev/qa-stack.sh <appPort> <mockPort> <smtpPort> [1 = legacy free shoot on]
#   QAFAIL=all bash scripts/dev/qa-stack.sh ...   (every AI quality check fails)
# Prints the data folder. Stop with: kill $(cat <folder>/pids)
set -e
P=$1; MP=$2; SP=$3; FREE=${4:-0}
cd "$(dirname "$0")/../.."
DATA=$(mktemp -d "${TMPDIR:-/tmp}/kh-$P-XXXX"); M=http://localhost:$MP
MOCK_PORT=$MP MOCK_SMTP_PORT=$SP MOCK_QA_FAIL=${QAFAIL:-none} node scripts/dev/mock-ai.js >"$DATA/mock.log" 2>&1 & echo $! > "$DATA/pids"
env FREE_SHOOT_OFFERED=$FREE DATA_DIR="$DATA/store" PORT=$P SESSION_SECRET=qa-session-secret-qa-session-secret \
  ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=$M GEMINI_API_KEY=test GEMINI_BASE_URL=$M \
  RESEND_API_KEY=re_test RESEND_BASE_URL=$M META_PIXEL_ID=123456 META_CAPI_TOKEN=tok META_GRAPH_BASE=$M \
  STRIPE_SECRET_KEY=sk_test_mock STRIPE_API_BASE=$M STRIPE_PUBLISHABLE_KEY=pk_test_mockmockmock \
  GOOGLE_CLIENT_ID=qa-client.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=gs-qa-secret GOOGLE_AUTH_URL=$M/google/auth GOOGLE_TOKEN_URL=$M/google/token \
  ADMIN_TOKEN=qa-admin-token-qa-admin-token OWNER_EMAILS=owner-qa@example.com RENDER_SLOTS=3 \
  node server.js >"$DATA/server.log" 2>&1 & echo $! >> "$DATA/pids"
for i in $(seq 1 60); do curl -sf "localhost:$P/api/version" >/dev/null && curl -s "$M" >/dev/null && break; sleep 0.5; done
echo "$DATA"
