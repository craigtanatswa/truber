import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import tls from 'tls';
import { loadEnv } from '../src/config/env';
import { qualifyAppSql } from '../src/db/identifiers';
import { buildPoolConfig, buildSsl } from '../src/db/pg-config';

const OPENAPI_SHA256 = '8839f1d4afebb3ceda9683d4c83604866ed80c31d094be31afb415fc08460b4a';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:5432/truber_test',
    JWT_ACCESS_SECRET: 'test-only-jwt-secret-must-be-at-least-32',
    DELIVERY_ADAPTER: 'dev',
    DB_TARGET: 'local',
    DB_SCHEMA: 'public',
    POSTGIS_SCHEMA: 'public',
    DB_SSL_MODE: 'disable',
    DB_CONNECTION_MODE: 'direct',
    DB_MIGRATION_CONNECTION_MODE: 'direct',
    ...overrides,
  };
}

describe('database configuration', () => {
  it('keeps the published OpenAPI contract byte-for-byte', () => {
    const file = readFileSync(path.resolve(__dirname, '../../api/openapi.yaml'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(OPENAPI_SHA256);
  });

  it('qualifies application tables and PostGIS calls without rewriting string literals', () => {
    const layout = { appSchema: 'truber', postgisSchema: 'gis' };
    const sql = qualifyAppSql(
      "SELECT city FROM users WHERE email = 'users@example.com' AND pickup_geog::geography IS NULL AND ST_Y(pickup_geog::geometry) > 0",
      layout,
    );
    expect(sql).toContain('"truber".users');
    expect(sql).toContain("'users@example.com'");
    expect(sql).toContain('"gis".geography');
    expect(sql).toContain('"gis".geometry');
    expect(sql).toContain('"gis".ST_Y');
    expect(qualifyAppSql(sql, layout)).toBe(sql);
  });

  it('refuses transaction pooler, weak TLS, public supabase schemas, and shared migration credentials', () => {
    expect(() => loadEnv(env({ DB_MIGRATION_CONNECTION_MODE: 'transaction' }))).toThrow(
      /Invalid environment configuration: DB_MIGRATION_CONNECTION_MODE/,
    );
    expect(() =>
      loadEnv(env({ DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:6543/truber_test' })),
    ).toThrow(/6543/);
    expect(() =>
      loadEnv(
        env({
          DB_TARGET: 'supabase',
          DB_SCHEMA: 'public',
          POSTGIS_SCHEMA: 'gis',
          DB_SSL_MODE: 'verify-full',
          DB_SSL_CA_FILE: '/tmp/does-not-need-to-exist-yet',
          DB_RUNTIME_ROLE: 'truber_runtime',
          DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@db.example.invalid:5432/postgres',
          DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres',
        }),
      ),
    ).toThrow(/DB_SCHEMA=public/);
    expect(() =>
      loadEnv(
        env({
          DB_TARGET: 'supabase',
          DB_SCHEMA: 'truber',
          POSTGIS_SCHEMA: 'gis',
          DB_SSL_MODE: 'disable',
          DB_RUNTIME_ROLE: 'truber_runtime',
          DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@db.example.invalid:5432/postgres',
          DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres',
        }),
      ),
    ).toThrow(/verify-full/);
    expect(() =>
      loadEnv(
        env({
          DB_TARGET: 'supabase',
          DB_SCHEMA: 'truber',
          POSTGIS_SCHEMA: 'gis',
          DB_SSL_MODE: 'verify-full',
          DB_SSL_CA_FILE: path.join(tmpdir(), 'missing-truber-ca.pem'),
          DB_RUNTIME_ROLE: 'service_role',
          DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@db.example.invalid:5432/postgres',
          DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres',
        }),
      ),
    ).toThrow(/managed role/);
    const shared = 'postgres://same_placeholder:placeholder@db.example.invalid:5432/postgres';
    const caPath = path.join(tmpdir(), 'truber-config-test-ca.pem');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    expect(() =>
      loadEnv(
        env({
          DB_TARGET: 'supabase',
          DB_SCHEMA: 'truber',
          POSTGIS_SCHEMA: 'gis',
          DB_SSL_MODE: 'verify-full',
          DB_SSL_CA_FILE: caPath,
          DB_RUNTIME_ROLE: 'truber_runtime',
          DATABASE_URL: shared,
          DATABASE_MIGRATION_URL: shared,
        }),
      ),
    ).toThrow(/different roles/);
    expect(() => loadEnv(env({ DB_SSL_MODE: 'disable', DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres' }))).toThrow(
      /loopback/,
    );
  });

  it('allows the transaction pooler for runtime while keeping migrations on session connections', () => {
    const transaction = loadEnv(
      env({
        DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:6543/truber_test',
        DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@127.0.0.1:5432/truber_test',
        DB_CONNECTION_MODE: 'transaction',
      }),
    );
    expect(transaction.db.DB_CONNECTION_MODE).toBe('transaction');
    const transactionPool = buildPoolConfig(transaction.db, 'runtime');
    expect(transactionPool.options).toBeUndefined();
    expect(transactionPool.statement_timeout).toBeUndefined();
    const direct = loadEnv(env({ DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@127.0.0.1:5432/truber_test' }));
    const directPool = buildPoolConfig(direct.db, 'runtime');
    expect(directPool.options).toBe('-c search_path=pg_catalog');
    expect(directPool.statement_timeout).toBe(direct.db.DB_STATEMENT_TIMEOUT_MS);

    expect(() =>
      loadEnv(
        env({
          DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@127.0.0.1:6543/truber_test',
        }),
      ),
    ).toThrow(/6543/);

    const caText = '-----BEGIN CERTIFICATE-----\\nTEST\\n-----END CERTIFICATE-----\\n';
    const supabase = env({
      DB_TARGET: 'supabase',
      DB_SCHEMA: 'truber',
      POSTGIS_SCHEMA: 'gis',
      DB_SSL_MODE: 'verify-full',
      DB_SSL_CA: caText,
      DB_RUNTIME_ROLE: 'truber_runtime',
      DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres',
    });
    expect(() => loadEnv(supabase)).toThrow(/DATABASE_MIGRATION_URL is required/);
    const api = loadEnv(supabase, { purpose: 'api' });
    expect(api.migrationUrl).toBe('');
    expect(api.db.DB_SSL_CA).toContain('\n');
    expect(api.db.DB_SSL_CA).not.toContain('\\n');
    const ssl = buildSsl(api.db, api.DATABASE_URL);
    expect(String(ssl?.ca)).toContain('\n');
    expect(String(ssl?.ca)).not.toContain('\\n');

    expect(() => loadEnv(env({ CLIENT_IP_SOURCE: 'vercel' }))).toThrow(/CLIENT_IP_SOURCE=vercel/);
    expect(loadEnv(env({ CLIENT_IP_SOURCE: 'vercel', VERCEL: '1' })).CLIENT_IP_SOURCE).toBe('vercel');
    expect(loadEnv(env({ VERCEL: '1' })).db.DB_POOL_MAX).toBe(2);
    expect(loadEnv(env({ VERCEL: '1', DB_POOL_MAX: '1' })).db.DB_POOL_MAX).toBe(1);
    expect(loadEnv(env()).db.DB_POOL_MAX).toBe(10);
  });

  it('refuses the dev booking fixtures file in production', () => {
    expect(() =>
      loadEnv(
        env({
          NODE_ENV: 'production',
          DELIVERY_ADAPTER: 'disabled',
          DEV_BOOKING_FIXTURES_FILE: '/tmp/truber-booking-fixtures.json',
        }),
      ),
    ).toThrow('DEV_BOOKING_FIXTURES_FILE cannot be used when NODE_ENV=production');
    expect(
      loadEnv(
        env({
          NODE_ENV: 'test',
          DEV_BOOKING_FIXTURES_FILE: '/tmp/truber-booking-fixtures.json',
        }),
      ).DEV_BOOKING_FIXTURES_FILE,
    ).toBe('/tmp/truber-booking-fixtures.json');
  });

  it('verifies TLS hostname and certificate and never disables authorization checks', () => {
    const caPath = path.join(tmpdir(), 'truber-config-test-ca.pem');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    const loaded = loadEnv(
      env({
        DB_TARGET: 'supabase',
        DB_SCHEMA: 'truber',
        POSTGIS_SCHEMA: 'gis',
        DB_SSL_MODE: 'verify-full',
        DB_SSL_CA_FILE: caPath,
        DB_RUNTIME_ROLE: 'truber_runtime',
        DB_CONNECTION_MODE: 'session',
        DATABASE_URL: 'postgres://runtime_placeholder:placeholder@db.example.invalid:5432/postgres',
        DATABASE_MIGRATION_URL: 'postgres://migrator_placeholder:placeholder@db.example.invalid:5432/postgres',
      }),
    );
    const ssl = buildSsl(loaded.db, loaded.DATABASE_URL);
    expect(ssl?.rejectUnauthorized).toBe(true);
    expect(ssl?.servername).toBe('db.example.invalid');
    const mismatch = ssl?.checkServerIdentity?.('db.example.invalid', {
      subject: { CN: 'example.com' },
      subjectaltname: 'DNS:example.com',
    } as tls.PeerCertificate);
    expect(String(mismatch)).toMatch(/does not match|altnames|hostname/i);

    const roots = [path.resolve(__dirname, '../src'), path.resolve(__dirname, '../migrations'), path.resolve(__dirname, '../scripts')];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|js|sql|py|yml|example)$/.test(entry.name)) continue;
        const text = readFileSync(full, 'utf8');
        if (/rejectUnauthorized\s*:\s*false/.test(text) || /auth\.uid\s*\(/.test(text)) {
          offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(root);
    const testText = readFileSync(__filename, 'utf8');
    expect(testText).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    expect(offenders).toEqual([]);
  });
});
