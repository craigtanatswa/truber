import { Pool } from 'pg';
import { DbSettings } from './pg-config';

export async function assertReady(pool: Pool, settings: DbSettings): Promise<void> {
  const table = await pool.query(
    `SELECT 1
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = 'users' AND c.relkind = 'r'`,
    [settings.DB_SCHEMA],
  );
  const extension = await pool.query<{ nspname: string }>(
    `SELECT n.nspname
     FROM pg_extension e
     JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'postgis'`,
  );
  const installedIn = extension.rows[0]?.nspname;
  if (!table.rowCount || installedIn !== settings.POSTGIS_SCHEMA) {
    throw new Error(
      `Database is not ready for schema "${settings.DB_SCHEMA}" with PostGIS in "${settings.POSTGIS_SCHEMA}". Run npm run migrate with the migration connection. The API process does not apply migrations or enable extensions.`,
    );
  }
}
