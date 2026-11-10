#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
FIXTURES_FILE="${FIXTURES_FILE:?FIXTURES_FILE is required (the path the API was started with)}"
OUT_DIR="${OUT_DIR:?OUT_DIR is required}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@seed.truber.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required (the seeded admin password)}"

for tool in curl psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    exit 2
  fi
done

if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL=python3
else
  echo "missing JSON tool: install jq or python3" >&2
  exit 2
fi

database_host() {
  local url="$1" rest authority hostport host
  rest="${url#*://}"
  authority="${rest%%/*}"
  hostport="${authority##*@}"
  if [[ "$hostport" == \[* ]]; then
    host="${hostport#\[}"
    host="${host%%\]*}"
  else
    host="${hostport%%:*}"
  fi
  printf '%s' "$host"
}

db_host="$(database_host "$DATABASE_URL")"
case "$db_host" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "refusing: DATABASE_URL must point at a loopback host (localhost, 127.0.0.1, or ::1); got '$db_host'" >&2
    exit 2
    ;;
esac

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/[0-9][0-9]-*.request.txt "$OUT_DIR"/[0-9][0-9]-*.response.txt "$OUT_DIR/summary.txt"

tmp_dir="$(mktemp -d)"
tmp_body="$tmp_dir/response-body"
tmp_headers="$tmp_dir/response-headers"
tmp_req_body="$tmp_dir/request-body"
step_count=0
failures=0
summary_done=0
CURRENT_STEP=0
LAST_BODY_FILE=
LAST_STATUS=

json_value() {
  local file="$1" filter="$2" pyexpr="$3"
  if [[ "$JSON_TOOL" == "jq" ]]; then
    jq -r "$filter" "$file" 2>/dev/null || true
  else
    python3 - "$file" "$pyexpr" <<'PY'
import json
import sys

path, expression = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    value = eval(expression, {"data": data, "len": len})
except Exception:
    print("")
    raise SystemExit(0)
if value is None:
    print("")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(",", ":")))
else:
    print(value)
PY
  fi
}

redact_pretty() {
  local file="$1"
  if [[ "$JSON_TOOL" == "jq" ]]; then
    jq 'walk(if type == "object" then with_entries(if (.key == "accessToken" or .key == "refreshToken" or .key == "password" or .key == "newPassword" or .key == "token") then .value = "[redacted]" elif (.key == "code" and ((.value | type) == "string") and (.value | test("^[0-9]{4,12}$"))) then .value = "[redacted]" else . end) else . end)' "$file" 2>/dev/null || cat "$file"
  else
    python3 - "$file" <<'PY'
import json
import re
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    with open(path, encoding="utf-8") as handle:
        sys.stdout.write(handle.read())
    raise SystemExit(0)

def redact(value):
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if key in {"accessToken", "refreshToken", "password", "newPassword", "token"}:
                cleaned[key] = "[redacted]"
            elif key == "code" and isinstance(item, str) and re.fullmatch(r"[0-9]{4,12}", item):
                cleaned[key] = "[redacted]"
            else:
                cleaned[key] = redact(item)
        return cleaned
    return value

print(json.dumps(redact(data), indent=2))
PY
  fi
}

json_string() {
  local value="$1"
  if [[ "$JSON_TOOL" == "jq" ]]; then
    jq -Rn --arg value "$value" '$value'
  else
    python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$value"
  fi
}

new_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr -d '\n' < /proc/sys/kernel/random/uuid
  else
    python3 -c 'import uuid; print(uuid.uuid4())'
  fi
}

add_note() {
  local idx="$CURRENT_STEP" note="$1"
  step_notes[$idx]="${step_notes[$idx]:+${step_notes[$idx]}; }$note"
}

mark_fail() {
  local idx="$CURRENT_STEP" note="$1"
  if [[ "${step_result[$idx]}" != "FAIL" ]]; then
    step_result[$idx]="FAIL"
    failures=$((failures + 1))
  fi
  add_note "$note"
}

