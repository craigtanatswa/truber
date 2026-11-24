#!/usr/bin/env bash
# Truber API smoke test: GET <url>/auth/me with NO token must return 401 JSON
# (OpenAPI v0.4.0 Error: {"code": ..., "message": ...}).
# Sends no credentials, no token, no body. Usage: tool/smoke.sh https://<api-host>[/base]
set -euo pipefail

url="${1:-}"
if [[ -z "$url" ]]; then
  echo "usage: $0 <https API base URL>" >&2; exit 2
fi
if [[ "$url" != https://* ]]; then
  echo "FAIL: API_BASE_URL must be https:// (got: $url)" >&2; exit 2
fi
base="${url%/}"
target="$base/auth/me"
body="$(mktemp)"; hdrs="$(mktemp)"; trap 'rm -f "$body" "$hdrs"' EXIT

# No -L: a redirect (e.g. Vercel Deployment Protection login) is a failure.
status="$(curl -sS --max-time 20 -o "$body" -D "$hdrs" -w '%{http_code}' \
  -H 'Accept: application/json' "$target" 2>/dev/null || true)"
ctype="$(grep -i '^content-type:' "$hdrs" | tail -1 | tr -d '\r' | cut -d' ' -f2- || true)"

echo "GET $target -> HTTP $status (${ctype:-no content-type})"
if [[ "$status" == "000" ]]; then
  echo "FAIL: no response (DNS/TLS/timeout)"; exit 1
fi
if [[ "$status" =~ ^30[1278]$ ]] || grep -Eqi 'vercel.*(authentication|login)|<html' "$body"; then
  echo "FAIL: got a redirect/HTML page — Vercel Deployment Protection is probably on"; exit 1
fi
if [[ "$status" != "401" ]]; then
  echo "FAIL: expected 401 without a token"; head -c 300 "$body"; echo; exit 1
fi
if [[ "${ctype,,}" != application/json* ]]; then
  echo "FAIL: 401 is not JSON"; exit 1
fi
if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d.get("code"),str) and isinstance(d.get("message"),str)' "$body" 2>/dev/null; then
  echo "FAIL: 401 body is not an OpenAPI Error {code, message}"; head -c 300 "$body"; echo; exit 1
fi
code="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["code"])' "$body")"
echo "PASS: 401 JSON Error code=$code"
