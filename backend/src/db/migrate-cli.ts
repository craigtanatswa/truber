import 'reflect-metadata';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { loadDotEnv } from '../load-dotenv';
import { migrate } from './migrate';

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, application_name: 'truber-migrate' });
  try {
    await migrate(pool);
    process.stdout.write('migrations applied\n');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'migration failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