check_json_value() {
  local filter="$1" pyexpr="$2" expected="$3" label="$4" actual
  actual="$(json_value "$LAST_BODY_FILE" "$filter" "$pyexpr")"
  if [[ "$actual" != "$expected" ]]; then
    mark_fail "$label expected $expected actual ${actual:-<none>}"
  else
    add_note "$label=$actual"
  fi
}

api_call() {
  local name="$1" expected="$2" method="$3" path="$4"
  local token="${5:-}" body="${6:-}" extra_header="${7:-}" expected_code="${8:-}"
  local idx nn url req_file resp_file status curl_rc status_line actual_code
  step_count=$((step_count + 1))
  idx=$step_count
  step_nn[$idx]="$(printf '%02d' "$idx")"
  step_name[$idx]="$name"
  step_expected[$idx]="$expected"
  step_actual[$idx]=""
  step_result[$idx]="PASS"
  step_notes[$idx]=""
  nn="${step_nn[$idx]}"
  url="$BASE_URL$path"
  req_file="$OUT_DIR/${nn}-${name}.request.txt"
  resp_file="$OUT_DIR/${nn}-${name}.response.txt"

  {
    printf '%s %s\n' "$method" "$url"
    printf 'Accept: application/json\n'
    if [[ -n "$body" ]]; then printf 'Content-Type: application/json\n'; fi
    if [[ -n "$token" ]]; then printf 'Authorization: Bearer [redacted]\n'; fi
    if [[ -n "$extra_header" ]]; then printf '%s\n' "$extra_header"; fi
    if [[ -n "$body" ]]; then
      printf '\n'
      printf '%s' "$body" > "$tmp_req_body"
      redact_pretty "$tmp_req_body"
    fi
  } > "$req_file"

  local curl_args=(-sS --max-time 30 -X "$method" -D "$tmp_headers" -o "$tmp_body" -w '%{http_code}')
  if [[ -n "$token" ]]; then curl_args+=(-H "Authorization: Bearer $token"); fi
  if [[ -n "$body" ]]; then curl_args+=(-H 'Content-Type: application/json' --data "$body"); fi
  if [[ -n "$extra_header" ]]; then curl_args+=(-H "$extra_header"); fi

  set +e
  status="$(curl "${curl_args[@]}" "$url")"
  curl_rc=$?
  set -e
  if ((curl_rc != 0)); then status="000"; fi

  status_line=""
  if [[ -s "$tmp_headers" ]]; then
    status_line="$(sed -n '1p' "$tmp_headers" | tr -d '\r')"
  fi
  {
    printf '%s\n' "${status_line:-HTTP $status}"
    if [[ -s "$tmp_body" ]]; then
      redact_pretty "$tmp_body"
    fi
  } > "$resp_file"

  step_actual[$idx]="$status"
  if [[ "$status" != "$expected" ]]; then
    step_result[$idx]="FAIL"
    failures=$((failures + 1))
    step_notes[$idx]="expected HTTP $expected"
  fi
  if [[ -n "$expected_code" ]]; then
    actual_code="$(json_value "$tmp_body" '.code // empty' 'data.get("code") or ""')"
    if [[ "$actual_code" != "$expected_code" ]]; then
      if [[ "${step_result[$idx]}" != "FAIL" ]]; then
        step_result[$idx]="FAIL"
        failures=$((failures + 1))
      fi
      step_notes[$idx]="${step_notes[$idx]:+${step_notes[$idx]}; }code expected $expected_code actual ${actual_code:-<none>}"
    else
      step_notes[$idx]="${step_notes[$idx]:+${step_notes[$idx]}; }code=$actual_code"
    fi
  fi
  if ((curl_rc != 0)); then
    if [[ "${step_result[$idx]}" != "FAIL" ]]; then
      step_result[$idx]="FAIL"
      failures=$((failures + 1))
    fi
    step_notes[$idx]="${step_notes[$idx]:+${step_notes[$idx]}; }curl exit $curl_rc"
  fi

  CURRENT_STEP=$idx
  LAST_BODY_FILE="$tmp_body"
  LAST_STATUS="$status"
}

