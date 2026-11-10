import { z, ZodError } from 'zod';
import { assertDbSettings, DbConnectionMode, DbSettings, DbSslMode, DbTarget } from '../db/pg-config';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().optional(),
  DB_TARGET: z.enum(['local', 'supabase']).default('local'),
  DB_SCHEMA: z.string().default('public'),
  POSTGIS_SCHEMA: z.string().default('public'),
  DB_RUNTIME_ROLE: z.string().optional(),
  DB_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
  DB_SSL_CA_FILE: z.string().optional(),
  DB_CONNECTION_MODE: z.enum(['direct', 'session']).default('direct'),
  DB_MIGRATION_CONNECTION_MODE: z.enum(['direct', 'session']).default('direct'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(1800),
  RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().default(1800),
  REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(7_776_000).default(1_209_600),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  DELIVERY_ADAPTER: z.enum(['dev', 'disabled']),
  RESET_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
  RESET_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  CONFIRM_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
  CONFIRM_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  OTP_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(5),
  OTP_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  OTP_VERIFY_MAX: z.coerce.number().int().min(1).max(100_000).default(5),
  OTP_VERIFY_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
});

export type Env = z.infer<typeof schema> & {
  migrationUrl: string;
  runtimeRole: string | null;
  db: DbSettings;
};

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(blankToUndefined(source));
  } catch (error) {
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
      throw new Error(`Invalid environment configuration: ${fields}`);
    }
    throw error;
  }

  if (parsed.JWT_ACCESS_TTL_SECONDS !== 1800) {
    throw new Error('JWT_ACCESS_TTL_SECONDS must be 1800 to match API v0.4.0');
  }
  if (parsed.RESET_TOKEN_TTL_SECONDS !== 1800) {
    throw new Error('RESET_TOKEN_TTL_SECONDS must be 1800 to match API v0.2.0');
  }
  if (parsed.NODE_ENV === 'production' && parsed.DELIVERY_ADAPTER === 'dev') {
    throw new Error('DELIVERY_ADAPTER=dev cannot be used when NODE_ENV=production');
  }

  const migrationUrl = parsed.DATABASE_MIGRATION_URL || (parsed.DB_TARGET === 'local' ? parsed.DATABASE_URL : '');
  if (!migrationUrl) {
    throw new Error('DATABASE_MIGRATION_URL is required when DB_TARGET=supabase');
  }
  const runtimeRole = parsed.DB_RUNTIME_ROLE?.trim() || null;
  const db: DbSettings = {
    DB_TARGET: parsed.DB_TARGET as DbTarget,
    DB_SCHEMA: parsed.DB_SCHEMA,
    POSTGIS_SCHEMA: parsed.POSTGIS_SCHEMA,
    DATABASE_URL: parsed.DATABASE_URL,
    migrationUrl,
    DB_RUNTIME_ROLE: runtimeRole,
    DB_SSL_MODE: parsed.DB_SSL_MODE as DbSslMode,
    DB_SSL_CA_FILE: parsed.DB_SSL_CA_FILE?.trim() || null,
    DB_CONNECTION_MODE: parsed.DB_CONNECTION_MODE as DbConnectionMode,
    DB_MIGRATION_CONNECTION_MODE: parsed.DB_MIGRATION_CONNECTION_MODE as DbConnectionMode,
    DB_POOL_MAX: parsed.DB_POOL_MAX,
    DB_STATEMENT_TIMEOUT_MS: parsed.DB_STATEMENT_TIMEOUT_MS,
  };
  assertDbSettings(db);
  return { ...parsed, migrationUrl, runtimeRole, db };
}

function blankToUndefined(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...source };
  for (const key of ['DATABASE_MIGRATION_URL', 'DB_RUNTIME_ROLE', 'DB_SSL_CA_FILE']) {
    if (copy[key] !== undefined && copy[key]?.trim() === '') {
      delete copy[key];
    }
  }
  return copy;
}
