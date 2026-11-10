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
import { DbUser, UserRole } from '../domain';
import { BookingDirectory } from './booking-directory';
import {
  CreateOffPlatformReportDto,
  ListOffPlatformReportsQueryDto,
  RecordOffPlatformFindingDto,
} from './offplatform.dto';
import { BAN_RETURNING, OffPlatformBanService, presentBan } from './offplatform-ban.service';
import {
  OffPlatformFinding,
  OffPlatformReport,
  OffPlatformResponsibleParty,
} from './offplatform.types';

const REPORT_RETURNING = `
  r.id,
  r.booking_id AS "bookingId",
  r.reported_by_user_id AS "reportedByUserId",
  r.reporter_role AS "reporterRole",
  r.suspected_party AS "suspectedParty",
  r.description,
  r.evidence_uris AS "evidenceUris",
  r.status,
  r.created_at AS "createdAt"
`;

const FINDING_RETURNING = `
  f.id,
  f.report_id AS "reportId",
  f.booking_id AS "bookingId",
  f.outcome,
  f.reason,
  f.responsible_parties AS "responsibleParties",
  f.reviewed_by_user_id AS "reviewedByUserId",
  f.reviewed_at AS "reviewedAt"
`;

@Injectable()
export class OffPlatformReportService {
  constructor(
    private readonly db: DbService,
    private readonly bookingDirectory: BookingDirectory,
    private readonly banService: OffPlatformBanService,
  ) {}

