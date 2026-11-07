import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { Env } from '../config/env';
import { applyAccessControl } from './access-control';
import { qualifyAppSql, quoteIdent } from './identifiers';

const MIGRATION_LOCK = 861_234_001;

export async function migrate(pool: Pool, env: Env): Promise<void> {
  const client = await pool.connect();
  const appSchema = quoteIdent(env.db.DB_SCHEMA);
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${appSchema}`);
    await ensurePostgis(client, env.db.POSTGIS_SCHEMA);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${appSchema}.${quoteIdent('schema_migrations')} (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const dir = path.resolve(process.cwd(), 'migrations');
    const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await client.query(
        `SELECT 1 FROM ${appSchema}.${quoteIdent('schema_migrations')} WHERE id = $1`,
        [file],
      );
      if (applied.rowCount) {
        continue;
      }
      const raw = await readFile(path.join(dir, file), 'utf8');
      const sql = qualifyAppSql(raw, { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA });
      await applyFile(client, appSchema, file, sql);
    }
    await applyAccessControl(client, env.db);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

async function ensurePostgis(client: PoolClient, postgisSchema: string): Promise<void> {
  const existing = await client.query<{ nspname: string }>(
    `SELECT n.nspname
     FROM pg_extension e
     JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'postgis'`,
  );
  const installedIn = existing.rows[0]?.nspname;
  if (installedIn && installedIn !== postgisSchema) {
    throw new Error(
      `PostGIS is already installed in schema "${installedIn}". Set POSTGIS_SCHEMA to that schema before migrating. This command does not relocate PostGIS.`,
    );
  }
  if (!installedIn) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(postgisSchema)}`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA ${quoteIdent(postgisSchema)}`);
  }
}

async function applyFile(client: PoolClient, appSchema: string, file: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(`INSERT INTO ${appSchema}.${quoteIdent('schema_migrations')} (id) VALUES ($1)`, [file]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
