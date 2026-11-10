import { randomUUID } from 'crypto';
import { PoolClient, QueryResultRow } from 'pg';
import { ApiException } from './api.exception';

export interface IdempotentResponse<T> {
  status: number;
  body: T;
}

interface IdempotencyRow extends QueryResultRow {
  request_hash: string;
  status_code: number;
  response_body: unknown;
}

export function assertIdempotencyKey(key: string | undefined): void {
  if (key === undefined) return;
  if (!/^[\x21-\x7E]{8,128}$/.test(key)) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { 'Idempotency-Key': 'must be 8 to 128 visible ASCII characters' },
    });
  }
}

export async function readIdempotency<T>(
  client: PoolClient,
  userId: string,
  key: string | undefined,
  operation: string,
  requestHash: string,
): Promise<IdempotentResponse<T> | null> {
  if (!key) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${operation}:${key}`]);
  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, status_code, response_body
     FROM idempotency_records
     WHERE user_id = $1 AND idempotency_key = $2 AND operation = $3`,
    [userId, key, operation],
  );
  const prev = existing.rows[0];
  if (!prev) return null;
  if (prev.request_hash !== requestHash) {
    throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request.');
  }
  return { status: prev.status_code, body: prev.response_body as T };
}

export async function storeIdempotency(
  client: PoolClient,
  userId: string,
  key: string | undefined,
  operation: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (!key) return;
  await client.query(
    `INSERT INTO idempotency_records (
       id, user_id, idempotency_key, operation, request_hash, status_code, response_body, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, clock_timestamp())`,
    [randomUUID(), userId, key, operation, requestHash, status, JSON.stringify(body)],
  );
}
