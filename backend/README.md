# Truber backend (auth and loads)

NestJS service for the published API v0.2.0 slice: registration and login, refresh sessions, password reset, OTP account verification, companies, and shipper loads. PostgreSQL with PostGIS stores the data. Nothing in this service moves money or sends email or SMS.

The OpenAPI file at `../api/openapi.yaml` is the published contract (SHA-256 `38d7b49463edd707cd0da0eb6ad977af67fc67cfef539de8219a060a01073e8e`). This slice does not change that file.

## Implemented operations

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Shipper or transporter only. `admin` and any extra privilege field are rejected. Account starts `pending_verification`. Optional `city` is stored. |
| POST | `/auth/login` | Email and password. Unknown email and wrong password share one 401 body. |
| POST | `/auth/refresh` | Opaque refresh token, stored hashed, rotated. Replay and expiry return 401. Concurrent use of one token succeeds once. |
| GET | `/auth/me` | Current user. |
| POST | `/auth/password-reset/request` | Always the same 202 body. Per-source abuse returns a generic 429. |
| POST | `/auth/password-reset/confirm` | 30 minute single-use token, atomic consume. Success body has only `status` and `refreshSessionsInvalidated`. Failures use the pinned 401 body. Revokes every refresh session. Access JWTs stay valid until they expire. |
| POST | `/auth/otp/request` | Verification only. Response is `stubbed`. No session tokens. |
| POST | `/auth/otp/verify` | On success, `pending_verification` becomes `active`. Does not verify the company and does not log the user in. |
| GET, POST | `/companies` | Callers see their own companies. Create always starts `unverified`. |
| GET, PATCH | `/companies/{companyId}` | Non-members get 404. `verificationStatus` is admin-only. |
| GET, POST | `/loads` | Shippers see their own loads. Transporters see posted and later non-cancelled loads. Create is always `draft`. |
| GET, PATCH | `/loads/{loadId}` | Owner edit while `draft` or `posted`. |
| POST | `/loads/{loadId}/post` | Requires `accountStatus=active` and company `verificationStatus=verified`. |
| POST | `/loads/{loadId}/cancel` | Owner cancel while no confirmed booking state exists. |

Responses used by the tests are validated against the operation schemas in `api/openapi.yaml`.

## Not implemented

These routes are absent. They respond with 404 and the shared error body. They are not successful stubs.

- `POST /admin/users` — no HTTP path creates an admin. The only bootstrap is the non-production seed below.
- `GET` and `PATCH /users/{userId}` — not required for this slice. Account activation is OTP. Company verification is the admin company patch.
- Verification document list, upload, and admin review. The contract leaves multi-document completion rules open. Documents are not pretended to be approved.
- Trucks, quotations, bookings, payment arrangements, transactions, releases, refunds, deposit receipts, credit accounts, POD, delivery confirmation, ratings, dispute resolution.

Booking and payment rules are not implemented and are not functional: no confirmed arrangement, no confirmed booking, cash is not payment-protected, commission is not calculated, release is not recorded, and there is no Truber float. Fee payer and BuySafe behaviour are unchanged because those flows do not exist here.

## Verification path used by posting

`postLoad` requires an active account and a verified company.

1. Public registration cannot set `accountStatus`, `role=admin`, or `verificationStatus`.
2. `POST /auth/otp/verify` is the account transition. The contract says a successful OTP moves `accountStatus` out of `pending_verification` while company verification stays separate. `active` is the only non-penalty status that satisfies the post gate's account half, so OTP sets `active`. It does not verify the company.
3. An operator runs the seed command outside production. That inserts one `admin` row. It refuses `NODE_ENV=production`, a missing confirm string, and any attempt to escalate an existing shipper or transporter.
4. That admin calls `PATCH /companies/{companyId}` with `verificationStatus=verified`. A shipper who sends the same field receives 403 and the company stays unverified.

There is no public shortcut to a verified company.

## Local setup

Docker is the reproducible database setup:

```bash
docker compose -f backend/docker-compose.yml up -d db
```

The image is `postgis/postgis:16-3.4`. This environment had no Docker daemon, so the checks below used Ubuntu packages `postgresql-16` and `postgresql-16-postgis-3` instead. GitHub Actions uses the PostGIS image.

```bash
cd backend
cp .env.example .env
# set JWT_ACCESS_SECRET to a unique value of at least 32 characters
npm ci
npm run migrate
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

The API listens on `127.0.0.1:3000` unless `BIND_HOST` is changed. That address is the VM loopback, not a public URL.

Seed an admin only when you mean to:

```bash
cd backend
SEED_CONFIRM=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION \
SEED_ADMIN_PASSWORD='choose-a-local-password' \
npm run seed
```

The password is not stored in git. A second run does not reset it. The command will not turn an existing shipper or transporter into an admin.

## Delivery

`DELIVERY_ADAPTER=dev` writes password-reset tokens and OTP codes into `delivery_outbox`. No route reads that table, and the values are not returned or logged. `DELIVERY_ADAPTER=disabled` stores nothing retrievable and still returns the generic reset 202. The process refuses to boot when `NODE_ENV=production` and the adapter is `dev`. This service does not call an email or SMS provider.

Read a local dev token only from the database, for example:

```sql
SELECT kind, created_at FROM delivery_outbox ORDER BY created_at DESC;
```

Do not copy `payload` into tickets or logs.

## Configuration that the contract fixes

- Access JWT lifetime is 900 seconds. `expiresIn` is 900. Any other `JWT_ACCESS_TTL_SECONDS` prevents startup.
- Reset tokens live 1800 seconds. Any other `RESET_TOKEN_TTL_SECONDS` prevents startup.
- Passwords are hashed with scrypt (`N=16384`, `r=8`, `p=1`).
- Refresh sessions last 14 days unless `REFRESH_TTL_SECONDS` is set (minimum 1 hour, maximum 90 days). The contract does not set this.
- OTP codes last 10 minutes unless `OTP_TTL_SECONDS` is set. The contract does not set this.
- Register and reset passwords longer than 256 characters are rejected as an abuse limit, not as a product complexity policy.
- Emails are stored lowercase.
- `X-Forwarded-For` is not trusted. Rate limits use the socket address.

## Contract gaps recorded, not edited

- `RegisterRequest.city` is stored on the user row. The `User` schema has no `city`, so register, login, and `/auth/me` do not return it. Company `city` is returned.
- `listLoads` declares 200 and 401 only. Invalid list filters still return HTTP 400 with the shared `Error` schema.
- `createLoad` does not declare 422. Deadline order and currency mismatches use HTTP 400 and a specific `code`, which is a declared status for that operation.
- `UpdateLoadRequest` has no currency field, so currency is immutable after create.
- The post verification gate is applied only to `POST /loads/{loadId}/post`, which is the operation that states it. Patch of a draft or posted load does not add a second gate.
- Cancel reasons are stored in `loads.cancel_reason` and are not part of the `Load` response.
- No `/health` route was added, so the contract did not need a new path.

## Product rules left for later slices

No confirmed payment arrangement is created, so no confirmed booking is created. Cash is not marked payment-protected. The 5% completion commission is not calculated. Processing fees are not charged. Release is not recorded and is not automatic. The service holds no float.
