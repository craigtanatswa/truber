import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiException, isPgError } from '../common/api.exception';
import { iso, sha256 } from '../common/crypto';
import { DbService } from '../db/db.service';
import { DbUser } from '../domain';
import { commissionFor, PaymentMethod } from './commission';
import { assertMoney, minorFromDb, Money } from './money';

export type CommissionReceivableStatus = 'open' | 'settled_on_release' | 'collected' | 'voided';

export interface CommissionReceivable {
  id: string;
  bookingId: string;
  transporterCompanyId: string;
  amount: Money;
  collectedAmount: Money;
  remainingAmount: Money;
  status: CommissionReceivableStatus;
  recognisedAt: string;
  settledAt: string | null;
  paymentMethod: PaymentMethod | null;
}

export interface CommissionAccount {
  companyId: string;
  outstandingByCurrency: Money[];
  outstandingAmount?: Money;
  receivables: CommissionReceivable[];
}

export interface CommissionCollectionRecord {
  id: string;
  companyId: string;
  amount: Money;
  outstandingAmountAfter: Money;
  outstandingByCurrencyAfter: Money[];
  externalReference: string | null;
  notes: string | null;
  fundsMovementClaimedByTruber: false;
  recordedAt: string;
  recordedByUserId: string;
}

export interface RecogniseReceivableInput {
  bookingId: string;
  transporterCompanyId: string;
  tripAmount: Money;
  paymentMethod: PaymentMethod;
  completedAt?: Date;
}

export interface RecordCollectionInput {
  amount: Money;
  externalReference?: string;
  notes?: string;
}

interface ReceivableRow extends QueryResultRow {
  id: string;
  booking_id: string;
  transporter_company_id: string;
  currency: string;
  amount_minor: string | number;
  collected_minor: string | number;
  remaining_minor: string | number;
  status: CommissionReceivableStatus;
  recognised_at: Date | string;
  settled_at: Date | string | null;
  payment_method: PaymentMethod | null;
}

interface OpenReceivableRow extends QueryResultRow {
  id: string;
  collected_minor: string | number;
  remaining_minor: string | number;
}

interface OutstandingRow extends QueryResultRow {
  currency: string;
  total_minor: string | number;
}

function safeMinor(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`Amount ${value.toString()} is not a safe integer`);
  }
  return converted;
}

export function presentCommissionReceivable(row: ReceivableRow): CommissionReceivable {
  const currency = String(row.currency);
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    transporterCompanyId: String(row.transporter_company_id),
    amount: { amountMinor: minorFromDb(row.amount_minor), currency },
    collectedAmount: { amountMinor: minorFromDb(row.collected_minor), currency },
    remainingAmount: { amountMinor: minorFromDb(row.remaining_minor), currency },
    status: row.status,
    recognisedAt: iso(row.recognised_at),
    settledAt: row.settled_at == null ? null : iso(row.settled_at),
    paymentMethod: row.payment_method ?? null,
  };
}

@Injectable()
export class ReceivablesService {
  constructor(private readonly db: DbService) {}

  async recognise(client: PoolClient | null, input: RecogniseReceivableInput): Promise<CommissionReceivable> {
    const amount = commissionFor(input.tripAmount);
    const recognisedAt = input.completedAt ?? new Date();
    const isZero = amount.amountMinor === 0;
    const status: CommissionReceivableStatus = isZero ? 'collected' : 'open';
    const id = randomUUID();

    try {
      const result = await this.query<ReceivableRow>(
        client,
        `INSERT INTO commission_receivables (
           id, booking_id, transporter_company_id, currency, amount_minor, collected_minor,
           remaining_minor, status, payment_method, recognised_at, settled_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $9, $9)
         RETURNING *`,
        [
          id,
          input.bookingId,
          input.transporterCompanyId,
          amount.currency,
          amount.amountMinor,
          isZero ? 0 : amount.amountMinor,
          status,
          input.paymentMethod,
          recognisedAt,
          isZero ? recognisedAt : null,
        ],
      );
      return presentCommissionReceivable(result.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === '23505') {
        throw new ApiException(
          409,
          'COMMISSION_ALREADY_RECOGNISED',
          'Commission for this booking is already recognised.',
        );
      }
      throw error;
    }
  }

