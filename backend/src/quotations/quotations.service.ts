import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiException, isPgError } from '../common/api.exception';
import { sha256 } from '../common/crypto';
import { pageMeta, pageWindow } from '../common/http';
import {
  assertIdempotencyKey,
  readIdempotency,
  storeIdempotency,
} from '../common/idempotency';
import { DbService } from '../db/db.service';
import {
  AcceptQuotationResponse,
  DbUser,
  LoadStatus,
  QuotationResponse,
  QuotationStatus,
  TRANSPORTER_VISIBLE_STATUSES,
} from '../domain';
import { BOOKING_RETURNING, presentBooking } from '../bookings/booking.presenter';
import { OffPlatformBanService } from '../offplatform/offplatform-ban.service';
import { QUOTATION_RETURNING, presentQuotation } from '../present';
import { NewWorkCommissionGate } from './commission-gate';
import { AcceptQuotationDto, CreateQuotationDto, ListQuotationsQueryDto } from './quotations.dto';
import { TruckQuoteCheck } from './truck-quote-check';

interface LoadRecord {
  id: string;
  companyId: string;
  status: LoadStatus;
  currency: string;
}

interface QuotationRecord {
  id: string;
  loadId: string;
  transporterCompanyId: string;
  submittedByUserId: string;
  truckId: string | null;
  amountMinor: number;
  currency: string;
  notes: string | null;
  status: QuotationStatus;
  validUntil: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface BookingRecord {
  id: string;
  status: 'pending_payment_arrangement' | 'confirmed' | 'cancelled';
}

const LOAD_RECORD = `
  l.id,
  l.company_id AS "companyId",
  l.status,
  l.currency
`;

const QUOTATION_RECORD = `
  ${QUOTATION_RETURNING},
  q.submitted_by_user_id AS "submittedByUserId"
`;

@Injectable()
export class QuotationsService {
  constructor(
    private readonly db: DbService,
    private readonly bans: OffPlatformBanService,
    private readonly commissionGate: NewWorkCommissionGate,
    private readonly truckQuoteCheck: TruckQuoteCheck,
  ) {}

