import 'reflect-metadata';
import { loadEnv } from '../config/env';
import { loadDotEnv } from '../load-dotenv';
import { SeedRefusal, runSeed } from './seed-lib';

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const result = await runSeed({
    nodeEnv: env.NODE_ENV,
    confirm: process.env.SEED_CONFIRM,
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@seed.truber.local',
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  process.stdout.write(`seed admin ${result.created ? 'created' : 'already present'} id=${result.userId}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof SeedRefusal ? error.message : error instanceof Error ? error.message : 'seed failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
