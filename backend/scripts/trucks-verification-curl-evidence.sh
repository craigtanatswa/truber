#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${OUT_DIR:?OUT_DIR is required}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@seed.truber.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required (the seeded admin password)}"
DOC_HOST="${DOC_HOST:-files.truber.local}"

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

if [[ "$DOC_HOST" == */* || "$DOC_HOST" == *:* ]]; then
  echo "refusing: DOC_HOST must be a bare hostname such as files.truber.local; got '$DOC_HOST'" >&2
  exit 2
fi

if [[ -n "${VERIFICATION_DOC_URI_HOSTS:-}" ]]; then
  doc_host_allowed=0
  IFS=',' read -ra allowed_doc_hosts <<< "$VERIFICATION_DOC_URI_HOSTS"
  for allowed_doc_host in "${allowed_doc_hosts[@]}"; do
    allowed_doc_host="$(printf '%s' "$allowed_doc_host" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    if [[ "$allowed_doc_host" == "${DOC_HOST,,}" ]]; then
      doc_host_allowed=1
    fi
  done
  if ((doc_host_allowed == 0)); then
    echo "refusing: DOC_HOST '$DOC_HOST' is not listed in VERIFICATION_DOC_URI_HOSTS" >&2
    exit 2
  fi
fi

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
    printf '# Trucks and verification HTTP evidence\n'
    printf 'base_url=%s\n' "$BASE_URL"
    printf 'database_host=%s\n' "$db_host"
    printf 'doc_host=%s\n' "$DOC_HOST"
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
transporter_a_email="trucks.transporter.a.${run_id}@example.com"
transporter_b_email="trucks.transporter.b.${run_id}@example.com"
shipper_email="trucks.shipper.${run_id}@example.com"
transporter_a_password="trucks-transporter-a-${run_id}-password"
transporter_b_password="trucks-transporter-b-${run_id}-password"
shipper_password="trucks-shipper-${run_id}-password"
truck_doc_uri="https://${DOC_HOST}/docs/$(new_uuid).pdf"
company_doc_uri="https://${DOC_HOST}/docs/$(new_uuid).pdf"
mime_doc_uri="https://${DOC_HOST}/docs/$(new_uuid).pdf"
idempotency_key="item5-evidence-${run_id}"

register_transporter_a_body="$(printf '{"email":%s,"password":%s,"fullName":%s,"city":%s,"role":"transporter"}' \
  "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")" \
  "$(json_string 'Trucks Evidence Transporter A')" "$(json_string 'Harare')")"
register_transporter_b_body="$(printf '{"email":%s,"password":%s,"fullName":%s,"city":%s,"role":"transporter"}' \
  "$(json_string "$transporter_b_email")" "$(json_string "$transporter_b_password")" \
  "$(json_string 'Trucks Evidence Transporter B')" "$(json_string 'Bulawayo')")"
register_shipper_body="$(printf '{"email":%s,"password":%s,"fullName":%s,"city":%s,"role":"shipper"}' \
  "$(json_string "$shipper_email")" "$(json_string "$shipper_password")" \
  "$(json_string 'Trucks Evidence Shipper')" "$(json_string 'Harare')")"
admin_login_body="$(printf '{"email":%s,"password":%s}' \
  "$(json_string "$ADMIN_EMAIL")" "$(json_string "$ADMIN_PASSWORD")")"

# 1. Accounts, OTP activation for A and the shipper, and admin login later.
api_call register-transporter-a 201 POST /auth/register "" "$register_transporter_a_body"
transporter_a_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
transporter_a_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$transporter_a_token" || -z "$transporter_a_user_id" ]]; then
  mark_fail "missing transporter A access token or user id"
  exit 1
fi
check_json_value '.user.accountStatus' 'data["user"]["accountStatus"]' 'pending_verification' 'accountStatus'

api_call register-transporter-b 201 POST /auth/register "" "$register_transporter_b_body"
transporter_b_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
transporter_b_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$transporter_b_token" || -z "$transporter_b_user_id" ]]; then
  mark_fail "missing transporter B access token or user id"
  exit 1
fi

api_call register-shipper 201 POST /auth/register "" "$register_shipper_body"
shipper_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
shipper_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$shipper_token" || -z "$shipper_user_id" ]]; then
  mark_fail "missing shipper access token or user id"
  exit 1
fi

api_call otp-request-transporter-a 202 POST /auth/otp/request "$transporter_a_token" '{"channel":"email"}'
transporter_a_otp="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT payload FROM delivery_outbox WHERE kind = 'otp' AND user_id = '$transporter_a_user_id' ORDER BY created_at DESC LIMIT 1")"
transporter_a_otp="$(printf '%s' "$transporter_a_otp" | tr -d '[:space:]')"
if [[ -z "$transporter_a_otp" ]]; then
  mark_fail "no OTP code found in delivery_outbox for transporter A"
  exit 1
fi
add_note "transporter A OTP read from delivery_outbox"
transporter_a_otp_body="$(printf '{"code":%s}' "$(json_string "$transporter_a_otp")")"
api_call otp-verify-transporter-a 200 POST /auth/otp/verify "$transporter_a_token" "$transporter_a_otp_body"
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

api_call otp-request-shipper 202 POST /auth/otp/request "$shipper_token" '{"channel":"email"}'
shipper_otp="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT payload FROM delivery_outbox WHERE kind = 'otp' AND user_id = '$shipper_user_id' ORDER BY created_at DESC LIMIT 1")"
shipper_otp="$(printf '%s' "$shipper_otp" | tr -d '[:space:]')"
if [[ -z "$shipper_otp" ]]; then
  mark_fail "no OTP code found in delivery_outbox for shipper"
  exit 1
fi
add_note "shipper OTP read from delivery_outbox"
shipper_otp_body="$(printf '{"code":%s}' "$(json_string "$shipper_otp")")"
api_call otp-verify-shipper 200 POST /auth/otp/verify "$shipper_token" "$shipper_otp_body"
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

# 2. Transporters create their own companies.
transporter_company_a_body="$(printf '{"type":"transporter","legalName":%s,"city":%s}' \
  "$(json_string "Trucks Evidence Transporter A $run_id")" "$(json_string 'Harare')")"
api_call create-transporter-company-a 201 POST /companies "$transporter_a_token" "$transporter_company_a_body"
transporter_company_a_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$transporter_company_a_id" ]]; then
  mark_fail "missing transporter A company id"
  exit 1
fi
check_json_value '.type' 'data["type"]' 'transporter' 'companyType'
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'unverified' 'verificationStatus'

transporter_company_b_body="$(printf '{"type":"transporter","legalName":%s,"city":%s}' \
  "$(json_string "Trucks Evidence Transporter B $run_id")" "$(json_string 'Bulawayo')")"
api_call create-transporter-company-b 201 POST /companies "$transporter_b_token" "$transporter_company_b_body"
transporter_company_b_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$transporter_company_b_id" ]]; then
  mark_fail "missing transporter B company id"
  exit 1
fi
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'unverified' 'verificationStatus'

# 3. Registration numbers are normalised and duplicates conflict across variants.
create_truck_body="$(printf '{"companyId":"%s","registrationNumber":"aez 12-34","truckType":"flatbed","capacityKg":30000}' \
  "$transporter_company_a_id")"
api_call create-truck-a 201 POST /trucks "$transporter_a_token" "$create_truck_body"
truck_a_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$truck_a_id" ]]; then
  mark_fail "missing truck id"
  exit 1
fi
check_json_value '.companyId' 'data["companyId"]' "$transporter_company_a_id" 'companyId'
check_json_value '.registrationNumber' 'data["registrationNumber"]' 'AEZ1234' 'registrationNumber'
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'unverified' 'verificationStatus'

duplicate_truck_body="$(printf '{"companyId":"%s","registrationNumber":"AEZ-1234","truckType":"flatbed","capacityKg":30000}' \
  "$transporter_company_a_id")"
api_call create-truck-duplicate 409 POST /trucks "$transporter_a_token" "$duplicate_truck_body" "" TRUCK_REGISTRATION_EXISTS

# 4. Creation and reads are scoped to the owning transporter company.
shipper_truck_body="$(printf '{"companyId":"%s","registrationNumber":"SHIPPER1","truckType":"flatbed","capacityKg":10000}' \
  "$transporter_company_a_id")"
api_call shipper-create-truck 403 POST /trucks "$shipper_token" "$shipper_truck_body" "" FORBIDDEN

api_call transporter-b-get-truck-a 404 GET "/trucks/$truck_a_id" "$transporter_b_token" "" "" NOT_FOUND
api_call shipper-get-unverified-truck-a 404 GET "/trucks/$truck_a_id" "$shipper_token" "" "" NOT_FOUND

# 5. Document links, pending transitions, and strict upload validation.
truck_doc_body="$(printf '{"documentType":"vehicle_registration","documentUri":%s,"truckId":"%s"}' \
  "$(json_string "$truck_doc_uri")" "$truck_a_id")"
api_call upload-truck-document 201 POST /verification-documents "$transporter_a_token" "$truck_doc_body"
truck_doc_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$truck_doc_id" ]]; then
  mark_fail "missing truck verification document id"
  exit 1
fi
check_json_value '.companyId' 'data["companyId"]' "$transporter_company_a_id" 'companyId'
check_json_value '.truckId' 'data["truckId"]' "$truck_a_id" 'truckId'
check_json_value '.documentType' 'data["documentType"]' 'vehicle_registration' 'documentType'
check_json_value '.documentUri' 'data["documentUri"]' "$truck_doc_uri" 'documentUri'
check_json_value '.status' 'data["status"]' 'submitted' 'documentStatus'

api_call get-truck-after-document-upload 200 GET "/trucks/$truck_a_id" "$transporter_a_token"
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'pending' 'verificationStatus'

company_doc_body="$(printf '{"documentType":"company_registration","documentUri":%s,"companyId":"%s"}' \
  "$(json_string "$company_doc_uri")" "$transporter_company_a_id")"
api_call upload-company-document 201 POST /verification-documents "$transporter_a_token" "$company_doc_body"
company_doc_id="$(json_value "$LAST_BODY_FILE" '.id' 'data["id"]')"
if [[ -z "$company_doc_id" ]]; then
  mark_fail "missing company verification document id"
  exit 1
fi
check_json_value '.companyId' 'data["companyId"]' "$transporter_company_a_id" 'companyId'
check_json_value '.documentType' 'data["documentType"]' 'company_registration' 'documentType'
check_json_value '.status' 'data["status"]' 'submitted' 'documentStatus'

evil_doc_body="$(printf '{"documentType":"other","documentUri":"https://evil.example/x.pdf","companyId":"%s"}' \
  "$transporter_company_a_id")"
api_call upload-document-evil-host 400 POST /verification-documents "$transporter_a_token" "$evil_doc_body" "" DOCUMENT_URI_NOT_ALLOWED

mime_doc_body="$(printf '{"documentType":"other","documentUri":%s,"companyId":"%s","mimeType":"application/pdf"}' \
  "$(json_string "$mime_doc_uri")" "$transporter_company_a_id")"
api_call upload-document-mime-type 400 POST /verification-documents "$transporter_a_token" "$mime_doc_body" "" VALIDATION_ERROR

# 6. Another transporter cannot list the owning company's documents.
api_call transporter-b-list-company-a-documents 403 GET "/verification-documents?companyId=$transporter_company_a_id" "$transporter_b_token" "" "" FORBIDDEN

# 7. Admin sees both submitted documents; a transporter cannot review.
api_call admin-login 200 POST /auth/login "" "$admin_login_body"
admin_token="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
admin_user_id="$(json_value "$LAST_BODY_FILE" '.user.id' 'data["user"]["id"]')"
if [[ -z "$admin_token" || -z "$admin_user_id" ]]; then
  mark_fail "missing admin access token or user id"
  exit 1
fi
check_json_value '.user.role' 'data["user"]["role"]' 'admin' 'role'

api_call admin-list-verification-documents 200 GET /verification-documents "$admin_token"
check_json_value '.data | length' 'len(data["data"])' '2' 'documents'

api_call transporter-a-review-document 403 POST "/admin/verification-documents/$truck_doc_id/review" "$transporter_a_token" '{"decision":"approved","setTruckVerified":true}' "" FORBIDDEN

# 8. Reviews are idempotent and documents cannot be reviewed twice.
review_truck_body='{"decision":"approved","setTruckVerified":true}'
api_call admin-review-truck-document 200 POST "/admin/verification-documents/$truck_doc_id/review" "$admin_token" "$review_truck_body" "Idempotency-Key: $idempotency_key"
check_json_value '.id' 'data["id"]' "$truck_doc_id" 'documentId'
check_json_value '.status' 'data["status"]' 'approved' 'documentStatus'

api_call admin-review-truck-document-replay 200 POST "/admin/verification-documents/$truck_doc_id/review" "$admin_token" "$review_truck_body" "Idempotency-Key: $idempotency_key"
check_json_value '.id' 'data["id"]' "$truck_doc_id" 'documentId'
check_json_value '.status' 'data["status"]' 'approved' 'documentStatus'

api_call admin-review-truck-document-again 409 POST "/admin/verification-documents/$truck_doc_id/review" "$admin_token" "$review_truck_body" "Idempotency-Key: ${idempotency_key}-again" DOCUMENT_ALREADY_REVIEWED

review_company_body='{"decision":"approved","setCompanyVerified":true}'
api_call admin-review-company-document 200 POST "/admin/verification-documents/$company_doc_id/review" "$admin_token" "$review_company_body"
check_json_value '.id' 'data["id"]' "$company_doc_id" 'documentId'
check_json_value '.status' 'data["status"]' 'approved' 'documentStatus'

# 9. Verified visibility for the owner, shippers, and unrelated transporters.
api_call transporter-a-get-verified-truck 200 GET "/trucks/$truck_a_id" "$transporter_a_token"
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'verified' 'verificationStatus'

api_call shipper-get-verified-truck 200 GET "/trucks/$truck_a_id" "$shipper_token"
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'verified' 'verificationStatus'

api_call shipper-list-trucks 200 GET /trucks "$shipper_token"
check_json_value '.data | length' 'len(data["data"])' '1' 'trucks'

api_call transporter-b-list-trucks 200 GET /trucks "$transporter_b_token"
check_json_value '.data | length' 'len(data["data"])' '0' 'trucks'

# 10. Identity edits return a verified truck to pending; only admins set verification.
api_call transporter-a-update-truck-capacity 200 PATCH "/trucks/$truck_a_id" "$transporter_a_token" '{"capacityKg":28000}'
check_json_value '.capacityKg' 'data["capacityKg"]' '28000' 'capacityKg'
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'pending' 'verificationStatus'

api_call admin-verify-truck 200 PATCH "/trucks/$truck_a_id" "$admin_token" '{"verificationStatus":"verified"}'
check_json_value '.verificationStatus' 'data["verificationStatus"]' 'verified' 'verificationStatus'

api_call transporter-a-set-truck-verification 403 PATCH "/trucks/$truck_a_id" "$transporter_a_token" '{"verificationStatus":"verified"}' "" VERIFICATION_ADMIN_ONLY

# 11. User reads and the admin-only account status boundary.
api_call transporter-a-get-own-user 200 GET "/users/$transporter_a_user_id" "$transporter_a_token"
check_json_value '.id' 'data["id"]' "$transporter_a_user_id" 'userId'
check_json_value '.bannedUntil // empty' 'data.get("bannedUntil") or ""' '' 'bannedUntil'

api_call transporter-b-get-transporter-a-user 403 GET "/users/$transporter_a_user_id" "$transporter_b_token" "" "" FORBIDDEN

api_call admin-get-transporter-a-user 200 GET "/users/$transporter_a_user_id" "$admin_token"
check_json_value '.id' 'data["id"]' "$transporter_a_user_id" 'userId'
check_json_value '.bannedUntil // empty' 'data.get("bannedUntil") or ""' '' 'bannedUntil'

api_call transporter-a-set-own-account-status 403 PATCH "/users/$transporter_a_user_id" "$transporter_a_token" '{"accountStatus":"suspended"}' "" ACCOUNT_STATUS_ADMIN_ONLY

api_call admin-set-own-account-status 403 PATCH "/users/$admin_user_id" "$admin_token" '{"accountStatus":"suspended"}' "" ADMIN_STATUS_CHANGE_FORBIDDEN

# 12. Suspension revokes sessions, blocks all access paths, and is audited once.
api_call transporter-a-login-before-suspension 200 POST /auth/login "" "$(printf '{"email":%s,"password":%s}' "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")")"
transporter_a_access_token_2="$(json_value "$LAST_BODY_FILE" '.accessToken' 'data["accessToken"]')"
transporter_a_refresh_token_2="$(json_value "$LAST_BODY_FILE" '.refreshToken' 'data["refreshToken"]')"
if [[ -z "$transporter_a_access_token_2" || -z "$transporter_a_refresh_token_2" ]]; then
  mark_fail "missing transporter A second access or refresh token"
  exit 1
fi
check_json_value '.user.accountStatus' 'data["user"]["accountStatus"]' 'active' 'accountStatus'

api_call admin-suspend-transporter-a 200 PATCH "/users/$transporter_a_user_id" "$admin_token" '{"accountStatus":"suspended"}'
check_json_value '.accountStatus' 'data["accountStatus"]' 'suspended' 'accountStatus'

api_call suspended-access-list-trucks 403 GET /trucks "$transporter_a_access_token_2" "" "" ACCOUNT_NOT_PERMITTED
api_call suspended-access-get-me 403 GET /auth/me "$transporter_a_access_token_2" "" "" ACCOUNT_NOT_PERMITTED
api_call suspended-login 403 POST /auth/login "" "$(printf '{"email":%s,"password":%s}' "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")")" "" ACCOUNT_SUSPENDED

transporter_a_refresh_body="$(printf '{"refreshToken":%s}' "$(json_string "$transporter_a_refresh_token_2")")"
api_call refresh-after-suspension 401 POST /auth/refresh "" "$transporter_a_refresh_body" "" UNAUTHORIZED

status_change_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT count(*) FROM account_status_changes WHERE user_id = '$transporter_a_user_id'")"
status_change_count="$(printf '%s' "$status_change_count" | tr -d '[:space:]')"
if [[ "$status_change_count" == "1" ]]; then
  add_note "account_status_changes=$status_change_count"
else
  mark_fail "account_status_changes expected 1 actual ${status_change_count:-<none>}"
fi

# 13. Reactivation does not revive the revoked refresh token.
api_call admin-reactivate-transporter-a 200 PATCH "/users/$transporter_a_user_id" "$admin_token" '{"accountStatus":"active"}'
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

api_call transporter-a-login-after-reactivation 200 POST /auth/login "" "$(printf '{"email":%s,"password":%s}' "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")")"
check_json_value '.user.accountStatus' 'data["user"]["accountStatus"]' 'active' 'accountStatus'

api_call transporter-a-list-trucks-after-reactivation 200 GET /trucks "$transporter_a_token"
check_json_value '.data | length' 'len(data["data"])' '1' 'trucks'

api_call refresh-old-token-after-reactivation 401 POST /auth/refresh "" "$transporter_a_refresh_body" "" UNAUTHORIZED

# 14. Disabled accounts are blocked and can be brought back to active.
api_call admin-disable-transporter-a 200 PATCH "/users/$transporter_a_user_id" "$admin_token" '{"accountStatus":"disabled"}'
check_json_value '.accountStatus' 'data["accountStatus"]' 'disabled' 'accountStatus'

api_call disabled-login 403 POST /auth/login "" "$(printf '{"email":%s,"password":%s}' "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")")" "" ACCOUNT_DISABLED

api_call admin-reactivate-disabled-transporter-a 200 PATCH "/users/$transporter_a_user_id" "$admin_token" '{"accountStatus":"active"}'
check_json_value '.accountStatus' 'data["accountStatus"]' 'active' 'accountStatus'

api_call transporter-a-login-after-disabled-reactivation 200 POST /auth/login "" "$(printf '{"email":%s,"password":%s}' "$(json_string "$transporter_a_email")" "$(json_string "$transporter_a_password")")"
check_json_value '.user.accountStatus' 'data["user"]["accountStatus"]' 'active' 'accountStatus'

write_summary
printf 'wrote %s\n' "$OUT_DIR/summary.txt"
if ((failures > 0)); then
  echo "FAIL: $failures of $step_count steps failed" >&2
  exit 1
fi
echo "PASS: $step_count steps"
