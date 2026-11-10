import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiException } from '../common/api.exception';
import { iso, sha256 } from '../common/crypto';
import { pageMeta, pageWindow } from '../common/http';
import {
  assertIdempotencyKey,
  readIdempotency,
  storeIdempotency,
} from '../common/idempotency';
import { DbService } from '../db/db.service';
import {
  OffPlatformBan,
  OffPlatformBanStatus,
  OffPlatformPartyRole,
} from './offplatform.types';

export interface AssertNotBannedOptions {
  counterpartyCompanyId?: string | null;
  client?: PoolClient;
}

export interface ApplyBansInput {
  findingId: string;
  reason: string;
  appliedByUserId: string;
  parties: { role: OffPlatformPartyRole; userId: string; companyId: string }[];
}

export interface ListOffPlatformBansQuery {
  page?: number;
  pageSize?: number;
  status?: OffPlatformBanStatus;
  userId?: string;
  companyId?: string;
}

type BannedParty = 'caller' | 'caller_company' | 'counterparty_company';

export const BAN_RETURNING = `
  id,
  finding_id AS "findingId",
  user_id AS "userId",
  company_id AS "companyId",
  party_role AS "partyRole",
  CASE
    WHEN lifted_at IS NOT NULL THEN 'lifted'
    WHEN clock_timestamp() >= ends_at THEN 'expired'
    ELSE 'active'
  END AS status,
  starts_at AS "startsAt",
  ends_at AS "endsAt",
  duration_days AS "durationDays",
  reason,
  applied_by_user_id AS "appliedByUserId",
  lifted_at AS "liftedAt",
  lifted_by_user_id AS "liftedByUserId",
  lift_reason AS "liftReason"
`;

@Injectable()
export class OffPlatformBanService {
  constructor(private readonly db: DbService) {}

  async assertNotBanned(
    userId: string,
    companyId: string | null,
    options: AssertNotBannedOptions = {},
  ): Promise<void> {
    const callerCompanyId = companyId;
    const counterpartyCompanyId = options.counterpartyCompanyId ?? null;
    const result = await run<{ bannedUntil: Date | string | null; bannedParty: BannedParty | null }>(
      options.client ?? this.db,
      `WITH server_clock AS (SELECT clock_timestamp() AS at)
       SELECT
         max(ends_at) AS "bannedUntil",
         CASE
           WHEN bool_or(user_id = $1) THEN 'caller'
           WHEN bool_or(company_id = $2) THEN 'caller_company'
           WHEN bool_or(company_id = $3) THEN 'counterparty_company'
         END AS "bannedParty"
       FROM off_platform_bans, server_clock
       WHERE starts_at <= server_clock.at
         AND server_clock.at < ends_at
         AND lifted_at IS NULL
         AND (user_id = $1 OR company_id = $2 OR company_id = $3)`,
      [userId, callerCompanyId, counterpartyCompanyId],
    );
    const row = result.rows[0];
    if (!row || row.bannedUntil == null || !row.bannedParty) {
      return;
    }
    throw new ApiException(
      409,
      'ACCOUNT_BANNED',
      'This account is temporarily banned from new work on Truber.',
      {
        bannedUntil: timestamp(row.bannedUntil),
        bannedParty: row.bannedParty,
      },
    );
  }

  async applyBansForConfirmedFinding(client: PoolClient, input: ApplyBansInput): Promise<OffPlatformBan[]> {
    const bans: OffPlatformBan[] = [];
    for (const party of input.parties) {
      const inserted = await client.query(
        `WITH applied AS (SELECT clock_timestamp() AS starts_at)
         INSERT INTO off_platform_bans (
           id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at,
           duration_days, applied_by_user_id, created_at
         )
         SELECT $1, $2, $3, $4, $5, $6, applied.starts_at,
                applied.starts_at + interval '336 hours', 14, $7, applied.starts_at
         FROM applied
         RETURNING ${BAN_RETURNING}`,
        [
          randomUUID(),
          input.findingId,
          party.userId,
          party.companyId,
          party.role,
          input.reason,
          input.appliedByUserId,
        ],
      );
      bans.push(presentBan(inserted.rows[0]));
    }
    return bans;
  }

