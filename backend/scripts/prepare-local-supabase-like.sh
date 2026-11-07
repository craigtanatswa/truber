#!/usr/bin/env bash
# Local-only fixture for a private application schema and a gis PostGIS schema.
# Refuses any non-loopback host. Does not contact Supabase.
set -euo pipefail

HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5432}"
ADMIN_USER="${PGADMIN_USER:-truber}"
ADMIN_PASSWORD="${PGADMIN_PASSWORD:-truber}"
RUNTIME_USER="${PGRUNTIME_USER:-truber_runtime}"
RUNTIME_PASSWORD="${PGRUNTIME_PASSWORD:-truber}"
APP_DATABASE="${PGAPP_DATABASE:-truber_gis_like}"

case "$HOST" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "Refusing non-loopback database host" >&2
    exit 1
    ;;
esac

export PGPASSWORD="$ADMIN_PASSWORD"
PSQL=(psql -h "$HOST" -p "$PORT" -U "$ADMIN_USER" -v ON_ERROR_STOP=1)

if "${PSQL[@]}" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  MAINT_DB=postgres
else
  MAINT_DB=truber_test
fi

"${PSQL[@]}" -d "$MAINT_DB" <<SQL
SELECT format('CREATE DATABASE %I', '${APP_DATABASE}')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${APP_DATABASE}')
\gexec
SQL

"${PSQL[@]}" -d "$MAINT_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_USER}') THEN
    CREATE ROLE ${RUNTIME_USER} LOGIN PASSWORD '${RUNTIME_PASSWORD}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
\$\$;
SQL

echo "local supabase-like database ${APP_DATABASE} is ready on ${HOST}:${PORT}"
