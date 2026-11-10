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
| GET | `/companies/{companyId}/commission-account` | Members and admins; non-members and non-transporter companies get 404. `outstandingByCurrency` is the per-currency sum of `remainingAmount` on `open` receivables, `[]` when nothing is owed. `outstandingAmount` is present only when exactly one currency is owed. |
| POST | `/admin/companies/{companyId}/commission-collections` | Admin only, transporter companies, `Idempotency-Key` required. Replay returns the original 201; a different body with the same key is 409. Applied oldest-first in that currency only; over-collection is 409 `COLLECTION_EXCEEDS_OUTSTANDING`. Records only, `fundsMovementClaimedByTruber: false`. |

Responses used by the tests are validated against the operation schemas in `api/openapi.yaml`.

## Billing (slice 1)

- Code: `src/billing/money.ts`, `commission.ts` (pure), `receivables.service.ts`, `commission-gate.service.ts`, `payment-provider.ts`, `billing.controller.ts`; migration `migrations/002_billing.sql` (`payment_arrangements`, `payment_records`, `commission_receivables`, `commission_collections`, `commission_collection_allocations`, `payouts`). `booking_id` has no foreign key until bookings land.
- Money rules: integer minor units plus ISO 4217 currency; mixed currency is 409 `CURRENCY_MISMATCH`. Commission is 5% (500 bps) rounded half-up with BigInt, calculated by the server, and recognised at trip completion. Voiding the completion voids its receivable. Net = trip − commission − recorded fees; 409 `NET_PAYOUT_NEGATIVE` when negative and `FEE_TOTAL_MISMATCH` when the typed fee total differs. The transporter pays fees out of the payout.
- Payment methods: cash is a receivable only. It has no fare payout, is never payment-protected, and is not settled by a release. Corporate credit payout is blocked until the shipper payment is recorded (`CREDIT_PAYMENT_NOT_RECORDED`). The unreceipted `deposit_balance` remainder is not payable (`BALANCE_NOT_RECEIPTED`). Prepay and escrow pay out only once shipper funds are recorded (`FUNDS_NOT_RECEIVED`). Truber never lends. No confirmed arrangement means no confirmed booking (`assertBookingConfirmable`, domain only).
- Zero commission (trips under 10 minor units) is recorded as `collected` with 0, so it never blocks.
- Gate: `CommissionGateService.assertCanTakeNewWork(client, companyId)` throws the pinned 409 `CommissionOutstandingError` (`COMMISSION_OUTSTANDING`, message "Outstanding commission must be settled before taking new work."). Single-currency details carry `outstandingAmount` and a one-entry `outstandingByCurrency`; multi-currency details carry only `outstandingByCurrency`. The gate is not currency-scoped and has no override. It takes a shared per-company advisory lock and `recognise` takes the exclusive one, so the gate and recognition for the same company serialize; the caller must pass its transaction client. Quotation and booking handlers (not built yet; owned by Mark and Brian) must call the `ACCOUNT_BANNED` guard first, then this. No HTTP route exposes the gate in this slice. Tests prove the wire body through `ApiExceptionFilter` against the createQuotation/acceptQuotation/confirmBooking 409 schemas.
- Gate caller rules:
  1. Call `assertCanTakeNewWork` only in a READ COMMITTED transaction. Under REPEATABLE READ or SERIALIZABLE the snapshot can be taken before the lock is granted, even when the gate is the first statement, so it can miss a receivable that committed in between.
  2. The shared lock is held until the caller's transaction ends, so a long quotation, accept or confirm transaction delays trip-completion `recognise` for that company. Keep those transactions short.
- Providers: `PaymentProvider` interface and `NoopPaymentProvider` only. Paynow, EcoCash, and InnBucks are candidates, not integrations. No network calls and no real money.
- Tests need a local PostGIS database; point `DATABASE_URL` at it (any free port).

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

## Deploying to Vercel

The API can run as one Vercel serverless function. `npm start` (`dist/main.js`) still works unchanged for a normal server. Both entry points call the same `createApp()` in `src/create-app.ts`, so the 32 KB JSON limit, request-id middleware, validation pipe, and `ApiExceptionFilter` are identical.

| File | Role |
| --- | --- |
| `api/index.ts` | Vercel function entry. Re-exports the handler from `src/serverless.ts`. |
| `src/serverless.ts` | Builds the Nest app on the first request, then reuses it for later requests on the same warm instance. A failed boot is not cached; the next request retries. Boot failures return 503 `SERVICE_UNAVAILABLE` and the reason only goes to the function log. |
| `vercel.json` | Rewrites every path to `/api`, sets `maxDuration` to 30 s, pins region `fra1` (Frankfurt, next to the Supabase project in `eu-central-1`). The build step is `npm run typecheck`; Vercel compiles the function itself. |
| `public/robots.txt` | Vercel requires a non-empty static output directory. This file is the only static asset. |

