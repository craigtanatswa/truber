#!/bin/bash
# Build the /app web bundle and refresh the report-only CSP.
# Extra args are passed to `flutter build web` (for example --dart-define).
#
# Live API (connect-src):
#   API_ORIGIN=https://api.example.com ./deploy/build_web.sh \
#     --dart-define=TRUBER_DATA=live \
#     --dart-define=API_BASE_URL=https://api.example.com
#
# The font fallback path lives in web/flutter_bootstrap.js. This script does
# not patch build output for that. It copies deploy/vercel.json into
# build/web so a deploy of that directory sends the report-only header.
set -euo pipefail
cd "$(dirname "$0")/.."

flutter build web --no-web-resources-cdn "$@"

args=(--index build/web/index.html --out deploy/vercel.json)
if [ -n "${API_ORIGIN:-}" ]; then
  args+=(--api-origin "$API_ORIGIN")
fi
node deploy/write_csp.mjs "${args[@]}"
cp deploy/vercel.json build/web/vercel.json
echo "build/web is ready. CSP is report-only and console-only (no report endpoint)."