write_summary() {
  mkdir -p "$OUT_DIR"
  {
    printf '# Off-platform ban HTTP evidence\n'
    printf 'base_url=%s\n' "$BASE_URL"
    printf 'database_host=%s\n' "$db_host"
    printf 'fixtures_file=%s\n' "$FIXTURES_FILE"
    printf '\n'
    printf '%-3s  %-38s  %-8s  %-8s  %-6s  %s\n' 'NN' 'STEP' 'EXPECTED' 'ACTUAL' 'RESULT' 'NOTES'
    local i
    for ((i = 1; i <= step_count; i++)); do
      printf '%-3s  %-38s  %-8s  %-8s  %-6s  %s\n' \
        "${step_nn[$i]}" "${step_name[$i]}" "${step_expected[$i]}" "${step_actual[$i]}" \
        "${step_result[$i]}" "${step_notes[$i]:-}"
    done
    printf '\n'
    if ((failures == 0)); then
      printf 'OVERALL PASS (%d steps)\n' "$step_count"
    else
      printf 'OVERALL FAIL (%d of %d steps)\n' "$failures" "$step_count"
    fi
  } > "$OUT_DIR/summary.txt"
  summary_done=1
}

cleanup() {
  local rc=$?
  if [[ "$summary_done" != "1" ]] && ((step_count > 0)); then
    write_summary || true
  fi
  rm -rf "$tmp_dir"
  return "$rc"
}
trap cleanup EXIT

run_id="$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
shipper_email="offplatform.shipper.${run_id}@example.com"
transporter_email="offplatform.transporter.${run_id}@example.com"
shipper_password="offplatform-shipper-${run_id}-password"
transporter_password="offplatform-transporter-${run_id}-password"
booking_id="$(new_uuid)"
finding_reason="Local evidence: confirmed off-platform circumvention on the demo booking."
lift_reason="Local evidence: ban lifted after admin review."

register_shipper_body="$(printf '{"email":%s,"password":%s,"fullName":%s,"city":%s,"role":"shipper"}' \
  "$(json_string "$shipper_email")" "$(json_string "$shipper_password")" \
  "$(json_string 'Off-platform Evidence Shipper')" "$(json_string 'Harare')")"
register_transporter_body="$(printf '{"email":%s,"password":%s,"fullName":%s,"city":%s,"role":"transporter"}' \
  "$(json_string "$transporter_email")" "$(json_string "$transporter_password")" \
  "$(json_string 'Off-platform Evidence Transporter')" "$(json_string 'Bulawayo')")"
admin_login_body="$(printf '{"email":%s,"password":%s}' \
  "$(json_string "$ADMIN_EMAIL")" "$(json_string "$ADMIN_PASSWORD")")"

# 1. Accounts, companies, and admin verification.
api_call register-shipper 201 POST /auth/register "" "$register_shipper_body"
shipper_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
shipper_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$shipper_token" || -z "$shipper_user_id" ]]; then
  mark_fail "missing shipper access token or user id"
  exit 1
fi

api_call register-transporter 201 POST /auth/register "" "$register_transporter_body"
transporter_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
transporter_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$transporter_token" || -z "$transporter_user_id" ]]; then
  mark_fail "missing transporter access token or user id"
  exit 1
fi

api_call otp-request 202 POST /auth/otp/request "$shipper_token" '{"channel":"email"}'
otp_code="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT payload FROM delivery_outbox WHERE kind = 'otp' AND user_id = '$shipper_user_id' ORDER BY created_at DESC LIMIT 1")"
otp_code="$(printf '%s' "$otp_code" | tr -d '[:space:]')"
if [[ -z "$otp_code" ]]; then
  mark_fail "no OTP code found in delivery_outbox"
  exit 1
fi
add_note "OTP read from delivery_outbox"

otp_verify_body="$(printf '{"code":%s}' "$(json_string "$otp_code")")"
api_call otp-verify 200 POST /auth/otp/verify "$shipper_token" "$otp_verify_body"
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

shipper_company_body="$(printf '{"type":"shipper","legalName":%s,"city":%s}' \
  "$(json_string "Off-platform Evidence Shipper $run_id")" "$(json_string 'Harare')")"
