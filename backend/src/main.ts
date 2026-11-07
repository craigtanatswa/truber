import 'reflect-metadata';
import { ENV, Env } from './config/env';
import { createApp } from './create-app';
import { loadDotEnv } from './load-dotenv';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const app = await createApp();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, env.BIND_HOST);
  process.stdout.write(`truber api listening on http://${env.BIND_HOST}:${env.PORT}\n`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'failed to start';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
