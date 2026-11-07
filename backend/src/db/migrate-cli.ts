import 'reflect-metadata';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { loadDotEnv } from '../load-dotenv';
import { migrate } from './migrate';
import { buildPoolConfig } from './pg-config';

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env.db, 'migration'));
  try {
    await migrate(pool, env);
    process.stdout.write(`migrations applied for schema ${env.db.DB_SCHEMA}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'migration failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
