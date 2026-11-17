import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { migrate } from '../src/db/migrate';
import { quoteIdent } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { prepareTestDatabase } from './prepare-db';

const ITEM5_TABLES = ['account_status_changes', 'trucks', 'verification_documents'];
const DENIED_GRANTEES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const MIGRATION_ID = '004_trucks_verification.sql';

describe('item 5 schema, RLS and grants', () => {
  const env = loadEnv();

  beforeAll(async () => {
    await prepareTestDatabase();
  });

  it('enables deny-by-default RLS and keeps item 5 tables out of API role grants', async () => {
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    try {
      const security = await pool.query<{
        relname: string;
        nspname: string;
        relrowsecurity: boolean;
      }>(
        `SELECT c.relname, n.nspname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1
           AND c.relkind = 'r'
           AND c.relname = ANY($2::text[])
         ORDER BY c.relname`,
        [env.db.DB_SCHEMA, ITEM5_TABLES],
      );
      expect(security.rows.map((row) => row.relname)).toEqual([...ITEM5_TABLES].sort());
      expect(security.rows.every((row) => row.nspname === env.db.DB_SCHEMA)).toBe(true);
      expect(security.rows.every((row) => row.relrowsecurity)).toBe(true);

      const grants = await pool.query(
        `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = $1
           AND table_name = ANY($2::text[])
           AND grantee = ANY($3::text[])`,
        [env.db.DB_SCHEMA, ITEM5_TABLES, DENIED_GRANTEES],
      );
      expect(grants.rows).toEqual([]);

      if (env.db.DB_RUNTIME_ROLE) {
        const runtimeGrants = await pool.query<{ table_name: string; privilege_type: string }>(
          `SELECT table_name, privilege_type
           FROM information_schema.role_table_grants
           WHERE table_schema = $1
             AND table_name = ANY($2::text[])
             AND grantee = $3`,
          [env.db.DB_SCHEMA, ITEM5_TABLES, env.db.DB_RUNTIME_ROLE],
        );
        for (const table of ITEM5_TABLES) {
          expect(
            runtimeGrants.rows
              .filter((row) => row.table_name === table)
              .map((row) => row.privilege_type)
              .sort(),
          ).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        }

        const policies = await pool.query<{ tablename: string }>(
          `SELECT tablename
           FROM pg_policies
           WHERE schemaname = $1
             AND tablename = ANY($2::text[])
             AND policyname = 'truber_backend_dml'`,
          [env.db.DB_SCHEMA, ITEM5_TABLES],
        );
        expect(policies.rows.map((row) => row.tablename).sort()).toEqual([...ITEM5_TABLES].sort());
      }
    } finally {
      await pool.end();
    }
  });

  it('records migration 004 and reruns migrate without changing it', async () => {
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    const schema = quoteIdent(env.db.DB_SCHEMA);
    try {
      const before = await pool.query<{ id: string; applied_at: Date }>(
        `SELECT id, applied_at FROM ${schema}.schema_migrations WHERE id = $1`,
        [MIGRATION_ID],
      );
      expect(before.rowCount).toBe(1);

      const countBefore = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${schema}.schema_migrations`,
      );

      await expect(migrate(pool, env)).resolves.toBeUndefined();

      const after = await pool.query<{ id: string; applied_at: Date }>(
        `SELECT id, applied_at FROM ${schema}.schema_migrations WHERE id = $1`,
        [MIGRATION_ID],
      );
      expect(after.rowCount).toBe(1);
      expect(after.rows[0].id).toBe(MIGRATION_ID);
      expect(after.rows[0].applied_at.getTime()).toBe(before.rows[0].applied_at.getTime());

      const countAfter = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${schema}.schema_migrations`,
      );
      expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
    } finally {
      await pool.end();
    }
  });
});
