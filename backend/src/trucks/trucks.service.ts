import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException, isPgError } from '../common/api.exception';
import { pageMeta, pageWindow } from '../common/http';
import { assertCalendarDate } from '../common/validation';
import { DbService } from '../db/db.service';
import { DbUser, TruckResponse, VerificationStatus } from '../domain';
import { presentTruck } from '../present';
import { assertTruckUsableForQuote as assertUsableForQuote } from './truck-usability';
import { CreateTruckDto, ListTrucksQueryDto, UpdateTruckDto } from './trucks.dto';

const TRUCK_COLUMNS = `
  id, company_id, registration_number, truck_type, capacity_kg,
  trailer_specs, insurance_reference, current_location_text,
  verification_status, created_at, updated_at
`;

function counterpartyRestrictionSql(callerParam: number, revealParam: number): string {
  return `
    CASE
      WHEN $${revealParam} AND NOT EXISTS (
        SELECT 1
        FROM company_members cm
        WHERE cm.company_id = trucks.company_id
          AND cm.user_id = $${callerParam}
      ) THEN (
        SELECT max(b.ends_at)
        FROM off_platform_bans b
        WHERE b.company_id = trucks.company_id
          AND b.lifted_at IS NULL
          AND b.starts_at <= clock_timestamp()
          AND clock_timestamp() < b.ends_at
      )
    END AS counterparty_restricted_until`;
}

export function normalizeRegistrationNumber(raw: string): string {
  const normalized = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: {
        registrationNumber: 'must contain at least one character other than spaces and hyphens',
      },
    });
  }
  return normalized;
}

@Injectable()
export class TrucksService {
  constructor(private readonly db: DbService) {}

