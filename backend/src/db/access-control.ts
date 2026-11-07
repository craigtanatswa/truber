import { PoolClient } from 'pg';
import { APP_TABLES, quoteIdent } from './identifiers';
import { DbSettings } from './pg-config';

const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const RUNTIME_TABLES = APP_TABLES.filter((table) => table !== 'schema_migrations');

/**
 * Idempotent grants and row-level security for the application schema.
 * Policies, when created, name only the dedicated runtime role.
 * They do not consult Supabase authentication. Managed auth, storage, realtime, and vault objects are not altered.
 */
export async function applyAccessControl(client: PoolClient, settings: DbSettings): Promise<void> {
  const appSchema = quoteIdent(settings.DB_SCHEMA);
  if (settings.DB_RUNTIME_ROLE) {
    const exists = await roleExists(client, settings.DB_RUNTIME_ROLE);
    if (!exists) {
      throw new Error('DB_RUNTIME_ROLE is not a database role. Create that login before migrating. This command does not create passwords or roles.');
    }
  }

  for (const table of APP_TABLES) {
    const qualified = `${appSchema}.${quoteIdent(table)}`;
    await client.query(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS truber_backend_dml ON ${qualified}`);
    await client.query(`REVOKE ALL ON TABLE ${qualified} FROM PUBLIC`);
    for (const role of API_ROLES) {
      if (await roleExists(client, role)) {
        await client.query(`REVOKE ALL ON TABLE ${qualified} FROM ${quoteIdent(role)}`);
      }
    }
  }

  if (settings.DB_SCHEMA !== 'public') {
    await revokeSchemaUse(client, settings.DB_SCHEMA);
  }
  if (settings.POSTGIS_SCHEMA !== 'public' && settings.POSTGIS_SCHEMA !== 'extensions') {
    await revokeSchemaUse(client, settings.POSTGIS_SCHEMA);
  }
  if (settings.DB_RUNTIME_ROLE) {
    const role = quoteIdent(settings.DB_RUNTIME_ROLE);
    await client.query(`GRANT USAGE ON SCHEMA ${appSchema} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA ${quoteIdent(settings.POSTGIS_SCHEMA)} TO ${role}`);
    for (const table of RUNTIME_TABLES) {
      const qualified = `${appSchema}.${quoteIdent(table)}`;
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${qualified} TO ${role}`);
      await client.query(
        `CREATE POLICY truber_backend_dml ON ${qualified} FOR ALL TO ${role} USING (true) WITH CHECK (true)`,
      );
    }
  }

  await client.query(`REVOKE CREATE ON SCHEMA ${appSchema} FROM PUBLIC`);
}

async function revokeSchemaUse(client: PoolClient, schema: string): Promise<void> {
  const qualified = quoteIdent(schema);
  await client.query(`REVOKE ALL ON SCHEMA ${qualified} FROM PUBLIC`);
  for (const role of API_ROLES) {
    if (await roleExists(client, role)) {
      await client.query(`REVOKE ALL ON SCHEMA ${qualified} FROM ${quoteIdent(role)}`);
    }
  }
}

async function roleExists(client: PoolClient, role: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  return Boolean(result.rowCount);
}
