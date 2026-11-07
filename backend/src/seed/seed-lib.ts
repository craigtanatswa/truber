import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { hashPassword } from '../common/crypto';
import { loadEnv } from '../config/env';
import { migrate } from '../db/migrate';
import { qualifyAppSql } from '../db/identifiers';
import { buildPoolConfig } from '../db/pg-config';

export const SEED_CONFIRM = 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION';

export class SeedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusal';
  }
}

export async function runSeed(input: {
  nodeEnv: string;
  confirm: string | undefined;
  email: string;
  password: string | undefined;
}): Promise<{ userId: string; created: boolean }> {
  if (input.nodeEnv === 'production') {
    throw new SeedRefusal('Refusing to seed when NODE_ENV=production');
  }
  if (input.confirm !== SEED_CONFIRM) {
    throw new SeedRefusal(`Set SEED_CONFIRM=${SEED_CONFIRM}`);
  }
  if (!input.password || input.password.length < 8 || input.password.length > 256) {
    throw new SeedRefusal('SEED_ADMIN_PASSWORD is required and must be 8 to 256 characters');
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new SeedRefusal('SEED_ADMIN_EMAIL is not a valid email');
  }

  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env.db, 'migration'));
  const layout = { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA };
  try {
    await migrate(pool, env);
    const existing = await pool.query<{ id: string; role: string }>(
      qualifyAppSql('SELECT id, role FROM users WHERE email = $1', layout),
      [email],
    );
    const row = existing.rows[0];
    if (row && row.role !== 'admin') {
      throw new SeedRefusal('Refusing to escalate an existing non-admin user');
    }
    if (row) {
      return { userId: row.id, created: false };
    }
    const userId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await pool.query(
      qualifyAppSql(
        `INSERT INTO users (
           id, email, password_hash, full_name, phone, city, role, account_status, created_at, updated_at
         ) VALUES ($1, $2, $3, 'Truber seed admin', NULL, NULL, 'admin', 'active', clock_timestamp(), clock_timestamp())`,
        layout,
      ),
      [userId, email, passwordHash],
    );
    return { userId, created: true };
  } finally {
    await pool.end();
  }
}
