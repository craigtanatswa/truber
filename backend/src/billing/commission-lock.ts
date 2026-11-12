import { PoolClient } from 'pg';

export const COMMISSION_LOCK_NAMESPACE = 'truber:commission:';

// 64-bit hash; a collision only makes two companies wait on each other (never
// a correctness issue). Xact-scoped locks release at COMMIT/ROLLBACK, so
// callers must be inside a transaction.
export async function lockCommissionExclusive(client: PoolClient, companyId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    COMMISSION_LOCK_NAMESPACE + companyId,
  ]);
}

// Shared holders do not block each other.
export async function lockCommissionShared(client: PoolClient, companyId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [
    COMMISSION_LOCK_NAMESPACE + companyId,
  ]);
}
