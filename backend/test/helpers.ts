import { INestApplication, LoggerService } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { DbService } from '../src/db/db.service';
import { qualifyAppSql } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { SEED_CONFIRM, runSeed } from '../src/seed/seed-lib';

export const ADMIN_EMAIL = 'admin@seed.truber.local';
export const ADMIN_PASSWORD = 'seed-admin-password';

export async function truncate(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env.db, 'migration'));
  try {
    await pool.query(
      qualifyAppSql(
        `TRUNCATE delivery_outbox, idempotency_records, rate_limit_buckets, otp_challenges,
                password_reset_tokens, refresh_sessions, loads, company_members, companies, users
         RESTART IDENTITY CASCADE`,
        { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA },
      ),
    );
  } finally {
    await pool.end();
  }
}

export interface HttpResult {
  status: number;
  // Runtime JSON. Contract suites validate the shape separately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export async function http(
  app: INestApplication,
  method: 'get' | 'post' | 'patch',
  url: string,
  options?: { token?: string; body?: unknown; idempotencyKey?: string },
): Promise<HttpResult> {
  const server = app.getHttpServer();
  let call = request(server)[method](url);
  if (options?.token) call = call.set('Authorization', `Bearer ${options.token}`);
  if (options?.idempotencyKey) call = call.set('Idempotency-Key', options.idempotencyKey);
  if (options?.body !== undefined) call = call.send(options.body as object);
  const response = await call;
  return { status: response.status, body: response.body };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export async function latestPayload(app: INestApplication, userId: string, kind: 'password_reset' | 'otp'): Promise<string> {
  const db = app.get(DbService);
  const rows = await db.query<{ payload: string }>(
    `SELECT payload FROM delivery_outbox WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, kind],
  );
  const payload = rows.rows[0]?.payload;
  if (!payload) {
    throw new Error(`missing ${kind} outbox row`);
  }
  return payload;
}

export async function seedAdmin(): Promise<void> {
  await runSeed({
    nodeEnv: 'test',
    confirm: SEED_CONFIRM,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
}

export function capturingLogger(lines: string[]): LoggerService {
  const push = (message: unknown) => {
    lines.push(String(message));
  };
  return { log: push, error: push, warn: push, debug: push, verbose: push };
}