  async create(
    actor: DbUser,
    bookingId: string,
    dto: CreateOffPlatformReportDto,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: OffPlatformReport }> {
    assertIdempotencyKey(idempotencyKey);
    const description = dto.description.trim();
    if (description.length < 10 || description.length > 4000) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { description: 'must be 10 to 4000 characters' },
      });
    }
    const evidenceUris = dto.evidenceUris ?? [];
    const requestHash = sha256(
      JSON.stringify({
        op: 'createOffPlatformReport',
        bookingId,
        suspectedParty: dto.suspectedParty,
        description,
        evidenceUris,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<OffPlatformReport>(
        client,
        actor.id,
        idempotencyKey,
        'createOffPlatformReport',
        requestHash,
      );
      if (replay) return replay;

      const booking = await this.bookingDirectory.findById(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      if (actor.role !== 'admin') {
        const member = await run(
          client,
          'SELECT 1 FROM company_members WHERE user_id = $1 AND company_id = ANY($2::uuid[])',
          [actor.id, [booking.shipperCompanyId, booking.transporterCompanyId]],
        );
        if (!member.rowCount) {
          throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
        }
      }

      const reportId = randomUUID();
      await client.query(
        `INSERT INTO off_platform_reports (
           id, booking_id, reported_by_user_id, reporter_role, suspected_party,
           description, evidence_uris, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'open', clock_timestamp())`,
        [
          reportId,
          bookingId,
          actor.id,
          actor.role,
          dto.suspectedParty,
          description,
          JSON.stringify(evidenceUris),
        ],
      );
      const body = await this.fetchReport(client, reportId);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'createOffPlatformReport',
        requestHash,
        201,
        body,
      );
      return { status: 201, body };
    });
  }

  async list(
    query: ListOffPlatformReportsQueryDto,
  ): Promise<{ data: OffPlatformReport[]; meta: ReturnType<typeof pageMeta> }> {
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
    if (query.status) add('r.status = $?', query.status);
    if (query.bookingId) add('r.booking_id = $?', query.bookingId);
    if (query.companyId) {
      // Known limitation until bookings exist in this codebase: the booking's
      // shipper/transporter companies are not in SQL, so this filter uses the
      // reporter's company membership, finding responsible parties, and applied
      // bans as the closest available approximation of "a party to the booking".
      params.push(query.companyId);
      const companyParam = `$${params.length}`;
      where.push(`(
        EXISTS (
          SELECT 1 FROM company_members cm
          WHERE cm.user_id = r.reported_by_user_id AND cm.company_id = ${companyParam}
        )
        OR EXISTS (
          SELECT 1
          FROM off_platform_findings cf
          CROSS JOIN LATERAL jsonb_array_elements(cf.responsible_parties) AS party
          WHERE cf.report_id = r.id AND party->>'companyId' = ${companyParam}::text
        )
        OR EXISTS (
          SELECT 1
          FROM off_platform_bans cb
          JOIN off_platform_findings cbf ON cbf.id = cb.finding_id
          WHERE cbf.report_id = r.id AND cb.company_id = ${companyParam}
        )
      )`);
    }
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM off_platform_reports r WHERE ${clause}`,
      params,
    );
    const rows = await this.db.query(
      `SELECT ${REPORT_RETURNING}
       FROM off_platform_reports r
       WHERE ${clause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    const data: OffPlatformReport[] = [];
    for (const row of rows.rows) {
      const finding = await this.fetchFinding(this.db, String(row.id));
      data.push(presentReport(row, finding));
    }
    return {
      data,
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async get(reportId: string): Promise<OffPlatformReport> {
    const report = await this.fetchReport(this.db, reportId);
    report.finding = await this.fetchFinding(this.db, reportId);
    return report;
  }

  async recordFinding(
    admin: DbUser,
    reportId: string,
    dto: RecordOffPlatformFindingDto,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: OffPlatformFinding }> {
    assertIdempotencyKey(idempotencyKey);
    const { reason, parties } = this.normalizeFinding(dto);
    const requestHash = sha256(
      JSON.stringify({
        op: 'recordOffPlatformFinding',
        reportId,
        outcome: dto.outcome,
        reason,
        responsibleParties: parties ?? null,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<OffPlatformFinding>(
        client,
        admin.id,
        idempotencyKey,
        'recordOffPlatformFinding',
        requestHash,
      );
      if (replay) return replay;

      const locked = await client.query<{ booking_id: string }>(
        'SELECT booking_id FROM off_platform_reports WHERE id = $1 FOR UPDATE',
        [reportId],
      );
      const report = locked.rows[0];
      if (!report) {
        throw new ApiException(404, 'NOT_FOUND', 'Report not found.');
      }
      const existing = await client.query('SELECT 1 FROM off_platform_findings WHERE report_id = $1', [reportId]);
      if (existing.rowCount) {
        throw new ApiException(409, 'FINDING_ALREADY_RECORDED', 'A finding has already been recorded for this report.');
      }

      const booking = await this.bookingDirectory.findById(client, report.booking_id);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      for (const party of parties) {
        const expectedCompanyId =
          party.role === 'shipper' ? booking.shipperCompanyId : booking.transporterCompanyId;
        if (party.companyId !== expectedCompanyId) {
          throw new ApiException(
            409,
            'RESPONSIBLE_PARTY_MISMATCH',
            'A responsible party does not match the booking.',
          );
        }
        const member = await run(
          client,
          'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
          [party.companyId, party.userId],
        );
        if (!member.rowCount) {
          throw new ApiException(
            409,
            'RESPONSIBLE_PARTY_MISMATCH',
            'A responsible party does not match the booking.',
          );
        }
      }

      const findingId = randomUUID();
      await client.query(
        `INSERT INTO off_platform_findings (
           id, report_id, booking_id, outcome, reason, responsible_parties,
           reviewed_by_user_id, reviewed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
        [
          findingId,
          reportId,
          report.booking_id,
          dto.outcome,
          reason,
          JSON.stringify(parties),
          admin.id,
        ],
      );
      if (dto.outcome === 'confirmed') {
        await this.banService.applyBansForConfirmedFinding(client, {
          findingId,
          reason,
          appliedByUserId: admin.id,
          parties,
        });
      }
      await client.query('UPDATE off_platform_reports SET status = $2 WHERE id = $1', [
        reportId,
        dto.outcome,
      ]);

      const body = await this.fetchFinding(client, reportId);
      if (!body) {
        throw new Error('Recorded finding could not be reloaded');
      }
      await storeIdempotency(
        client,
        admin.id,
        idempotencyKey,
        'recordOffPlatformFinding',
        requestHash,
        201,
        body,
      );
      return { status: 201, body };
    });
  }

  private normalizeFinding(dto: RecordOffPlatformFindingDto): {
    reason: string;
    parties: OffPlatformResponsibleParty[];
  } {
    const reason = dto.reason.trim();
    if (reason.length < 8 || reason.length > 4000) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { reason: 'must be 8 to 4000 characters' },
      });
    }
    const supplied = dto.responsibleParties;
    if (dto.outcome === 'confirmed') {
      if (!supplied || supplied.length < 1 || supplied.length > 2) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
          fields: { responsibleParties: 'is required with 1 or 2 entries when outcome is confirmed' },
        });
      }
      const roles = new Set<string>();
      for (const party of supplied) {
        if (roles.has(party.role)) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
            fields: { responsibleParties: 'must have at most one entry per role' },
          });
        }
        roles.add(party.role);
      }
      return {
        reason,
        parties: supplied.map((party) => ({
          role: party.role,
          userId: party.userId,
          companyId: party.companyId,
        })),
      };
    }
    if (supplied !== undefined) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { responsibleParties: 'must be omitted when outcome is not_confirmed' },
      });
    }
    return { reason, parties: [] };
  }

  private async fetchReport(client: PoolClient | DbService, reportId: string): Promise<OffPlatformReport> {
    const result = await run(client, `SELECT ${REPORT_RETURNING} FROM off_platform_reports r WHERE r.id = $1`, [
      reportId,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Report not found.');
    }
    return presentReport(row);
  }

  private async fetchFinding(
    client: PoolClient | DbService,
    reportId: string,
  ): Promise<OffPlatformFinding | null> {
    const result = await run(
      client,
      `SELECT ${FINDING_RETURNING} FROM off_platform_findings f WHERE f.report_id = $1`,
      [reportId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const bans = await run(
      client,
      `SELECT ${BAN_RETURNING} FROM off_platform_bans WHERE finding_id = $1 ORDER BY created_at ASC, id ASC`,
      [row.id],
    );
    return presentFinding(row, bans.rows.map((ban) => presentBan(ban)));
  }
}

function presentReport(
  row: QueryResultRow,
  finding?: OffPlatformFinding | null,
): OffPlatformReport {
  const report: OffPlatformReport = {
    id: String(row.id),
    bookingId: String(row.bookingId),
    reportedByUserId: String(row.reportedByUserId),
    reporterRole: row.reporterRole as UserRole,
    suspectedParty: row.suspectedParty as OffPlatformReport['suspectedParty'],
    description: String(row.description),
    evidenceUris: Array.isArray(row.evidenceUris) ? row.evidenceUris.map(String) : [],
    status: row.status as OffPlatformReport['status'],
    createdAt: iso(asTimestamp(row.createdAt)),
  };
  if (finding !== undefined) {
    report.finding = finding;
  }
  return report;
}

function presentFinding(row: QueryResultRow, bans: OffPlatformFinding['bans']): OffPlatformFinding {
  return {
    id: String(row.id),
    reportId: String(row.reportId),
    bookingId: String(row.bookingId),
    outcome: row.outcome as OffPlatformFinding['outcome'],
    reason: String(row.reason),
    responsibleParties: parseResponsibleParties(row.responsibleParties),
    reviewedByUserId: String(row.reviewedByUserId),
    reviewedAt: iso(asTimestamp(row.reviewedAt)),
    bans,
  };
}

function parseResponsibleParties(value: unknown): OffPlatformResponsibleParty[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const party = item as Record<string, unknown>;
    return {
      role: party.role as OffPlatformResponsibleParty['role'],
      userId: String(party.userId),
      companyId: String(party.companyId),
    };
  });
}

function asTimestamp(value: unknown): Date | string {
  if (value instanceof Date || typeof value === 'string') return value;
  throw new Error('Expected a timestamp value');
}

function run<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | DbService,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return (client as DbService).query<T>(text, params);
}
