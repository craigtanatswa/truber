import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { migrate } from '../src/db/migrate';
import { qualifyAppSql, quoteIdent } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { prepareTestDatabase } from './prepare-db';

const ITEM5_TABLES = ['account_status_changes', 'trucks', 'verification_documents'];
const DENIED_GRANTEES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const MIGRATION_IDS = ['004_trucks_verification.sql', '004a_truck_registration_format.sql'];

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

  it('records migrations 004 and 004a and reruns migrate without changing them', async () => {
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    const schema = quoteIdent(env.db.DB_SCHEMA);
    try {
      // Match the runner's code-unit filename order regardless of database collation.
      const before = await pool.query<{ id: string; applied_at: Date }>(
        `SELECT id, applied_at FROM ${schema}.schema_migrations WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C"`,
        [MIGRATION_IDS],
      );
      expect(before.rows.map((row) => row.id)).toEqual(MIGRATION_IDS);

      const countBefore = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${schema}.schema_migrations`,
      );

      await expect(migrate(pool, env)).resolves.toBeUndefined();

      // Match the runner's code-unit filename order regardless of database collation.
      const after = await pool.query<{ id: string; applied_at: Date }>(
        `SELECT id, applied_at FROM ${schema}.schema_migrations WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C"`,
        [MIGRATION_IDS],
      );
      expect(after.rows.map((row) => row.id)).toEqual(MIGRATION_IDS);
      const beforeApplied = new Map(before.rows.map((row) => [row.id, row.applied_at.getTime()]));
      for (const row of after.rows) {
        expect(row.applied_at.getTime()).toBe(beforeApplied.get(row.id));
      }

      const countAfter = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${schema}.schema_migrations`,
      );
      expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
    } finally {
      await pool.end();
    }
  });

  it('enforces the normalised registration format at the database boundary', async () => {
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    const sql = (text: string) =>
      qualifyAppSql(text, { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA });
    const userId = randomUUID();
    const companyId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        sql(`INSERT INTO users (id, email, password_hash, full_name, role, account_status, created_at, updated_at)
             VALUES ($1, $2, 'hash', 'Registration Format Test', 'transporter', 'active',
                     clock_timestamp(), clock_timestamp())`),
        [userId, `registration-format-${userId}@example.com`],
      );
      await client.query(
        sql(`INSERT INTO companies (id, type, legal_name, verification_status, created_at, updated_at)
             VALUES ($1, 'transporter', 'Registration Format Fleet', 'unverified',
                     clock_timestamp(), clock_timestamp())`),
        [companyId],
      );

      const insertTruck = (registrationNumber: string) =>
        client.query(
          sql(`INSERT INTO trucks (
               id, company_id, created_by, registration_number, truck_type, capacity_kg,
               verification_status, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, 'flatbed', 10000, 'unverified',
                       clock_timestamp(), clock_timestamp())`),
          [randomUUID(), companyId, userId, registrationNumber],
        );

      for (const registrationNumber of ['abc123', 'ABC 123', 'ABC.123', 'АВС123', '']) {
        await client.query('SAVEPOINT truck_format_check');
        let error: { code?: string; constraint?: string } | undefined;
        try {
          await insertTruck(registrationNumber);
        } catch (caught) {
          error = caught as { code?: string; constraint?: string };
        }
        await client.query('ROLLBACK TO SAVEPOINT truck_format_check');
        expect(error).toBeDefined();
        expect(error?.code).toBe('23514');
        expect(error?.constraint).toBe('trucks_registration_number_format');
      }

      await expect(insertTruck('ABC123X')).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
