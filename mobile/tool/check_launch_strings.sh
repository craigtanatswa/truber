#!/usr/bin/env bash
# Fail if a live web build still contains demo or pre-launch wording.
set -euo pipefail
cd "$(dirname "$0")/.."
flutter build web \
  --dart-define=TRUBER_DATA=live \
  --dart-define=API_BASE_URL=https://api.example.invalid
js="build/web/main.dart.js"
if [[ ! -f "$js" ]]; then
  echo "missing $js" >&2
  exit 1
fi
fail=0
for pat in demopass 'Demo code' 'coming soon' preview; do
  if grep -qi -- "$pat" "$js"; then
    echo "FOUND: $pat"
    fail=1
  else
    echo "absent: $pat"
  fi
done
exit "$fail"
