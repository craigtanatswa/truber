#!/usr/bin/env python3
"""Exercise the local auth and loads API and write a redacted HTTP log.

Tokens, passwords, reset tokens, and OTP codes are replaced before the log is written.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
OUT = Path(os.environ.get("CURL_LOG", "/opt/cursor/artifacts/curl-evidence.log"))
DATABASE_URL = os.environ["DATABASE_URL"]

SECRET_KEYS = {
    "accessToken",
    "refreshToken",
    "password",
    "newPassword",
    "token",
    "payload",
    "authorization",
    "password_hash",
}


def redact(value):
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        cleaned = {}
        for key, inner in value.items():
            if key == "code" and isinstance(inner, str) and re.fullmatch(r"\d{4,12}", inner):
                cleaned[key] = "[redacted]"
            elif key in SECRET_KEYS:
                cleaned[key] = "[redacted]"
            else:
                cleaned[key] = redact(inner)
        return cleaned
    if isinstance(value, str):
        value = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", value)
        value = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[redacted-jwt]", value)
        return value
    return value


def request(method: str, path: str, body=None, token: str | None = None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req_headers = {"Accept": "application/json"}
    if body is not None:
        req_headers["Content-Type"] = "application/json"
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    if headers:
        req_headers.update(headers)
    request_obj = urllib.request.Request(BASE + path, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            raw = response.read().decode()
            parsed = json.loads(raw) if raw else None
            return response.status, parsed, dict(response.headers)
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        parsed = json.loads(raw) if raw else None
        return error.code, parsed, dict(error.headers)


def psql_value(sql: str) -> str:
    completed = subprocess.run(
        ["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def main() -> None:
    lines: list[str] = []

    def record(title: str, method: str, path: str, body=None, token: str | None = None, headers=None):
        status, payload, response_headers = request(method, path, body, token, headers)
        safe_body = None if body is None else redact(body)
        header_note = "Authorization: Bearer [redacted]" if token else "no Authorization header"
        extra = ""
        if headers and "Idempotency-Key" in headers:
            extra = f" Idempotency-Key: {headers['Idempotency-Key']}"
        lines.append(f"===== {title} =====")
        lines.append(f"curl -sS -D - -X {method} {BASE}{path} ({header_note}{extra})")
        if safe_body is not None:
            lines.append("request: " + json.dumps(safe_body, sort_keys=True))
        lines.append(f"HTTP {status}")
        if response_headers.get("X-Request-Id") or response_headers.get("x-request-id"):
            lines.append("X-Request-Id: present")
        lines.append(json.dumps(redact(payload), indent=2, sort_keys=True))
        lines.append("")
        return status, payload

    lines.append(f"base_url={BASE}")
    lines.append("reachability=VM loopback only; not a public URL")
    lines.append("health_endpoint=not present; omitted so the published contract stayed unchanged")
    lines.append("")

    suffix = datetime.now(timezone.utc).strftime("%H%M%S")
    shipper_email = f"curl.shipper.{suffix}@example.com"
    missing_email = f"curl.missing.{suffix}@example.com"
    shipper_password = f"curl-shipper-{suffix}-password"
    admin_password = f"curl-seed-{suffix}-password"
    record("unauthenticated me", "GET", "/auth/me")
    record("register admin rejected", "POST", "/auth/register", {
        "email": f"curl.admin.{suffix}@example.com",
        "password": admin_password,
        "fullName": "No Admin",
        "role": "admin",
    })
    status, registered = record("register shipper with city", "POST", "/auth/register", {
        "email": shipper_email,
        "password": shipper_password,
        "fullName": "Curl Shipper",
        "city": "Harare",
        "role": "shipper",
    })
    if status != 201:
        raise SystemExit(f"register failed: {status}")
    token = registered["accessToken"]
    record("login wrong password", "POST", "/auth/login", {
        "email": shipper_email,
        "password": "wrong-password",
    })
    record("login unknown email", "POST", "/auth/login", {
        "email": missing_email,
        "password": "wrong-password",
    })
    status, session = record("login", "POST", "/auth/login", {
        "email": shipper_email,
        "password": shipper_password,
    })
    token = session["accessToken"]
    record("me", "GET", "/auth/me", token=token)
    status, company = record("create company", "POST", "/companies", {
        "type": "shipper",
        "legalName": "Curl Grain",
        "city": "Harare",
    }, token=token)
    company_id = company["id"]
    record("self-verify company rejected", "PATCH", f"/companies/{company_id}", {
        "verificationStatus": "verified",
    }, token=token)
    status, load = record("create draft load", "POST", "/loads", {
        "companyId": company_id,
        "goodsType": "Fertiliser",
        "weightKg": 1000,
        "truckTypeRequired": "flatbed",
        "pickupAddress": "Harare Depot",
        "destinationAddress": "Bulawayo Warehouse",
        "loadingDate": "2026-12-01",
        "rateType": "negotiable",
        "currency": "USD",
        "pickupPoint": {"latitude": -17.8292, "longitude": 31.0522},
        "destinationPoint": {"latitude": -20.15, "longitude": 28.58},
    }, token=token)
    load_id = load["id"]
    record("post before verification", "POST", f"/loads/{load_id}/post", token=token)
    record("otp request", "POST", "/auth/otp/request", {"channel": "email"}, token=token)
    code = psql_value(
        "SELECT payload FROM delivery_outbox WHERE kind = 'otp' ORDER BY created_at DESC LIMIT 1"
    )
    record("otp verify", "POST", "/auth/otp/verify", {"code": code}, token=token)
    record("post still blocked on company", "POST", f"/loads/{load_id}/post", token=token)

    admin_email = f"curl-admin-{suffix}@seed.truber.local"
    env = os.environ.copy()
    env.update({
        "NODE_ENV": "development",
        "SEED_CONFIRM": "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION",
        "SEED_ADMIN_EMAIL": admin_email,
        "SEED_ADMIN_PASSWORD": admin_password,
        "DATABASE_URL": DATABASE_URL,
        "JWT_ACCESS_SECRET": env["JWT_ACCESS_SECRET"],
        "DELIVERY_ADAPTER": "dev",
    })
    seed = subprocess.run(["node", "dist/seed/seed-dev.js"], cwd="/workspace/backend", env=env, check=True, capture_output=True, text=True)
    lines.append("===== seed admin =====")
    lines.append("command: SEED_CONFIRM set; SEED_ADMIN_PASSWORD [redacted]; node dist/seed/seed-dev.js")
    lines.append(seed.stdout.strip())
    lines.append("")
    status, admin = record("admin login", "POST", "/auth/login", {
        "email": admin_email,
        "password": admin_password,
    })
    admin_token = admin["accessToken"]
    record("admin verifies company", "PATCH", f"/companies/{company_id}", {
        "verificationStatus": "verified",
    }, token=admin_token)
    record("post load", "POST", f"/loads/{load_id}/post", token=token, headers={"Idempotency-Key": "curl-post-fertiliser"})
    record("list posted flatbed", "GET", "/loads?status=posted&truckTypeRequired=flatbed&pickupText=harare", token=token)
    record("patch load", "PATCH", f"/loads/{load_id}", {"specialRequirements": "Keep dry"}, token=token)
    record("cancel load", "POST", f"/loads/{load_id}/cancel", {"reason": "Curl evidence finished"}, token=token)
    record("get cancelled load", "GET", f"/loads/{load_id}", token=token)
    record("bookings absent", "GET", "/bookings", token=token)
    record("reset request", "POST", "/auth/password-reset/request", {"email": shipper_email})
    record("reset request unknown", "POST", "/auth/password-reset/request", {"email": missing_email})
    wkt = psql_value(f"SELECT ST_AsText(pickup_geog::geometry) FROM loads WHERE id = '{load_id}'")
    postgis = psql_value("SELECT PostGIS_Version()")
    lines.append("===== database =====")
    lines.append(f"postgis={postgis}")
    lines.append(f"pickup_wkt={wkt}")
    lines.append("")

    text = "\n".join(lines)
    leaked = [secret for secret in (shipper_password, admin_password, code) if secret and secret in text]
    if leaked:
        raise SystemExit("refusing to write a log that still contains a secret")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