  async voidForBooking(client: PoolClient | null, bookingId: string): Promise<CommissionReceivable> {
    const result = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET status = 'voided',
              remaining_minor = 0,
              voided_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE booking_id = $1
          AND status <> 'voided'
        RETURNING *`,
      [bookingId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    return presentCommissionReceivable(row);
  }

  async settleOnRelease(client: PoolClient | null, bookingId: string): Promise<CommissionReceivable> {
    const updated = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET status = 'settled_on_release',
              remaining_minor = 0,
              settled_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE booking_id = $1
          AND status = 'open'
          AND payment_method IS DISTINCT FROM 'cash'
        RETURNING *`,
      [bookingId],
    );
    const row = updated.rows[0];
    if (row) {
      return presentCommissionReceivable(row);
    }

    const existing = await this.query<{ status: CommissionReceivableStatus; payment_method: PaymentMethod | null }>(
      client,
      `SELECT status, payment_method
         FROM commission_receivables
        WHERE booking_id = $1
          AND status <> 'voided'
        ORDER BY recognised_at DESC, id DESC
        LIMIT 1`,
      [bookingId],
    );
    const receivable = existing.rows[0];
    if (!receivable) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    if (receivable.payment_method === 'cash') {
      throw new ApiException(
        409,
        'CASH_COMMISSION_NOT_SETTLED_BY_RELEASE',
        'Cash commission stays owing until collected.',
      );
    }
    throw new ApiException(409, 'RECEIVABLE_NOT_OPEN', 'Commission receivable is not open.');
  }

  async outstandingByCurrency(client: PoolClient | null, companyId: string): Promise<Money[]> {
    const result = await this.query<OutstandingRow>(
      client,
      `SELECT currency, sum(remaining_minor) AS total_minor
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND status = 'open'
          AND remaining_minor > 0
        GROUP BY currency
        ORDER BY currency`,
      [companyId],
    );
    return result.rows.map((row) => ({
      amountMinor: minorFromDb(row.total_minor),
      currency: String(row.currency),
    }));
  }

  async account(companyId: string): Promise<CommissionAccount> {
    const outstandingByCurrency = await this.outstandingByCurrency(null, companyId);
    const result = await this.query<ReceivableRow>(
      null,
      `SELECT *
         FROM commission_receivables
        WHERE transporter_company_id = $1
        ORDER BY recognised_at ASC, id ASC`,
      [companyId],
    );
    const account: CommissionAccount = {
      companyId,
      outstandingByCurrency,
      receivables: result.rows.map((row) => presentCommissionReceivable(row)),
    };
    if (outstandingByCurrency.length === 1) {
      account.outstandingAmount = outstandingByCurrency[0];
    }
    return account;
  }

  async recordCollection(
    actor: DbUser,
    companyId: string,
    input: RecordCollectionInput,
    client: PoolClient | null = null,
  ): Promise<CommissionCollectionRecord> {
    const amount = assertMoney(input.amount);
    if (client) {
      return this.applyCollection(client, actor, companyId, amount, input);
    }
    return this.db.tx((tx) => this.applyCollection(tx, actor, companyId, amount, input));
  }

  async accountFor(actor: DbUser, companyId: string): Promise<CommissionAccount> {
    const company = await this.db.query<{ id: string }>('SELECT id FROM companies WHERE id = $1', [companyId]);
    if (!company.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      const member = await this.db.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
        companyId,
        actor.id,
      ]);
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }
    return this.account(companyId);
  }

  async recordCollectionForAdmin(
    actor: DbUser,
    companyId: string,
    input: RecordCollectionInput,
    idempotencyKey: string | undefined,
  ): Promise<CommissionCollectionRecord> {
    if (actor.role !== 'admin') {
      throw new ApiException(403, 'ADMIN_ONLY', 'Only an admin can record commission collections.');
    }
    this.assertCollectionIdempotencyKey(idempotencyKey);
    const requestHash = sha256(canonicalJson({ companyId, body: input }));
    return this.db.tx(async (client) => {
      const company = await client.query<{ id: string; type: string }>(
        'SELECT id, type FROM companies WHERE id = $1',
        [companyId],
      );
      if (!company.rows[0] || company.rows[0].type !== 'transporter') {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      const replay = await this.readIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'recordCommissionCollection',
        requestHash,
      );
      if (replay) {
        return replay;
      }
      const body = await this.recordCollection(actor, companyId, input, client);
      await this.storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'recordCommissionCollection',
        requestHash,
        body,
      );
      return body;
    });
  }

  private async applyCollection(
    client: PoolClient,
    actor: DbUser,
    companyId: string,
    amount: Money,
    input: RecordCollectionInput,
  ): Promise<CommissionCollectionRecord> {
    const currency = amount.currency;
    const rows = await this.query<OpenReceivableRow>(
      client,
      `SELECT id, collected_minor, remaining_minor
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND currency = $2
          AND status = 'open'
          AND remaining_minor > 0
        ORDER BY recognised_at ASC, id ASC
        FOR UPDATE`,
      [companyId, currency],
    );

    let outstanding = 0n;
    for (const row of rows.rows) {
      outstanding += BigInt(minorFromDb(row.remaining_minor));
    }

    let left = BigInt(amount.amountMinor);
    if (left > outstanding) {
      throw new ApiException(
        409,
        'COLLECTION_EXCEEDS_OUTSTANDING',
        'Collection exceeds the outstanding commission in that currency.',
        { outstandingAmount: { amountMinor: safeMinor(outstanding), currency } },
      );
    }

    const recordedAt = new Date();
    const collectionId = randomUUID();
    const allocations: { receivableId: string; amountMinor: number }[] = [];

    for (const row of rows.rows) {
      if (left <= 0n) {
        break;
      }
      const remaining = BigInt(minorFromDb(row.remaining_minor));
      const collected = BigInt(minorFromDb(row.collected_minor));
      const applied = remaining < left ? remaining : left;
      if (applied <= 0n) {
        continue;
      }
      const newRemaining = remaining - applied;
      const newCollected = collected + applied;
      await this.query(
        client,
        `UPDATE commission_receivables
            SET collected_minor = $2,
                remaining_minor = $3,
                status = $4,
                settled_at = $5,
                updated_at = $6
          WHERE id = $1`,
        [
          row.id,
          safeMinor(newCollected),
          safeMinor(newRemaining),
          newRemaining === 0n ? 'collected' : 'open',
          newRemaining === 0n ? recordedAt : null,
          recordedAt,
        ],
      );
      allocations.push({ receivableId: row.id, amountMinor: safeMinor(applied) });
      left -= applied;
    }

    await this.query(
      client,
      `INSERT INTO commission_collections (
         id, company_id, currency, amount_minor, external_reference, notes, recorded_by, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        collectionId,
        companyId,
        currency,
        amount.amountMinor,
        input.externalReference ?? null,
        input.notes ?? null,
        actor.id,
        recordedAt,
      ],
    );

    for (const allocation of allocations) {
      await this.query(
        client,
        `INSERT INTO commission_collection_allocations (collection_id, receivable_id, amount_minor)
         VALUES ($1, $2, $3)`,
        [collectionId, allocation.receivableId, allocation.amountMinor],
      );
    }

    const outstandingByCurrencyAfter = await this.outstandingByCurrency(client, companyId);
    const outstandingAmountAfter =
      outstandingByCurrencyAfter.find((entry) => entry.currency === currency) ?? {
        amountMinor: 0,
        currency,
      };

    return {
      id: collectionId,
      companyId,
      amount,
      outstandingAmountAfter,
      outstandingByCurrencyAfter,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
      fundsMovementClaimedByTruber: false,
      recordedAt: iso(recordedAt),
      recordedByUserId: actor.id,
    };
  }

  private assertCollectionIdempotencyKey(key: string | undefined): void {
    if (key === undefined) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { 'Idempotency-Key': 'required' },
      });
    }
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
  ): Promise<CommissionCollectionRecord | null> {
    if (!key) return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${operation}:${key}`]);
    const existing = await client.query<{
      request_hash: string;
      response_body: CommissionCollectionRecord;
    }>(
      `SELECT request_hash, response_body
         FROM idempotency_records
        WHERE user_id = $1 AND idempotency_key = $2 AND operation = $3`,
      [userId, key, operation],
    );
    const prev = existing.rows[0];
    if (!prev) return null;
    if (prev.request_hash !== requestHash) {
      throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request.');
    }
    return prev.response_body;
  }

  private async storeIdempotency(
    client: PoolClient,
    userId: string,
    key: string | undefined,
    operation: string,
    requestHash: string,
    body: CommissionCollectionRecord,
  ): Promise<void> {
    if (!key) return;
    await client.query(
      `INSERT INTO idempotency_records (
         id, user_id, idempotency_key, operation, request_hash, status_code, response_body, created_at
       ) VALUES ($1, $2, $3, $4, $5, 201, $6::jsonb, clock_timestamp())`,
      [randomUUID(), userId, key, operation, requestHash, JSON.stringify(body)],
    );
  }

  private query<T extends QueryResultRow = QueryResultRow>(
    client: PoolClient | null,
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    if (client) {
      return client.query<T>(text, params);
    }
    return this.db.query<T>(text, params);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