  async list(
    actor: DbUser,
    loadId: string,
    query: ListQuotationsQueryDto,
  ): Promise<{ data: QuotationResponse[]; meta: ReturnType<typeof pageMeta> }> {
    const client = this.db;
    const load = await this.fetchLoad(client, loadId);
    if (!load || !(await this.isLoadVisibleForQuotations(client, actor, load))) {
      throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
    }
    const window = pageWindow(query.page, query.pageSize);
    const params: unknown[] = [loadId];
    let clause = 'q.load_id = $1';
    if (actor.role === 'transporter') {
      params.push(actor.id);
      clause += ` AND q.transporter_company_id IN (
        SELECT company_id FROM company_members WHERE user_id = $${params.length}
      )`;
    }
    const total = await run<{ total: number }>(
      client,
      `SELECT count(*)::int AS total FROM quotations q WHERE ${clause}`,
      params,
    );
    const rows = await run(
      client,
      `SELECT ${QUOTATION_RECORD}
       FROM quotations q
       WHERE ${clause}
       ORDER BY q.created_at ASC, q.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentQuotation(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async create(
    actor: DbUser,
    loadId: string,
    dto: CreateQuotationDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: QuotationResponse }> {
    if (actor.role !== 'transporter') {
      throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a transporter can submit a quotation.');
    }
    assertIdempotencyKey(idempotencyKey);
    const notes = normalizeNotes(dto.notes);
    const requestHash = sha256(
      JSON.stringify({
        op: 'createQuotation',
        loadId,
        transporterCompanyId: dto.transporterCompanyId,
        truckId: dto.truckId ?? null,
        amount: { amountMinor: dto.amount.amountMinor, currency: dto.amount.currency },
        notes,
        validUntil: dto.validUntil,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<QuotationResponse>(
        client,
        actor.id,
        idempotencyKey,
        'createQuotation',
        requestHash,
      );
      if (replay) return replay;
      await this.assertValidUntilInFuture(client, dto.validUntil);
      const load = await this.lockLoad(client, loadId);
      if (!load || !TRANSPORTER_VISIBLE_STATUSES.includes(load.status)) {
        throw new ApiException(404, 'NOT_FOUND', 'Load not found.');
      }

      const company = await run<{ id: string; type: string; verificationStatus: string }>(
        client,
        `SELECT id, type, verification_status AS "verificationStatus"
         FROM companies
         WHERE id = $1`,
        [dto.transporterCompanyId],
      );
      const companyRow = company.rows[0];
      if (!companyRow || !(await this.isMember(client, dto.transporterCompanyId, actor.id))) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      if (companyRow.type !== 'transporter') {
        throw new ApiException(403, 'COMPANY_TYPE_MISMATCH', 'Quotations can only be submitted by a transporter company.');
      }

      const account = await run<{ accountStatus: string }>(
        client,
        'SELECT account_status AS "accountStatus" FROM users WHERE id = $1',
        [actor.id],
      );
      const accountStatus = account.rows[0]?.accountStatus;
      const companyVerificationStatus = companyRow.verificationStatus;
      if (accountStatus !== 'active' || companyVerificationStatus !== 'verified') {
        throw new ApiException(
          403,
          'VERIFICATION_REQUIRED',
          'Verified account and company are required to submit a quotation.',
          {
            accountStatus: accountStatus ?? 'unknown',
            companyVerificationStatus: companyVerificationStatus ?? 'unknown',
          },
        );
      }

      if (dto.truckId) {
        await this.truckQuoteCheck.assertTruckUsableForQuote(client, dto.transporterCompanyId, dto.truckId);
      }

      await this.bans.assertNotBanned(actor.id, dto.transporterCompanyId, { client });
      await this.commissionGate.assertCanTakeNewWork(client, dto.transporterCompanyId);

      if (dto.amount.currency !== load.currency) {
        throw new ApiException(400, 'CURRENCY_MISMATCH', 'Quotation currency must match the load currency.');
      }

      await this.sweepExpiredForLoad(client, loadId);
      if (load.status !== 'posted' && load.status !== 'quoting') {
        throw new ApiException(409, 'LOAD_NOT_OPEN_FOR_QUOTES', 'This load is not open for quotations.');
      }

      const existing = await run(
        client,
        `SELECT 1 FROM quotations
         WHERE load_id = $1 AND transporter_company_id = $2 AND status = 'submitted'`,
        [loadId, dto.transporterCompanyId],
      );
      if (existing.rowCount) {
        throw new ApiException(409, 'QUOTATION_ALREADY_OPEN', 'An open quotation already exists for this company on this load.');
      }

      const quotationId = randomUUID();
      try {
        await client.query(
          `INSERT INTO quotations (
             id, load_id, transporter_company_id, submitted_by_user_id, truck_id,
             amount_minor, currency, notes, status, valid_until, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, 'submitted', $9::timestamptz, clock_timestamp(), clock_timestamp()
           )`,
          [
            quotationId,
            loadId,
            dto.transporterCompanyId,
            actor.id,
            dto.truckId ?? null,
            dto.amount.amountMinor,
            dto.amount.currency,
            notes,
            dto.validUntil,
          ],
        );
      } catch (error) {
        if (isPgError(error) && error.code === '23505') {
          throw new ApiException(409, 'QUOTATION_ALREADY_OPEN', 'An open quotation already exists for this company on this load.');
        }
        throw error;
      }

      if (load.status === 'posted') {
        await client.query(
          `UPDATE loads SET status = 'quoting', updated_at = clock_timestamp() WHERE id = $1`,
          [loadId],
        );
      }

      const body = await this.fetchQuotation(client, quotationId);
      await storeIdempotency(client, actor.id, idempotencyKey, 'createQuotation', requestHash, 201, body);
      return { status: 201, body };
    });
  }

  async get(actor: DbUser, quotationId: string): Promise<QuotationResponse> {
    const quotation = await this.fetchQuotationRecord(this.db, quotationId);
    if (!quotation) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
    }
    const load = await this.fetchLoad(this.db, quotation.loadId);
    if (!load || !(await this.canSeeQuotation(this.db, actor, quotation, load))) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
    }
    return presentQuotation(quotation);
  }

  async withdraw(
    actor: DbUser,
    quotationId: string,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: QuotationResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(JSON.stringify({ op: 'withdrawQuotation', quotationId }));
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<QuotationResponse>(
        client,
        actor.id,
        idempotencyKey,
        'withdrawQuotation',
        requestHash,
      );
      if (replay) return replay;

      // Lock order matches accept and create: load row first, then the quotation.
      const located = await run<{ loadId: string }>(
        client,
        'SELECT load_id AS "loadId" FROM quotations WHERE id = $1',
        [quotationId],
      );
      if (!located.rows[0]) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      const load = await this.lockLoad(client, located.rows[0].loadId);
      const locked = await this.lockQuotation(client, quotationId);
      if (!locked) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      if (!load || !(await this.canSeeQuotation(client, actor, locked, load))) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      if (actor.role !== 'transporter' || !(await this.isMember(client, locked.transporterCompanyId, actor.id))) {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the transporter can withdraw a quotation.');
      }

      await this.sweepExpiredForLoad(client, locked.loadId);
      const quotation = await this.fetchQuotationRecord(client, quotationId);
      if (!quotation) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }

      if (quotation.status === 'accepted') {
        const booking = await this.fetchBookingForQuotation(client, quotationId);
        if (booking && booking.status !== 'cancelled') {
          throw new ApiException(
            409,
            'SELF_CANCEL_NOT_ALLOWED',
            'This booking can only be cancelled by Truber admin. Contact support.',
            { bookingId: booking.id, bookingStatus: booking.status },
          );
        }
        throw new ApiException(409, 'QUOTATION_NOT_WITHDRAWABLE', 'This quotation can no longer be withdrawn.', {
          status: quotation.status,
        });
      }
      if (quotation.status !== 'submitted') {
        throw new ApiException(409, 'QUOTATION_NOT_WITHDRAWABLE', 'This quotation can no longer be withdrawn.', {
          status: quotation.status,
        });
      }

      await client.query(
        `UPDATE quotations
         SET status = 'withdrawn', withdrawn_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1`,
        [quotationId],
      );
      const body = await this.fetchQuotation(client, quotationId);
      await storeIdempotency(client, actor.id, idempotencyKey, 'withdrawQuotation', requestHash, 200, body);
      return { status: 200, body };
    });
  }

  async accept(
    actor: DbUser,
    quotationId: string,
    dto: AcceptQuotationDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: AcceptQuotationResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const acceptNotes = normalizeNotes(dto.notes);
    const requestHash = sha256(JSON.stringify({ op: 'acceptQuotation', quotationId, notes: acceptNotes }));
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<AcceptQuotationResponse>(
        client,
        actor.id,
        idempotencyKey,
        'acceptQuotation',
        requestHash,
      );
      if (replay) return replay;

      const located = await run<{ loadId: string }>(
        client,
        'SELECT load_id AS "loadId" FROM quotations WHERE id = $1',
        [quotationId],
      );
      if (!located.rows[0]) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      const load = await this.lockLoad(client, located.rows[0].loadId);
      const locked = await this.lockQuotation(client, quotationId);
      if (!load || !locked) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      if (!(await this.canSeeQuotation(client, actor, locked, load))) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      if (actor.role !== 'shipper' || !(await this.isMember(client, load.companyId, actor.id))) {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the shipper who owns the load can accept a quotation.');
      }

      await this.sweepExpiredForLoad(client, load.id);
      const quotation = await this.fetchQuotationRecord(client, quotationId);
      if (!quotation) {
        throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
      }
      if (quotation.status === 'expired') {
        throw new ApiException(409, 'QUOTATION_EXPIRED', 'This quotation has expired.');
      }
      if (quotation.status !== 'submitted') {
        throw new ApiException(409, 'QUOTATION_NOT_ACCEPTABLE', 'This quotation is not open for acceptance.', {
          status: quotation.status,
        });
      }
      if (load.status !== 'posted' && load.status !== 'quoting') {
        throw new ApiException(409, 'LOAD_NOT_OPEN_FOR_QUOTES', 'This load is not open for quotations.');
      }

      const activeBooking = await run(
        client,
        `SELECT 1 FROM bookings WHERE load_id = $1 AND status <> 'cancelled' LIMIT 1`,
        [load.id],
      );
      if (activeBooking.rowCount) {
        throw new ApiException(409, 'BOOKING_ALREADY_EXISTS', 'An active booking already exists for this load.');
      }

      await this.bans.assertNotBanned(actor.id, load.companyId, {
        client,
        counterpartyCompanyId: quotation.transporterCompanyId,
        counterpartyUserId: quotation.submittedByUserId,
      });
      await this.commissionGate.assertCanTakeNewWork(client, quotation.transporterCompanyId);

      await client.query(
        `UPDATE quotations
         SET status = 'not_selected', updated_at = clock_timestamp()
         WHERE load_id = $1 AND id <> $2 AND status = 'submitted'`,
        [load.id, quotationId],
      );
      await client.query(
        `UPDATE quotations
         SET status = 'accepted', accepted_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1`,
        [quotationId],
      );

      const bookingId = randomUUID();
      await client.query(
        `INSERT INTO bookings (
           id, load_id, quotation_id, shipper_company_id, transporter_company_id, truck_id,
           status, trip_status, completion_status, agreed_amount_minor, currency,
           commission_rate_bps, confirmed_payment_arrangement_id, confirmed_at,
           accept_notes, created_by_user_id, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           'pending_payment_arrangement', 'not_started', 'not_complete', $7, $8,
           500, NULL, NULL,
           $9, $10, clock_timestamp(), clock_timestamp()
         )`,
        [
          bookingId,
          load.id,
          quotationId,
          load.companyId,
          quotation.transporterCompanyId,
          quotation.truckId,
          quotation.amountMinor,
          quotation.currency,
          acceptNotes,
          actor.id,
        ],
      );
      await client.query(
        `UPDATE loads SET status = 'booking_pending', updated_at = clock_timestamp() WHERE id = $1`,
        [load.id],
      );

      const quotationBody = await this.fetchQuotation(client, quotationId);
      const bookingResult = await run(
        client,
        `SELECT ${BOOKING_RETURNING} FROM bookings b WHERE b.id = $1`,
        [bookingId],
      );
      const body: AcceptQuotationResponse = {
        quotation: quotationBody,
        booking: presentBooking(bookingResult.rows[0]),
      };
      await storeIdempotency(client, actor.id, idempotencyKey, 'acceptQuotation', requestHash, 201, body);
      return { status: 201, body };
    });
  }

  private async assertValidUntilInFuture(client: PoolClient, validUntil: string): Promise<void> {
    let future = false;
    try {
      const result = await client.query<{ future: boolean }>(
        'SELECT $1::timestamptz > clock_timestamp() AS future',
        [validUntil],
      );
      future = result.rows[0]?.future === true;
    } catch {
      future = false;
    }
    if (!future) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { validUntil: 'must be in the future' },
      });
    }
  }

  private async lockLoad(client: PoolClient, loadId: string): Promise<LoadRecord | null> {
    const result = await run<LoadRecord>(
      client,
      `SELECT ${LOAD_RECORD} FROM loads l WHERE l.id = $1 FOR UPDATE`,
      [loadId],
    );
    return result.rows[0] ?? null;
  }

  private async fetchLoad(client: PoolClient | DbService, loadId: string): Promise<LoadRecord | null> {
    const result = await run<LoadRecord>(client, `SELECT ${LOAD_RECORD} FROM loads l WHERE l.id = $1`, [loadId]);
    return result.rows[0] ?? null;
  }

  private async lockQuotation(client: PoolClient, quotationId: string): Promise<QuotationRecord | null> {
    const result = await run<QuotationRecord>(
      client,
      `SELECT ${QUOTATION_RECORD} FROM quotations q WHERE q.id = $1 FOR UPDATE`,
      [quotationId],
    );
    return result.rows[0] ?? null;
  }

  private async fetchQuotationRecord(
    client: PoolClient | DbService,
    quotationId: string,
  ): Promise<QuotationRecord | null> {
    const result = await run<QuotationRecord>(
      client,
      `SELECT ${QUOTATION_RECORD} FROM quotations q WHERE q.id = $1`,
      [quotationId],
    );
    return result.rows[0] ?? null;
  }

  private async fetchQuotation(client: PoolClient, quotationId: string): Promise<QuotationResponse> {
    const record = await this.fetchQuotationRecord(client, quotationId);
    if (!record) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found.');
    }
    return presentQuotation(record);
  }

  private async fetchBookingForQuotation(client: PoolClient, quotationId: string): Promise<BookingRecord | null> {
    const result = await run<BookingRecord>(
      client,
      `SELECT id, status FROM bookings WHERE quotation_id = $1`,
      [quotationId],
    );
    return result.rows[0] ?? null;
  }

  private async sweepExpiredForLoad(client: PoolClient, loadId: string): Promise<void> {
    await client.query(
      `UPDATE quotations
       SET status = 'expired', updated_at = clock_timestamp()
       WHERE load_id = $1 AND status = 'submitted' AND valid_until <= clock_timestamp()`,
      [loadId],
    );
  }

  private async isLoadVisibleForQuotations(
    client: PoolClient | DbService,
    actor: DbUser,
    load: LoadRecord,
  ): Promise<boolean> {
    if (actor.role === 'admin') return true;
    if (actor.role === 'shipper') {
      return this.isMember(client, load.companyId, actor.id);
    }
    return TRANSPORTER_VISIBLE_STATUSES.includes(load.status);
  }

  private async canSeeQuotation(
    client: PoolClient | DbService,
    actor: DbUser,
    quotation: QuotationRecord,
    load: LoadRecord,
  ): Promise<boolean> {
    if (actor.role === 'admin') return true;
    if (actor.role === 'shipper') {
      return this.isMember(client, load.companyId, actor.id);
    }
    if (!TRANSPORTER_VISIBLE_STATUSES.includes(load.status)) {
      return false;
    }
    return this.isMember(client, quotation.transporterCompanyId, actor.id);
  }

  private async isMember(
    client: PoolClient | DbService,
    companyId: string,
    userId: string,
  ): Promise<boolean> {
    const member = await run(
      client,
      'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
      [companyId, userId],
    );
    return Boolean(member.rowCount);
  }
}

function normalizeNotes(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function run<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | DbService,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return (client as DbService).query<T>(text, params);
}