  async list(
    actor: DbUser,
    query: ListTrucksQueryDto,
  ): Promise<{ data: TruckResponse[]; meta: ReturnType<typeof pageMeta> }> {
    if (query.availableOn) assertCalendarDate(query.availableOn, 'availableOn');
    const window = pageWindow(query.page, query.pageSize);
    const where: string[] = [];
    const params: unknown[] = [];
    if (actor.role === 'shipper') {
      where.push(`verification_status = 'verified'`);
    } else if (actor.role === 'transporter') {
      params.push(actor.id);
      where.push(
        `company_id IN (SELECT company_id FROM company_members WHERE user_id = $${params.length})`,
      );
    }
    if (query.companyId) {
      params.push(query.companyId);
      where.push(`company_id = $${params.length}`);
    }
    if (query.truckType) {
      params.push(query.truckType);
      where.push(`truck_type = $${params.length}`);
    }
    if (query.verificationStatus) {
      params.push(query.verificationStatus);
      where.push(`verification_status = $${params.length}`);
    }
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM trucks WHERE ${clause}`,
      params,
    );
    const restrictionSql = counterpartyRestrictionSql(params.length + 1, params.length + 2);
    const rows = await this.db.query(
      `SELECT ${TRUCK_COLUMNS}, ${restrictionSql}
       FROM trucks
       WHERE ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 3} OFFSET $${params.length + 4}`,
      [...params, actor.id, actor.role !== 'admin', window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentTruck(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async create(actor: DbUser, dto: CreateTruckDto): Promise<TruckResponse> {
    if (actor.role === 'shipper') {
      throw new ApiException(403, 'FORBIDDEN', 'Only a transporter member or an admin can register a truck.');
    }
    const company = await this.db.query<{ id: string; type: string }>(
      'SELECT id, type FROM companies WHERE id = $1',
      [dto.companyId],
    );
    const companyRow = company.rows[0];
    if (actor.role !== 'admin') {
      const member = companyRow
        ? await this.db.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
            dto.companyId,
            actor.id,
          ])
        : null;
      if (!companyRow || !member?.rowCount) {
        throw new ApiException(403, 'FORBIDDEN', 'Not a member of this company.');
      }
    } else if (!companyRow) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { companyId: 'company not found' },
      });
    }
    if (companyRow.type !== 'transporter') {
      throw new ApiException(403, 'COMPANY_NOT_TRANSPORTER', 'Only a transporter company can register trucks.');
    }
    const registrationNumber = normalizeRegistrationNumber(dto.registrationNumber);
    try {
      const inserted = await this.db.query(
        `INSERT INTO trucks (
           id, company_id, created_by, registration_number, truck_type, capacity_kg,
           trailer_specs, insurance_reference, current_location_text, verification_status,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, 'unverified', clock_timestamp(), clock_timestamp()
         ) RETURNING ${TRUCK_COLUMNS}, NULL::timestamptz AS counterparty_restricted_until`,
        [
          randomUUID(),
          dto.companyId,
          actor.id,
          registrationNumber,
          dto.truckType,
          dto.capacityKg,
          blankToNull(dto.trailerSpecs),
          blankToNull(dto.insuranceReference),
          blankToNull(dto.currentLocationText),
        ],
      );
      return presentTruck(inserted.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === '23505') {
        throw new ApiException(
          409,
          'TRUCK_REGISTRATION_EXISTS',
          'A truck with this registration number is already registered.',
        );
      }
      throw error;
    }
  }

  async get(actor: DbUser, truckId: string): Promise<TruckResponse> {
    const result = await this.db.query(
      `SELECT ${TRUCK_COLUMNS}, ${counterpartyRestrictionSql(2, 3)} FROM trucks WHERE id = $1`,
      [truckId, actor.id, actor.role !== 'admin'],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Truck not found.');
    }
    if (actor.role !== 'admin') {
      const member = await this.db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [row.company_id, actor.id],
      );
      if (!member.rowCount) {
        if (actor.role !== 'shipper' || row.verification_status !== 'verified') {
          throw new ApiException(404, 'NOT_FOUND', 'Truck not found.');
        }
      }
    }
    return presentTruck(row);
  }

  async update(actor: DbUser, truckId: string, dto: UpdateTruckDto): Promise<TruckResponse> {
    if (dto.verificationStatus !== undefined && actor.role !== 'admin') {
      throw new ApiException(403, 'VERIFICATION_ADMIN_ONLY', 'Only an admin can change verification status.');
    }
    return this.db.tx(async (client) => {
      const locked = await client.query(
        `SELECT ${TRUCK_COLUMNS}, NULL::timestamptz AS counterparty_restricted_until
         FROM trucks WHERE id = $1 FOR UPDATE`,
        [truckId],
      );
      const existing = locked.rows[0];
      if (!existing) {
        throw new ApiException(404, 'NOT_FOUND', 'Truck not found.');
      }
      if (actor.role !== 'admin') {
        const member = await client.query(
          'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
          [existing.company_id, actor.id],
        );
        if (!member.rowCount) {
          if (actor.role === 'shipper' && existing.verification_status === 'verified') {
            throw new ApiException(
              403,
              'FORBIDDEN',
              'Only the owning transporter or an admin can update this truck.',
            );
          }
          throw new ApiException(404, 'NOT_FOUND', 'Truck not found.');
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.truckType !== undefined) assign('truck_type', dto.truckType);
      if (dto.capacityKg !== undefined) assign('capacity_kg', dto.capacityKg);
      if (dto.trailerSpecs !== undefined) assign('trailer_specs', blankToNull(dto.trailerSpecs));
      if (dto.insuranceReference !== undefined) {
        assign('insurance_reference', blankToNull(dto.insuranceReference));
      }
      if (dto.currentLocationText !== undefined) {
        assign('current_location_text', blankToNull(dto.currentLocationText));
      }
      if (dto.verificationStatus !== undefined) {
        assign('verification_status', dto.verificationStatus satisfies VerificationStatus);
      } else if (
        existing.verification_status === 'verified' &&
        ((dto.truckType !== undefined && dto.truckType !== existing.truck_type) ||
          (dto.capacityKg !== undefined && dto.capacityKg !== Number(existing.capacity_kg)))
      ) {
        assign('verification_status', 'pending' satisfies VerificationStatus);
      }
      if (sets.length === 0) {
        return presentTruck(existing);
      }
      sets.push('updated_at = clock_timestamp()');
      params.push(truckId);
      const updated = await client.query(
        `UPDATE trucks SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${TRUCK_COLUMNS}, NULL::timestamptz AS counterparty_restricted_until`,
        params,
      );
      return presentTruck(updated.rows[0]);
    });
  }

  async assertTruckUsableForQuote(
    companyId: string,
    truckId: string | null | undefined,
    client?: PoolClient,
  ): Promise<void> {
    return assertUsableForQuote(client ?? this.db, companyId, truckId);
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
