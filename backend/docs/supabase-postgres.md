# Supabase PostgreSQL plan

This is a preparation plan for a later, explicit approval. It is not a record of a completed hosted migration.

Inspected project (read-only, 2026-11-07): `truber`, ref `nvejijeprejhtbsarehz`, PostgreSQL 17, PostGIS 3.3.7 available and not enabled. The project was not identified as a development environment. This repository does not contain its connection strings, passwords, API keys, or CA file. The API process has not connected to it. NestJS remains the authentication and authorization boundary. Supabase Auth, Storage, Realtime, and Vault objects are not modified, and the NestJS JWT is not treated as a Supabase user id.

## What is ready in code

- `DB_TARGET=local` keeps the current loopback workflow, including `DB_SSL_MODE=disable` only for a loopback host.
- `DB_TARGET=supabase` requires `DB_SSL_MODE=verify-full`, `DB_SSL_CA_FILE` or `DB_SSL_CA`, a dedicated `DB_SCHEMA` (not `public` or a managed schema), a PostGIS schema of `gis` or `extensions`, a dedicated `DB_RUNTIME_ROLE`, and, for migrations, a `DATABASE_MIGRATION_URL` that is not the same string as `DATABASE_URL`. The API process itself boots without `DATABASE_MIGRATION_URL`.
- TLS uses the CA file plus Node hostname verification. `rejectUnauthorized` is not disabled.
- The runtime pool is bounded (`DB_POOL_MAX`, 1 to 20, default 10) and sets `search_path` to `pg_catalog`. Application SQL qualifies tables and PostGIS functions.
- `DB_CONNECTION_MODE` accepts `direct`, `session`, or `transaction`. `transaction` is for the Supabase transaction pooler (port `6543`) used by the Vercel deployment: no startup parameters are sent, and every statement runs in a transaction that starts with `SET LOCAL search_path = pg_catalog` and `SET LOCAL statement_timeout`. Port `6543` is refused in any other mode. `DB_MIGRATION_CONNECTION_MODE` accepts only `direct` or `session`, because migrations take a session advisory lock. See the README section Deploying to Vercel.
- `npm run migrate` is the only migration path. Server startup only checks that the schema and PostGIS namespace already exist.
- Tables in the application schema get row-level security enabled, `PUBLIC` table privileges revoked, and privileges for `anon`, `authenticated`, and `service_role` revoked when those roles exist. A policy is created only for `DB_RUNTIME_ROLE`, and it does not call Supabase authentication helpers. The migration role owns the tables and is not the API login.
- The migrate command does not create login roles or passwords.

## What an operator must supply later

Do not invent a pooler hostname. Copy the exact values from the project Dashboard Connect screen into the deployment secret store.

| Secret or file name | Purpose |
| --- | --- |
| `TRUBER_DATABASE_URL` | Runtime connection. Prefer the direct host on port 5432 when the network can reach it. If the network is IPv4-only and the direct host is not reachable, use the session-pooler URI from Dashboard Connect and set `DB_CONNECTION_MODE=session`. |
| `TRUBER_DATABASE_MIGRATION_URL` | Migration connection for a role that can `CREATE EXTENSION` and own the application tables. Prefer direct port 5432. Do not use the transaction pooler. |
| `TRUBER_DB_SSL_CA` | CA certificate downloaded from Dashboard Database Settings, mounted as a file that `DB_SSL_CA_FILE` points at, or supplied as PEM text in `DB_SSL_CA` where files cannot be mounted (Vercel). |
| `TRUBER_DB_RUNTIME_ROLE` | Name of the non-owner login used by `TRUBER_DATABASE_URL`. Create this role in the SQL editor or a reviewed change before `npm run migrate`. |
| `JWT_ACCESS_SECRET` | Existing API signing secret. Not a Supabase API key. |
| `SEED_ADMIN_PASSWORD` | Only for a deliberate non-production seed. The seed command still refuses `NODE_ENV=production`. |

Supabase API keys are not used and must not be pasted into this service.

## Approved migration sequence (not run)

1. Confirm the project is the intended non-production environment.
2. Create the runtime login out of band. Do not store its password in git.
3. Choose `POSTGIS_SCHEMA=gis` before the first enable. PostGIS 3.3.7 is not enabled today (`installed_version` is null). If it is later enabled in another schema, set `POSTGIS_SCHEMA` to that schema. This command will not move it.
4. Export the secret names above as the corresponding `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DB_SSL_CA_FILE`, and `DB_RUNTIME_ROLE` variables. Also set:

```bash
DB_TARGET=supabase
DB_SCHEMA=truber
POSTGIS_SCHEMA=gis
DB_SSL_MODE=verify-full
DB_CONNECTION_MODE=direct
DB_MIGRATION_CONNECTION_MODE=direct
```

Use `session` instead of `direct` only when Dashboard Connect says the supplied URI is the session pooler.

5. Run `npm run migrate` with the migration URL. The command will:

```sql
CREATE SCHEMA IF NOT EXISTS truber;
CREATE SCHEMA IF NOT EXISTS gis;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA gis;
```

It then creates the application tables in `truber`, enables row-level security, revokes Data API role grants on those tables, and grants DML only to `DB_RUNTIME_ROLE`. It does not grant those tables to `anon`, `authenticated`, or `service_role`.

6. Leave `truber` and `gis` out of the Data API exposed schemas. If the API is not used by any Supabase client, turn the Data API off in a separate approved change. This plan does not change that setting.
7. Start the API only after the readiness check passes. Startup does not migrate.
8. Seed only in a confirmed non-production environment, with `SEED_CONFIRM=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION`.

## Local proof, and what it does not prove

`npm test` covers the existing local PostgreSQL 16 database with PostGIS in `public`. `npm run test:supabase-like` covers a second local database with application schema `truber`, PostGIS in `gis`, and a non-superuser runtime role. Ubuntu 24.04 on the development VM did not provide PostgreSQL 17 packages, so the private-schema run used the local PostgreSQL 16 server. That does not certify the hosted PostgreSQL 17 project, TLS to Supabase, the IPv4 pooler, or dashboard settings.

No hosted query, extension enablement, migration, seed, or credential retrieval was performed.
