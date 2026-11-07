import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { APP_TABLES, qualifyAppSql, quoteIdent } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { prepareTestDatabase } from './prepare-db';

describe('schema and PostGIS namespace', () => {
  const env = loadEnv();

  beforeAll(async () => {
    await prepareTestDatabase();
  });

  it('keeps app tables and PostGIS in the configured schemas with deny-by-default RLS', async () => {
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    try {
      const tables = await pool.query<{ nspname: string }>(
        `SELECT n.nspname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'refresh_sessions' AND c.relkind = 'r'`,
      );
      expect(tables.rows.map((row) => row.nspname)).toEqual([env.db.DB_SCHEMA]);

      const extension = await pool.query<{ nspname: string }>(
        `SELECT n.nspname
         FROM pg_extension e
         JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'postgis'`,
      );
      expect(extension.rows[0]?.nspname).toBe(env.db.POSTGIS_SCHEMA);

      const security = await pool.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = ANY($2::text[])
         ORDER BY c.relname`,
        [env.db.DB_SCHEMA, APP_TABLES],
      );
      expect(security.rows.length).toBeGreaterThan(0);
      expect(security.rows.every((row) => row.relrowsecurity)).toBe(true);

      const policies = await pool.query<{ expression: string | null }>(
        `SELECT pg_get_expr(pol.polqual, pol.polrelid) AS expression
         FROM pg_policy pol
         JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1`,
        [env.db.DB_SCHEMA],
      );
      for (const policy of policies.rows) {
        expect(policy.expression ?? '').not.toMatch(/auth\.uid/i);
      }

      const grants = await pool.query(
        `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = $1
           AND table_name = ANY($2::text[])
           AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
        [env.db.DB_SCHEMA, APP_TABLES],
      );
      expect(grants.rows).toEqual([]);

      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'truber_rls_denied') THEN
            CREATE ROLE truber_rls_denied NOLOGIN;
          END IF;
        END
        $$;
      `);
      const client = await pool.connect();
      try {
        await client.query(`GRANT USAGE ON SCHEMA ${quoteIdent(env.db.DB_SCHEMA)} TO truber_rls_denied`);
        await client.query(`GRANT SELECT ON TABLE ${quoteIdent(env.db.DB_SCHEMA)}.users TO truber_rls_denied`);
        await client.query('GRANT truber_rls_denied TO CURRENT_USER');
        await client.query('SET ROLE truber_rls_denied');
        const hidden = await client.query<{ total: number }>(
          qualifyAppSql('SELECT count(*)::int AS total FROM users', {
            appSchema: env.db.DB_SCHEMA,
            postgisSchema: env.db.POSTGIS_SCHEMA,
          }),
        );
        expect(hidden.rows[0].total).toBe(0);
      } finally {
        await client.query('RESET ROLE').catch(() => undefined);
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('lets only the configured runtime role use the API schema when that role is separate', async () => {
    if (env.DATABASE_URL === env.migrationUrl) {
      return;
    }
    const runtime = new Pool(buildPoolConfig(env.db, 'runtime'));
    try {
      const count = await runtime.query<{ total: number }>(
        qualifyAppSql('SELECT count(*)::int AS total FROM users', {
          appSchema: env.db.DB_SCHEMA,
          postgisSchema: env.db.POSTGIS_SCHEMA,
        }),
      );
      expect(count.rows[0].total).toBeGreaterThanOrEqual(0);
      await expect(
        runtime.query(`CREATE TABLE ${quoteIdent(env.db.DB_SCHEMA)}.runtime_should_fail (id integer)`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await runtime.end();
    }
  });
});