api_call create-shipper-company 201 POST /companies "$shipper_token" "$shipper_company_body"
shipper_company_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$shipper_company_id" ]]; then
  mark_fail "missing shipper company id"
  exit 1
fi
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'unverified' 'verificationStatus'

transporter_company_body="$(printf '{"type":"transporter","legalName":%s,"city":%s}' \
  "$(json_string "Off-platform Evidence Transporter $run_id")" "$(json_string 'Bulawayo')")"
api_call create-transporter-company 201 POST /companies "$transporter_token" "$transporter_company_body"
transporter_company_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$transporter_company_id" ]]; then
  mark_fail "missing transporter company id"
  exit 1
fi

api_call admin-login 200 POST /auth/login "" "$admin_login_body"
admin_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
admin_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$admin_token" || -z "$admin_user_id" ]]; then
  mark_fail "missing admin access token or user id"
  exit 1
fi

verify_company_body='{"verificationStatus":"verified"}'
api_call admin-verify-shipper-company 200 PATCH "/companies/$shipper_company_id" "$admin_token" "$verify_company_body"
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'verified' 'verificationStatus'

# 2. Baseline draft load before any ban.
load_body="$(printf '{"companyId":"%s","goodsType":"Fertiliser","weightKg":1000,"truckTypeRequired":"flatbed","pickupAddress":"Harare Depot","destinationAddress":"Bulawayo Warehouse","loadingDate":"2030-12-01","rateType":"negotiable","currency":"USD","pickupPoint":{"latitude":-17.8292,"longitude":31.0522},"destinationPoint":{"latitude":-20.15,"longitude":28.58}}' "$shipper_company_id")"
api_call create-draft-before-ban 201 POST /loads "$shipper_token" "$load_body"
draft_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$draft_id" ]]; then
  mark_fail "missing draft load id"
  exit 1
fi
check_json_value '.status' 'data["status"]' 'draft' 'loadStatus'

# 3. Write the local booking fixture consumed by DevFixtureBookingDirectory.
mkdir -p "$(dirname "$FIXTURES_FILE")"
cat > "$FIXTURES_FILE" <<JSON
[
  {
    "bookingId": "$booking_id",
    "loadId": "$draft_id",
    "status": "confirmed",
    "shipperCompanyId": "$shipper_company_id",
    "transporterCompanyId": "$transporter_company_id"
  }
]
JSON
add_note "fixture written for booking $booking_id"

# 4. Report alone must not ban.
report_body="$(printf '{"suspectedParty":"shipper","description":%s}' \
  "$(json_string 'Local evidence: suspected off-platform dealing on the confirmed booking.')")"
api_call file-off-platform-report 201 POST "/bookings/$booking_id/off-platform-reports" "$shipper_token" "$report_body"
report_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$report_id" ]]; then
  mark_fail "missing off-platform report id"
  exit 1
fi
check_json_value '.status' 'data["status"]' 'open' 'reportStatus'

api_call admin-list-bans-empty 200 GET /admin/off-platform-bans "$admin_token"
check_json_value '.data | length' 'len(data["data"])' '0' 'bans'

# 5. Non-admin cannot read the admin ban list.
api_call shipper-list-bans-forbidden 403 GET /admin/off-platform-bans "$shipper_token" "" "" FORBIDDEN

# 6. durationDays is refused; the valid confirmed finding applies one 14-day ban.
finding_party="$(printf '{"role":"shipper","userId":"%s","companyId":"%s"}' "$shipper_user_id" "$shipper_company_id")"
invalid_finding_body="$(printf '{"outcome":"confirmed","reason":%s,"responsibleParties":[%s],"durationDays":30}' \
  "$(json_string "$finding_reason")" "$finding_party")"
api_call admin-finding-with-duration 400 POST "/admin/off-platform-reports/$report_id/finding" "$admin_token" "$invalid_finding_body" "" VALIDATION_ERROR

valid_finding_body="$(printf '{"outcome":"confirmed","reason":%s,"responsibleParties":[%s]}' \
  "$(json_string "$finding_reason")" "$finding_party")"