Vercel project settings: set **Root Directory** to `backend`. `package.json` pins Node `24.x`.

### Environment variables (Vercel project settings, Production)

Names only. Values go into Vercel's environment settings and nowhere else: not chat, not git, not this README.

| Name | Value to use |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | The **transaction pooler** URI (port `6543`) from the Supabase dashboard Connect screen, with user `truber_runtime.<project-ref>` and the `truber_runtime` password. Secret. |
| `DB_CONNECTION_MODE` | `transaction` |
| `DB_TARGET` | `supabase` |
| `DB_SCHEMA` | `truber` |
| `POSTGIS_SCHEMA` | `gis` |
| `DB_RUNTIME_ROLE` | `truber_runtime` |
| `DB_SSL_MODE` | `verify-full` |
| `DB_SSL_CA` | PEM text of the Supabase CA certificate (Dashboard, Database Settings, SSL). Real newlines or literal `\n` both work. Use this instead of `DB_SSL_CA_FILE`, because a function cannot mount secret files. |
| `JWT_ACCESS_SECRET` | A new random value of at least 32 characters, unique to this deployment. Secret. |
| `DELIVERY_ADAPTER` | `disabled`. `dev` is refused when `NODE_ENV=production`. |
| `CLIENT_IP_SOURCE` | `vercel`. Rate limits then key on the client address Vercel puts in `X-Forwarded-For` (Vercel overwrites that header, so it cannot be spoofed). Without it, every caller shares Vercel's proxy address. The value is refused unless `VERCEL=1`, which Vercel sets itself. |

Optional: `DB_POOL_MAX` (defaults to `2` when `VERCEL=1`, otherwise `10`), `DB_STATEMENT_TIMEOUT_MS` (default 15000), `REFRESH_TTL_SECONDS`, `OTP_TTL_SECONDS`, and the `*_SOURCE_MAX` / `*_WINDOW_SECONDS` rate-limit values. `JWT_ACCESS_TTL_SECONDS` and `RESET_TOKEN_TTL_SECONDS` may be omitted; if set they must be `1800`.

Do **not** set `DATABASE_MIGRATION_URL` on Vercel. The API never migrates, so with `DB_TARGET=supabase` it boots without the owner credential. Migrations stay a separate `npm run migrate` run from an operator machine over a direct or session connection; the migration connection refuses port 6543 and `transaction` mode because it needs a session advisory lock.

### Transaction pooler behaviour

Supavisor (and PgBouncer) in transaction mode hand each transaction to any server connection and reject startup parameters. With `DB_CONNECTION_MODE=transaction` the runtime pool:

- sends no `options` or `statement_timeout` startup parameters;
- runs every statement inside `BEGIN; SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = <DB_STATEMENT_TIMEOUT_MS>`, including single statements, so the session guarantees from direct mode still hold per transaction;
- uses only unnamed prepared statements (node-postgres default; no query sets `name`) and only transaction-scoped advisory locks (`pg_advisory_xact_lock`).

All application SQL is schema-qualified, so nothing depends on the pooler's default `search_path`.

### What does not carry over to serverless

- **Cold starts.** The first request on a new instance builds the Nest app and runs the readiness check (two catalog queries).
- **No background work.** The API has no timers, intervals, or queues today. Expiry is checked at request time. Future scheduled work needs Vercel Cron (limited on Hobby) or another runner.
- **Request length.** `maxDuration` is 30 s; the database statement timeout is 15 s.
- **Delivery.** With `DELIVERY_ADAPTER=disabled`, password-reset and OTP codes are not sent or stored, so those flows cannot complete on the hosted API until a real email/SMS provider is added.
- **File uploads.** No upload route exists yet. POD and verification documents must go to object storage (for example Supabase Storage with signed upload URLs), not the function filesystem, and Vercel caps request bodies at 4.5 MB.
- **CORS.** None is configured, same as the normal server. Native mobile apps do not need it; a browser client on another origin will.
- **Deployment Protection.** If the Vercel team protects deployments by default, the `*.vercel.app` URL answers with a Vercel login page. The public API needs protection relaxed for production or a custom domain.

### Local check of the serverless entry

`test/serverless.e2e-spec.ts` serves `api/index.ts` through `http.createServer` and checks that status codes, error bodies, and `X-Request-Id` match the normal app. To check pooler compatibility, run the suite with the runtime URL pointed at a local PgBouncer in `pool_mode = transaction` and `DB_CONNECTION_MODE=transaction`, keeping `DATABASE_MIGRATION_URL` on the direct port.

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
- `X-Forwarded-For` is not trusted by default. Rate limits use the socket address. On Vercel only, `CLIENT_IP_SOURCE=vercel` trusts the one hop Vercel adds (see Deploying to Vercel).

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
