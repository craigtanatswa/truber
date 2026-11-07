import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { Pool, PoolClient } from 'pg';

const MIGRATION_LOCK = 861_234_001;

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const dir = path.resolve(process.cwd(), 'migrations');
    const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (applied.rowCount) {
        continue;
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      await applyFile(client, file, sql);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK]);
    client.release();
  }
}

async function applyFile(client: PoolClient, file: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
