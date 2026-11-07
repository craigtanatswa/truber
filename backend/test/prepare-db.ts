import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { migrate } from '../src/db/migrate';
import { buildPoolConfig, databaseHost } from '../src/db/pg-config';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function assertLocalTestDatabase(): void {
  const env = loadEnv();
  for (const url of [env.DATABASE_URL, env.migrationUrl]) {
    const host = databaseHost(url);
    if (!LOOPBACK.has(host)) {
      throw new Error('Tests refuse a non-loopback database host');
    }
  }
}

export async function prepareTestDatabase(): Promise<void> {
  assertLocalTestDatabase();
  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env.db, 'migration'));
  try {
    await migrate(pool, env);
  } finally {
    await pool.end();
  }
}