api_call admin-finding-confirmed 201 POST "/admin/off-platform-reports/$report_id/finding" "$admin_token" "$valid_finding_body"
ban_id="$(json_value "$LAST_BODY_FILE" '.bans[0].id // empty' '(data.get("bans") or [{}])[0].get("id") or ""')"
check_json_value '.outcome' 'data["outcome"]' 'confirmed' 'findingOutcome'
check_json_value '.bans | length' 'len(data.get("bans") or [])' '1' 'bans'
check_json_value '.bans[0].durationDays' 'data["bans"][0]["durationDays"]' '14' 'durationDays'
check_json_value '.bans[0].status' 'data["bans"][0]["status"]' 'active' 'banStatus'
if [[ -z "$ban_id" ]]; then
  mark_fail "missing ban id"
  exit 1
fi

# 7. The ban blocks new work but leaves records and account status visible.
banned_load_body="$(printf '{"companyId":"%s","goodsType":"Banned attempt","weightKg":1000,"truckTypeRequired":"flatbed","pickupAddress":"Harare Depot","destinationAddress":"Bulawayo Warehouse","loadingDate":"2030-12-01","rateType":"negotiable","currency":"USD"}' "$shipper_company_id")"
api_call shipper-create-load-after-ban 409 POST /loads "$shipper_token" "$banned_load_body" "" ACCOUNT_BANNED
check_json_value '.details.bannedParty // empty' '((data.get("details") or {}).get("bannedParty") or "")' 'caller' 'bannedParty'

api_call shipper-post-draft-after-ban 409 POST "/loads/$draft_id/post" "$shipper_token" "" "" ACCOUNT_BANNED
api_call shipper-get-draft-after-ban 200 GET "/loads/$draft_id" "$shipper_token"
check_json_value '.status' 'data["status"]' 'draft' 'loadStatus'
api_call shipper-me-after-ban 200 GET /auth/me "$shipper_token"
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

# 8. Admin can see the report finding and the single active ban.
api_call admin-get-report-after-finding 200 GET "/admin/off-platform-reports/$report_id" "$admin_token"
check_json_value '.status' 'data["status"]' 'confirmed' 'reportStatus'
check_json_value '.finding.outcome' 'data["finding"]["outcome"]' 'confirmed' 'findingOutcome'
check_json_value '.finding.bans | length' 'len(data["finding"].get("bans") or [])' '1' 'findingBans'

api_call admin-list-active-bans 200 GET '/admin/off-platform-bans?status=active' "$admin_token"
check_json_value '.data | length' 'len(data["data"])' '1' 'activeBans'
check_json_value '.data[0].status' 'data["data"][0]["status"]' 'active' 'banStatus'

# 9. Lifting restores load creation; a second lift conflicts.
lift_body="$(printf '{"liftReason":%s}' "$(json_string "$lift_reason")")"
api_call admin-lift-ban 200 POST "/admin/off-platform-bans/$ban_id/lift" "$admin_token" "$lift_body"
check_json_value '.status' 'data["status"]' 'lifted' 'banStatus'

post_lift_load_body="$(printf '{"companyId":"%s","goodsType":"Post-lift load","weightKg":1000,"truckTypeRequired":"flatbed","pickupAddress":"Harare Depot","destinationAddress":"Bulawayo Warehouse","loadingDate":"2030-12-01","rateType":"negotiable","currency":"USD"}' "$shipper_company_id")"
api_call shipper-create-load-after-lift 201 POST /loads "$shipper_token" "$post_lift_load_body"
check_json_value '.status' 'data["status"]' 'draft' 'loadStatus'

api_call admin-lift-ban-again 409 POST "/admin/off-platform-bans/$ban_id/lift" "$admin_token" "$lift_body" "" BAN_NOT_ACTIVE

write_summary
printf 'wrote %s\n' "$OUT_DIR/summary.txt"
if ((failures > 0)); then
  echo "FAIL: $failures of $step_count steps failed" >&2
  exit 1
fi
echo "PASS: $step_count steps"
