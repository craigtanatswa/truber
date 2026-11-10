import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient, QueryResultRow } from 'pg';
import { ApiException } from '../common/api.exception';
import { sha256 } from '../common/crypto';
import { likeContains, pageMeta, pageWindow } from '../common/http';
import { assertCalendarDate } from '../common/validation';
import { DbService } from '../db/db.service';
import { CANCELLABLE_STATUSES, DbUser, LoadResponse, LoadStatus, TRANSPORTER_VISIBLE_STATUSES } from '../domain';
import { BookingDirectory } from '../offplatform/booking-directory';
import { OffPlatformBanService } from '../offplatform/offplatform-ban.service';
import { LOAD_RETURNING, presentLoad } from '../present';
import { CancelLoadDto, CreateLoadDto, ListLoadsQueryDto, MoneyDto, UpdateLoadDto } from './loads.dto';

@Injectable()
export class LoadsService {
  constructor(
    private readonly db: DbService,
    private readonly bans: OffPlatformBanService,
    private readonly bookingDirectory: BookingDirectory,
  ) {}

  async list(actor: DbUser, query: ListLoadsQueryDto): Promise<{ data: LoadResponse[]; meta: ReturnType<typeof pageMeta> }> {
    if (query.pickupDateFrom) assertCalendarDate(query.pickupDateFrom, 'pickupDateFrom');
    if (query.pickupDateTo) assertCalendarDate(query.pickupDateTo, 'pickupDateTo');
    if (query.pickupDateFrom && query.pickupDateTo && query.pickupDateFrom > query.pickupDateTo) {
      throw new ApiException(400, 'DATE_RANGE_INVALID', 'pickupDateFrom cannot be after pickupDateTo.');
    }
    if (query.minWeightKg != null && query.maxWeightKg != null && query.minWeightKg > query.maxWeightKg) {
      throw new ApiException(400, 'WEIGHT_RANGE_INVALID', 'minWeightKg cannot be greater than maxWeightKg.');
    }
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
    if (actor.role === 'shipper') {
      params.push(actor.id);
      where.push(`l.company_id IN (SELECT company_id FROM company_members WHERE user_id = $${params.length})`);
    } else if (actor.role === 'transporter') {
      where.push(`l.status IN (${TRANSPORTER_VISIBLE_STATUSES.map((status) => `'${status}'`).join(', ')})`);
    }
    if (query.status) add('l.status = $?', query.status);
    if (query.companyId) add('l.company_id = $?', query.companyId);
    if (query.pickupDateFrom) add('l.loading_date >= $?::date', query.pickupDateFrom);
    if (query.pickupDateTo) add('l.loading_date <= $?::date', query.pickupDateTo);
    if (query.truckTypeRequired) add('l.truck_type_required = $?', query.truckTypeRequired);
    if (query.minWeightKg != null) add('l.weight_kg >= $?', query.minWeightKg);
    if (query.maxWeightKg != null) add('l.weight_kg <= $?', query.maxWeightKg);
    if (query.pickupText) add(`l.pickup_address ILIKE $? ESCAPE '\\'`, likeContains(query.pickupText));
    if (query.destinationText) add(`l.destination_address ILIKE $? ESCAPE '\\'`, likeContains(query.destinationText));
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM loads l WHERE ${clause}`, params);
    const rows = await this.db.query(
      `SELECT ${LOAD_RETURNING}
       FROM loads l
       WHERE ${clause}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentLoad(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async create(actor: DbUser, dto: CreateLoadDto): Promise<LoadResponse> {
    if (actor.role !== 'shipper') {
      throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a shipper can create a load.');
    }
    assertCalendarDate(dto.loadingDate, 'loadingDate');
    if (dto.deliveryDeadline) assertCalendarDate(dto.deliveryDeadline, 'deliveryDeadline');
    if (dto.deliveryDeadline && dto.deliveryDeadline < dto.loadingDate) {
      throw new ApiException(400, 'DELIVERY_DEADLINE_BEFORE_LOADING', 'Delivery deadline cannot be before the loading date.');
    }
    this.assertRateCurrency(dto.offeredRate, dto.currency);
    return this.db.tx(async (client) => {
      const company = await client.query<{ id: string; type: string }>('SELECT id, type FROM companies WHERE id = $1', [dto.companyId]);
      if (!company.rows[0]) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      const member = await client.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
        dto.companyId,
        actor.id,
      ]);
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      if (company.rows[0].type !== 'shipper') {
        throw new ApiException(403, 'COMPANY_TYPE_MISMATCH', 'Loads can only be created for a shipper company.');
      }
      // A commission-owing gate would follow here; the ban check must stay first.
      await this.bans.assertNotBanned(actor.id, dto.companyId, { client });
      const inserted = await client.query(
        `INSERT INTO loads (
           id, company_id, created_by, status, goods_type, weight_kg, truck_type_required,
           pickup_address, pickup_geog, destination_address, destination_geog,
           loading_date, delivery_deadline, special_requirements, rate_type,
           offered_amount_minor, offered_currency, currency, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 'draft', $4, $5, $6,
           $7, ${pointSql('$8', '$9')}, $10, ${pointSql('$11', '$12')},
           $13::date, $14::date, $15, $16,
           $17, $18, $19, clock_timestamp(), clock_timestamp()
         )
         RETURNING id`,
        [
          randomUUID(),
          dto.companyId,
          actor.id,
          dto.goodsType.trim(),
          dto.weightKg,
          dto.truckTypeRequired,
          dto.pickupAddress.trim(),
          dto.pickupPoint?.latitude ?? null,
          dto.pickupPoint?.longitude ?? null,
          dto.destinationAddress.trim(),
          dto.destinationPoint?.latitude ?? null,
          dto.destinationPoint?.longitude ?? null,
          dto.loadingDate,
          dto.deliveryDeadline ?? null,
          dto.specialRequirements?.trim() ?? null,
          dto.rateType,
          dto.offeredRate?.amountMinor ?? null,
          dto.offeredRate?.currency ?? null,
          dto.currency,
        ],
      );
      return this.fetchLoad(client, inserted.rows[0].id);
    });
  }

