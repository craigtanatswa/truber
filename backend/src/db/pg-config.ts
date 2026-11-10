import { readFileSync } from 'fs';
import tls from 'tls';
import { PoolConfig } from 'pg';
import { quoteIdent } from './identifiers';

export type DbTarget = 'local' | 'supabase';
export type DbSslMode = 'disable' | 'verify-full';
export type DbConnectionMode = 'direct' | 'session' | 'transaction';

export interface DbSettings {
  DB_TARGET: DbTarget;
  DB_SCHEMA: string;
  POSTGIS_SCHEMA: string;
  DATABASE_URL: string;
  migrationUrl: string;
  DB_RUNTIME_ROLE: string | null;
  DB_SSL_MODE: DbSslMode;
  DB_SSL_CA_FILE: string | null;
  DB_SSL_CA: string | null;
  DB_CONNECTION_MODE: DbConnectionMode;
  DB_MIGRATION_CONNECTION_MODE: DbConnectionMode;
  DB_POOL_MAX: number;
  DB_STATEMENT_TIMEOUT_MS: number;
}

const RESERVED_SCHEMAS = new Set([
  'auth',
  'storage',
  'realtime',
  'vault',
  'extensions',
  'graphql',
  'graphql_public',
  'pg_catalog',
  'information_schema',
  'pg_toast',
]);

const RESERVED_RUNTIME_ROLES = new Set([
  'anon',
  'authenticated',
  'authenticator',
  'service_role',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'dashboard_user',
  'pgbouncer',
  'postgres',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function databaseHost(connectionString: string): string {
  return parsedUrl(connectionString).hostname;
}

export function databasePort(connectionString: string): string {
  return parsedUrl(connectionString).port;
}

export function assertDbSettings(settings: DbSettings): void {
  quoteIdent(settings.DB_SCHEMA);
  quoteIdent(settings.POSTGIS_SCHEMA);
  if (settings.DB_RUNTIME_ROLE) {
    quoteIdent(settings.DB_RUNTIME_ROLE);
  }
  if (RESERVED_SCHEMAS.has(settings.DB_SCHEMA)) {
    throw new Error(`DB_SCHEMA must not be a managed schema (${settings.DB_SCHEMA})`);
  }
  if (RESERVED_SCHEMAS.has(settings.POSTGIS_SCHEMA) && settings.POSTGIS_SCHEMA !== 'extensions') {
    throw new Error(`POSTGIS_SCHEMA must not be a managed schema (${settings.POSTGIS_SCHEMA})`);
  }
  if (settings.DB_RUNTIME_ROLE && RESERVED_RUNTIME_ROLES.has(settings.DB_RUNTIME_ROLE)) {
    throw new Error('DB_RUNTIME_ROLE must be a dedicated login, not a Supabase managed role');
  }
  if (settings.DB_TARGET === 'supabase') {
    if (settings.DB_SCHEMA === 'public') {
      throw new Error('DB_SCHEMA=public is refused when DB_TARGET=supabase; use a dedicated application schema');
    }
    if (settings.POSTGIS_SCHEMA === 'public') {
      throw new Error('POSTGIS_SCHEMA=public is refused when DB_TARGET=supabase; choose gis or the already installed extension schema before enabling PostGIS');
    }
    if (settings.DB_SSL_MODE !== 'verify-full') {
      throw new Error('DB_TARGET=supabase requires DB_SSL_MODE=verify-full');
    }
    if (!settings.DB_SSL_CA_FILE && !settings.DB_SSL_CA) {
      throw new Error('DB_TARGET=supabase requires DB_SSL_CA_FILE or DB_SSL_CA');
    }
    if (!settings.DB_RUNTIME_ROLE) {
      throw new Error('DB_TARGET=supabase requires DB_RUNTIME_ROLE');
    }
    if (settings.migrationUrl && settings.DATABASE_URL === settings.migrationUrl) {
      throw new Error('DATABASE_URL and DATABASE_MIGRATION_URL must be different roles when DB_TARGET=supabase');
    }
  }
  if (settings.DB_MIGRATION_CONNECTION_MODE === 'transaction') {
    throw new Error('migration connection must not use the transaction pooler; migrate needs session advisory locks');
  }
  assertConnection(settings.DATABASE_URL, settings.DB_CONNECTION_MODE, settings, 'runtime');
  if (settings.migrationUrl) {
    assertConnection(settings.migrationUrl, settings.DB_MIGRATION_CONNECTION_MODE, settings, 'migration');
  }
}

export function buildPoolConfig(settings: DbSettings, which: 'runtime' | 'migration'): PoolConfig {
  assertDbSettings(settings);
  const connectionString = which === 'migration' ? settings.migrationUrl : settings.DATABASE_URL;
  const config: PoolConfig = {
    connectionString,
    max: which === 'migration' ? 1 : settings.DB_POOL_MAX,
    application_name: which === 'migration' ? 'truber-migrate' : 'truber-api',
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    ssl: buildSsl(settings, connectionString),
  };
  if (!(which === 'runtime' && settings.DB_CONNECTION_MODE === 'transaction')) {
    config.statement_timeout = settings.DB_STATEMENT_TIMEOUT_MS;
    config.options = '-c search_path=pg_catalog';
  }
  return config;
}

export function buildSsl(settings: DbSettings, connectionString: string): tls.ConnectionOptions | undefined {
  if (settings.DB_SSL_MODE === 'disable') {
    return undefined;
  }
  const ca = settings.DB_SSL_CA || (settings.DB_SSL_CA_FILE ? readFileSync(settings.DB_SSL_CA_FILE, 'utf8') : null);
  if (!ca) {
    throw new Error('DB_SSL_MODE=verify-full requires DB_SSL_CA_FILE or DB_SSL_CA');
  }
  const servername = databaseHost(connectionString);
  return {
    rejectUnauthorized: true,
    ca,
    servername,
    checkServerIdentity: (host, cert) => tls.checkServerIdentity(host, cert),
  };
}

function assertConnection(connectionString: string, mode: DbConnectionMode, settings: DbSettings, which: 'runtime' | 'migration'): void {
  if (mode !== 'direct' && mode !== 'session' && mode !== 'transaction') {
    throw new Error(`${which} connection mode is not supported`);
  }
  let port = '';
  let host = '';
  try {
    port = databasePort(connectionString);
    host = databaseHost(connectionString);
  } catch {
    throw new Error(`${which} database URL is not a valid connection string`);
  }
  if (port === '6543' && !(which === 'runtime' && mode === 'transaction')) {
    throw new Error(
      `${which} URL uses port 6543. That is the Supabase transaction pooler, which does not support prepared statements or session state. Set DB_CONNECTION_MODE=transaction for the runtime URL, never for migrations.`,
    );
  }
  if (settings.DB_SSL_MODE === 'disable') {
    if (settings.DB_TARGET !== 'local' || !LOOPBACK_HOSTS.has(host)) {
      throw new Error('DB_SSL_MODE=disable is only allowed for DB_TARGET=local on a loopback host');
    }
  }
  if (/sslmode=(require|verify-ca|verify-full|no-verify)/i.test(connectionString) && settings.DB_SSL_MODE === 'disable') {
    throw new Error('DB_SSL_MODE=disable conflicts with sslmode in the connection URL');
  }
}

function parsedUrl(connectionString: string): URL {
  return new URL(connectionString.replace(/^postgres(ql)?:/i, 'http:'));
}
