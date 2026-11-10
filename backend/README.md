# Truber backend (auth, companies, loads, billing)

NestJS service for the published API v0.4.0 slice: registration and login, refresh sessions, password reset, OTP account verification, companies, shipper loads, and billing slice 1 (commission receivables and collections). PostgreSQL with PostGIS stores the data. Nothing in this service moves money or sends email or SMS.

The OpenAPI file at `../api/openapi.yaml` is the published contract (SHA-256 `7f44d228ba8129398a9d2790e3e08770efbfed381fab7be391bef592f38221f4`, v0.4.0). This slice does not change that file.

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
| GET | `/companies/{companyId}/commission-account` | Members and admins; non-members get 404. `outstandingByCurrency` is the per-currency sum of `remainingAmount` on `open` receivables, `[]` when nothing is owed. `outstandingAmount` is present only when exactly one currency is owed. |
| POST | `/admin/companies/{companyId}/commission-collections` | Admin only, transporter companies, `Idempotency-Key` required. Replay returns the original 201; a different body with the same key is 409. Applied oldest-first in that currency only; over-collection is 409 `COLLECTION_EXCEEDS_OUTSTANDING`. Records only, `fundsMovementClaimedByTruber: false`. |

Responses used by the tests are validated against the operation schemas in `api/openapi.yaml`.

## Billing (slice 1)

- Code: `src/billing/money.ts`, `commission.ts` (pure), `receivables.service.ts`, `commission-gate.service.ts`, `payment-provider.ts`, `billing.controller.ts`; migration `migrations/002_billing.sql` (`payment_arrangements`, `payment_records`, `commission_receivables`, `commission_collections`, `commission_collection_allocations`, `payouts`). `booking_id` has no foreign key until bookings land.
- Money rules: integer minor units plus ISO 4217 currency; mixed currency is 409 `CURRENCY_MISMATCH`. Commission is 5% (500 bps) rounded half-up with BigInt, calculated by the server, and recognised at trip completion. Voiding the completion voids its receivable. Net = trip − commission − recorded fees; 409 `NET_PAYOUT_NEGATIVE` when negative and `FEE_TOTAL_MISMATCH` when the typed fee total differs. The transporter pays fees out of the payout.
- Payment methods: cash is a receivable only. It has no fare payout, is never payment-protected, and is not settled by a release. Corporate credit payout is blocked until the shipper payment is recorded (`CREDIT_PAYMENT_NOT_RECORDED`). The unreceipted `deposit_balance` remainder is not payable (`BALANCE_NOT_RECEIPTED`). Prepay and escrow pay out only once shipper funds are recorded (`FUNDS_NOT_RECEIVED`). Truber never lends. No confirmed arrangement means no confirmed booking (`assertBookingConfirmable`, domain only).
- Zero commission (trips under 10 minor units) is recorded as `collected` with 0, so it never blocks.
- Gate: `CommissionGateService.assertCanTakeNewWork(companyId, client?)` throws the pinned 409 `CommissionOutstandingError` (`COMMISSION_OUTSTANDING`, message "Outstanding commission must be settled before taking new work."). Single-currency details carry `outstandingAmount` and a one-entry `outstandingByCurrency`; multi-currency details carry only `outstandingByCurrency`. The gate is not currency-scoped and has no override. Quotation and booking handlers (not built yet; owned by Mark and Brian) must call the `ACCOUNT_BANNED` guard first, then this. No HTTP route exposes the gate in this slice. Tests prove the wire body through `ApiExceptionFilter` against the createQuotation/acceptQuotation/confirmBooking 409 schemas.
- Providers: `PaymentProvider` interface and `NoopPaymentProvider` only. Paynow, EcoCash, and InnBucks are candidates, not integrations. No network calls and no real money.
- Local DB used for this slice: `DATABASE_URL=postgres://truber:truber@127.0.0.1:5435/truber_test npm test` (a separate local cluster; pick any free port).

## Not implemented

These routes are absent. They respond with 404 and the shared error body. They are not successful stubs.

- `POST /admin/users` — no HTTP path creates an admin. The only bootstrap is the non-production seed below.
- `GET` and `PATCH /users/{userId}` — not required for this slice. Account activation is OTP. Company verification is the admin company patch.
- Verification document list, upload, and admin review. The contract leaves multi-document completion rules open. Documents are not pretended to be approved.
- Trucks, quotations, bookings, POD, delivery confirmation, ratings, dispute resolution, and off-platform safeguards are absent.
- These billing operations are absent too: `listPaymentArrangements`, `createPaymentArrangement`, `getPaymentArrangement`, `confirmPaymentArrangement`, `recordProtectionEvidence`, `listPaymentTransactions`, `recordPaymentTransaction`, `recordPaymentRelease`, `recordDepositReceipt`, `recordPaymentRefund`, `getCompanyCreditAccount`, and `upsertCompanyCreditAccount`. The arrangement and transaction operations need booking rows. Credit accounts are outside slice 1.

Booking flows are not implemented: no confirmed arrangement is created, so no confirmed booking is created. Cash is not marked payment-protected, release is not recorded, and the service holds no float. Commission is calculated in the domain and recorded as receivables, but no booking flow calls it yet. Fee payer and BuySafe behaviour are unchanged because those flows do not exist here.

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

PostGIS version note: the compose file pins PostGIS 3.4. PGDG no longer ships a 3.4 build for PostgreSQL 16 on Debian trixie, so the local checks for API v0.4.0 ran on PostgreSQL 16.15 with PostGIS 3.7.0. The schema and tests only use basic `geography(Point,4326)` columns and casts.

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

`npm start` does not apply migrations. Run `npm run migrate` first. The migrate command is also what installs PostGIS into `POSTGIS_SCHEMA` and applies schema grants. It refuses to move PostGIS if it is already installed in a different schema.

Two local checks:

```bash
npm test
npm run test:supabase-like
```

`npm test` uses the existing local layout (`DB_SCHEMA=public`, `POSTGIS_SCHEMA=public`). `npm run test:supabase-like` creates a second local database, installs PostGIS in schema `gis`, and runs the API as a non-superuser role against schema `truber`. That second command is still local. It does not connect to Supabase.

Hosted Supabase setup is documented in [docs/supabase-postgres.md](docs/supabase-postgres.md). Compatibility code is in this tree. No hosted database has been migrated or contacted by the API.

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

- Access JWT lifetime is 1800 seconds (30 minutes). `expiresIn` is 1800, per API v0.4.0. Any other `JWT_ACCESS_TTL_SECONDS` prevents startup.
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
- `CommissionReceivable` with `amount` 0 (trip under 10 minor units) has no defined status; this service uses `collected`.
- `recordCommissionCollection` declares `Idempotency-Key` optional; the server requires it for this money record.
- `outstandingAmount` on `CommissionAccount` is omitted (not null) when not exactly one currency is owed.
- A void after collection keeps `collectedAmount`. The contract does not say whether collected commission is refunded to the transporter, and this service does not refund.

## Product rules left for later slices

No confirmed payment arrangement is created, so no confirmed booking is created. Cash is not marked payment-protected. Commission is calculated in the domain and recorded as receivables, but no booking flow calls it yet. Processing fees are not charged. Release is not recorded and is not automatic. The service holds no float.