  async get(actor: DbUser, loadId: string): Promise<LoadResponse> {
    const load = await this.fetchLoad(this.db, loadId);
    if (!load) {
      throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
    }
    const visible = await this.canSee(this.db, actor, load.companyId, load.status);
    if (!visible) {
      throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
    }
    return load;
  }

  async update(actor: DbUser, loadId: string, dto: UpdateLoadDto): Promise<LoadResponse> {
    return this.db.tx(async (client) => {
      const current = await this.lockForMutation(client, actor, loadId);
      if (current.status !== 'draft' && current.status !== 'posted') {
        throw new ApiException(409, 'LOAD_NOT_EDITABLE', 'Only a draft or posted load can be updated.');
      }
      const loadingDate = dto.loadingDate ?? current.loadingDate;
      if (dto.loadingDate) assertCalendarDate(dto.loadingDate, 'loadingDate');
      const deadline = dto.deliveryDeadline === undefined ? current.deliveryDeadline : dto.deliveryDeadline;
      if (typeof deadline === 'string') assertCalendarDate(deadline, 'deliveryDeadline');
      if (deadline && deadline < loadingDate) {
        throw new ApiException(400, 'DELIVERY_DEADLINE_BEFORE_LOADING', 'Delivery deadline cannot be before the loading date.');
      }
      if (dto.offeredRate) this.assertRateCurrency(dto.offeredRate, current.currency);

      const sets: string[] = [];
      const params: unknown[] = [];
      const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      if (dto.goodsType !== undefined) sets.push(`goods_type = ${bind(dto.goodsType.trim())}`);
      if (dto.weightKg !== undefined) sets.push(`weight_kg = ${bind(dto.weightKg)}`);
      if (dto.truckTypeRequired !== undefined) sets.push(`truck_type_required = ${bind(dto.truckTypeRequired)}`);
      if (dto.pickupAddress !== undefined) sets.push(`pickup_address = ${bind(dto.pickupAddress.trim())}`);
      if (dto.pickupPoint !== undefined) {
        const lat = bind(dto.pickupPoint?.latitude ?? null);
        const lng = bind(dto.pickupPoint?.longitude ?? null);
        sets.push(`pickup_geog = ${pointSql(lat, lng)}`);
      }
      if (dto.destinationAddress !== undefined) sets.push(`destination_address = ${bind(dto.destinationAddress.trim())}`);
      if (dto.destinationPoint !== undefined) {
        const lat = bind(dto.destinationPoint?.latitude ?? null);
        const lng = bind(dto.destinationPoint?.longitude ?? null);
        sets.push(`destination_geog = ${pointSql(lat, lng)}`);
      }
      if (dto.loadingDate !== undefined) sets.push(`loading_date = ${bind(dto.loadingDate)}::date`);
      if (dto.deliveryDeadline !== undefined) sets.push(`delivery_deadline = ${bind(dto.deliveryDeadline)}::date`);
      if (dto.specialRequirements !== undefined) {
        sets.push(`special_requirements = ${bind(dto.specialRequirements === null ? null : dto.specialRequirements.trim())}`);
      }
      if (dto.rateType !== undefined) sets.push(`rate_type = ${bind(dto.rateType)}`);
      if (dto.offeredRate !== undefined) {
        sets.push(`offered_amount_minor = ${bind(dto.offeredRate?.amountMinor ?? null)}`);
        sets.push(`offered_currency = ${bind(dto.offeredRate?.currency ?? null)}`);
      }
      if (sets.length === 0) {
        return current;
      }
      sets.push('updated_at = clock_timestamp()');
      params.push(loadId);
      await client.query(`UPDATE loads SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      return this.fetchLoad(client, loadId);
    });
  }

  async post(actor: DbUser, loadId: string, idempotencyKey: string | undefined): Promise<{ status: number; body: LoadResponse }> {
    this.assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(JSON.stringify({ op: 'postLoad', loadId }));
    return this.db.tx(async (client) => {
      const replay = await this.readIdempotency(client, actor.id, idempotencyKey, 'postLoad', requestHash);
      if (replay) return replay;
      const current = await this.lockForMutation(client, actor, loadId);
      await this.bans.assertNotBanned(actor.id, current.companyId, { client });
      const account = await client.query<{ account_status: string }>('SELECT account_status FROM users WHERE id = $1', [actor.id]);
      const company = await client.query<{ verification_status: string }>(
        'SELECT verification_status FROM companies WHERE id = $1 FOR SHARE',
        [current.companyId],
      );
      const accountStatus = account.rows[0]?.account_status;
      const companyStatus = company.rows[0]?.verification_status;
      if (accountStatus !== 'active' || companyStatus !== 'verified') {
        throw new ApiException(403, 'VERIFICATION_REQUIRED', 'Verified account and company are required to post a load.', {
          accountStatus: accountStatus ?? 'unknown',
          companyVerificationStatus: companyStatus ?? 'unknown',
        });
      }
      const updated = await client.query(`UPDATE loads SET status = 'posted', updated_at = clock_timestamp() WHERE id = $1 AND status = 'draft'`, [
        loadId,
      ]);
      if (!updated.rowCount) {
        throw new ApiException(409, 'LOAD_NOT_DRAFT', 'Only a draft load can be posted.');
      }
      const body = await this.fetchLoad(client, loadId);
      await this.storeIdempotency(client, actor.id, idempotencyKey, 'postLoad', requestHash, 200, body);
      return { status: 200, body };
    });
  }

  async cancel(
    actor: DbUser,
    loadId: string,
    dto: CancelLoadDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: LoadResponse }> {
    this.assertIdempotencyKey(idempotencyKey);
    const reason = dto.reason?.trim() ? dto.reason.trim() : null;
    const requestHash = sha256(JSON.stringify({ op: 'cancelLoad', loadId, reason }));
    return this.db.tx(async (client) => {
      const replay = await this.readIdempotency(client, actor.id, idempotencyKey, 'cancelLoad', requestHash);
      if (replay) return replay;
      const current = await this.lockForMutation(client, actor, loadId);
      if (current.status === 'cancelled') {
        throw new ApiException(409, 'LOAD_ALREADY_CANCELLED', 'This load is already cancelled.');
      }
      const booking = await this.bookingDirectory.findActiveForLoad(client, loadId);
      if (booking) {
        if (actor.role === 'admin') {
          throw new ApiException(
            409,
            'ADMIN_CANCEL_VIA_BOOKING',
            'Record this cancellation on the booking with an audited reason (cancelBooking).',
          );
        }
        throw new ApiException(
          409,
          'SELF_CANCEL_NOT_ALLOWED',
          'This booking can only be cancelled by Truber admin. Contact support.',
          { bookingId: booking.bookingId, bookingStatus: booking.status },
        );
      }
      if (!CANCELLABLE_STATUSES.includes(current.status)) {
        throw new ApiException(409, 'LOAD_CANCEL_BLOCKED', 'This load can no longer be cancelled on this endpoint.');
      }
      const updated = await client.query(
        `UPDATE loads
         SET status = 'cancelled', cancel_reason = $2, updated_at = clock_timestamp()
         WHERE id = $1 AND status = ANY($3::text[])`,
        [loadId, reason, CANCELLABLE_STATUSES],
      );
      if (!updated.rowCount) {
        throw new ApiException(409, 'LOAD_CANCEL_BLOCKED', 'This load can no longer be cancelled on this endpoint.');
      }
      const body = await this.fetchLoad(client, loadId);
      await this.storeIdempotency(client, actor.id, idempotencyKey, 'cancelLoad', requestHash, 200, body);
      return { status: 200, body };
    });
  }

  private assertRateCurrency(rate: MoneyDto | undefined, currency: string): void {
    if (!rate) return;
    if (rate.currency !== currency) {
      throw new ApiException(400, 'CURRENCY_MISMATCH', 'Offered rate currency must match the load currency.');
    }
  }

  private assertIdempotencyKey(key: string | undefined): void {
    if (key === undefined) return;
    if (!/^[\x21-\x7E]{8,128}$/.test(key)) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { 'Idempotency-Key': 'must be 8 to 128 visible ASCII characters' },
      });
    }
  }

  private async readIdempotency(
    client: PoolClient,
    userId: string,
    key: string | undefined,
    operation: string,
    requestHash: string,
  ): Promise<{ status: number; body: LoadResponse } | null> {
    if (!key) return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${operation}:${key}`]);
    const existing = await client.query<{ request_hash: string; status_code: number; response_body: LoadResponse }>(
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
    return { status: prev.status_code, body: prev.response_body };
  }

  private async storeIdempotency(
    client: PoolClient,
    userId: string,
    key: string | undefined,
    operation: string,
    requestHash: string,
    status: number,
    body: LoadResponse,
  ): Promise<void> {
    if (!key) return;
    await client.query(
      `INSERT INTO idempotency_records (
         id, user_id, idempotency_key, operation, request_hash, status_code, response_body, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, clock_timestamp())`,
      [randomUUID(), userId, key, operation, requestHash, status, JSON.stringify(body)],
    );
  }

  private async lockForMutation(client: PoolClient, actor: DbUser, loadId: string): Promise<LoadResponse> {
    const locked = await client.query(`SELECT id FROM loads WHERE id = $1 FOR UPDATE`, [loadId]);
    if (!locked.rowCount) {
      throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
    }
    const load = await this.fetchLoad(client, loadId);
    await this.assertCanMutate(client, actor, load.companyId, load.status);
    return load;
  }

  private async assertCanMutate(client: PoolClient | DbService, actor: DbUser, companyId: string, status: LoadStatus): Promise<void> {
    if (actor.role === 'admin') return;
    const member = await run(client, 'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, actor.id]);
    if (member.rowCount && actor.role === 'shipper') return;
    if (actor.role === 'transporter' && TRANSPORTER_VISIBLE_STATUSES.includes(status)) {
      throw new ApiException(403, 'FORBIDDEN', 'You cannot modify this load.');
    }
    throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
  }

  private async canSee(client: PoolClient | DbService, actor: DbUser, companyId: string, status: LoadStatus): Promise<boolean> {
    if (actor.role === 'admin') return true;
    const member = await run(client, 'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, actor.id]);
    if (member.rowCount) return true;
    return actor.role === 'transporter' && TRANSPORTER_VISIBLE_STATUSES.includes(status);
  }

  private async fetchLoad(client: PoolClient | DbService, loadId: string): Promise<LoadResponse> {
    const result = await run(client, `SELECT ${LOAD_RETURNING} FROM loads l WHERE l.id = $1`, [loadId]);
    if (!result.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
    }
    return presentLoad(result.rows[0]);
  }
}

function run(client: PoolClient | DbService, text: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[]; rowCount: number | null }> {
  return (client as DbService).query(text, params);
}

function pointSql(latParam: string, lngParam: string): string {
  return `CASE WHEN ${latParam}::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(${lngParam}::float8, ${latParam}::float8), 4326)::geography END`;
}