  async list(
    query: ListOffPlatformBansQuery,
  ): Promise<{ data: OffPlatformBan[]; meta: ReturnType<typeof pageMeta> }> {
    const window = pageWindow(query.page, query.pageSize);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value?: unknown) => {
      if (value !== undefined) {
        params.push(value);
        where.push(sql.replace(/\$\?/g, `$${params.length}`));
      } else {
        where.push(sql);
      }
    };
    if (query.status) {
      add(
        `CASE
           WHEN lifted_at IS NOT NULL THEN 'lifted'
           WHEN clock_timestamp() >= ends_at THEN 'expired'
           ELSE 'active'
         END = $?`,
        query.status,
      );
    }
    if (query.userId) add('user_id = $?', query.userId);
    if (query.companyId) add('company_id = $?', query.companyId);
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM off_platform_bans WHERE ${clause}`,
      params,
    );
    const rows = await this.db.query(
      `SELECT ${BAN_RETURNING}
       FROM off_platform_bans
       WHERE ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentBan(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async lift(adminId: string, banId: string, liftReason: string): Promise<OffPlatformBan> {
    const result = await this.liftWithIdempotency(adminId, banId, liftReason);
    return result.body;
  }

  async liftWithIdempotency(
    adminId: string,
    banId: string,
    liftReasonInput: string,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: OffPlatformBan }> {
    assertIdempotencyKey(idempotencyKey);
    const liftReason = liftReasonInput.trim();
    if (liftReason.length < 8 || liftReason.length > 4000) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { liftReason: 'must be 8 to 4000 characters' },
      });
    }
    const requestHash = sha256(JSON.stringify({ op: 'liftOffPlatformBan', banId, liftReason }));
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<OffPlatformBan>(
        client,
        adminId,
        idempotencyKey,
        'liftOffPlatformBan',
        requestHash,
      );
      if (replay) return replay;
      const locked = await client.query(
        `SELECT ${BAN_RETURNING} FROM off_platform_bans WHERE id = $1 FOR UPDATE`,
        [banId],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new ApiException(404, 'NOT_FOUND', 'Ban not found.');
      }
      if (current.status !== 'active') {
        throw new ApiException(409, 'BAN_NOT_ACTIVE', 'Only an active ban can be lifted.');
      }
      const updated = await client.query(
        `UPDATE off_platform_bans
         SET lifted_at = clock_timestamp(),
             lifted_by_user_id = $2,
             lift_reason = $3
         WHERE id = $1
         RETURNING ${BAN_RETURNING}`,
        [banId, adminId, liftReason],
      );
      const body = presentBan(updated.rows[0]);
      await storeIdempotency(client, adminId, idempotencyKey, 'liftOffPlatformBan', requestHash, 200, body);
      return { status: 200, body };
    });
  }
}

export function presentBan(row: QueryResultRow): OffPlatformBan {
  return {
    id: String(row.id),
    findingId: String(row.findingId),
    userId: String(row.userId),
    companyId: String(row.companyId),
    partyRole: row.partyRole as OffPlatformPartyRole,
    status: row.status as OffPlatformBanStatus,
    startsAt: timestamp(row.startsAt),
    endsAt: timestamp(row.endsAt),
    durationDays: 14,
    reason: String(row.reason),
    appliedByUserId: String(row.appliedByUserId),
    liftedAt: row.liftedAt == null ? null : timestamp(row.liftedAt),
    liftedByUserId: row.liftedByUserId == null ? null : String(row.liftedByUserId),
    liftReason: row.liftReason == null ? null : String(row.liftReason),
  };
}

function timestamp(value: unknown): string {
  if (value instanceof Date || typeof value === 'string') return iso(value);
  throw new Error('Expected a timestamp value');
}

function run<T extends QueryResultRow>(client: PoolClient | DbService, text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return (client as DbService).query<T>(text, params);
}
