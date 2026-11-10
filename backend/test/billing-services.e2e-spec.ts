import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommissionGateService, COMMISSION_OUTSTANDING_MESSAGE } from '../src/billing/commission-gate.service';
import { Money } from '../src/billing/money';
import { NoopPaymentProvider, PAYMENT_PROVIDER, PaymentProvider } from '../src/billing/payment-provider';
import { CommissionReceivable, ReceivablesService } from '../src/billing/receivables.service';
import { PaymentMethod } from '../src/billing/commission';
import { ApiException } from '../src/common/api.exception';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { DbUser } from '../src/domain';
import { assertSchema } from './contract';
import { truncate } from './helpers';
import { prepareTestDatabase } from './prepare-db';

describe('billing receivable services', () => {
  let app: INestApplication;
  let db: DbService;
  let receivables: ReceivablesService;
  let gate: CommissionGateService;
  let actor: DbUser;
  let companyId: string;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
    db = app.get(DbService);
    receivables = app.get(ReceivablesService);
    gate = app.get(CommissionGateService);
    actor = await insertActor(db);
    companyId = await insertCompany(db);
  });

  async function gateCheck(): Promise<void> {
    return db.tx((client) => gate.assertCanTakeNewWork(client, companyId));
  }

  async function collect(input: {
    amount: Money;
    externalReference?: string;
    notes?: string;
  }) {
    return receivables.recordCollectionForAdmin(actor, companyId, input, `collection-${randomUUID()}`);
  }

  async function recognise(input: {
    trip: Money;
    paymentMethod?: PaymentMethod;
    completedAt?: Date;
    bookingId?: string;
  }): Promise<{ bookingId: string; receivable: CommissionReceivable }> {
    const bookingId = input.bookingId ?? randomUUID();
    const receivable = await receivables.recognise(null, {
      bookingId,
      transporterCompanyId: companyId,
      tripAmount: input.trip,
      paymentMethod: input.paymentMethod ?? 'prepay',
      completedAt: input.completedAt,
    });
    return { bookingId, receivable };
  }

  it('passes the gate when nothing is owed', async () => {
    await expect(gateCheck()).resolves.toBeUndefined();
  });

  it('blocks new work in one currency with the pinned CommissionOutstandingError body', async () => {
    const recognised = await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    expect(recognised.receivable.amount).toEqual({ amountMinor: 5000, currency: 'USD' });
    expect(recognised.receivable.status).toBe('open');

    const error = await capture(gateCheck());
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('COMMISSION_OUTSTANDING');
    expect(error.message).toBe(COMMISSION_OUTSTANDING_MESSAGE);
    expect(error.details).toEqual({
      outstandingAmount: { amountMinor: 5000, currency: 'USD' },
      outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
    });

    const body = {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: 'test',
    };
    assertSchema('CommissionOutstandingError', body);
    expect(body).toEqual({
      code: 'COMMISSION_OUTSTANDING',
      message: 'Outstanding commission must be settled before taking new work.',
      details: {
        outstandingAmount: { amountMinor: 5000, currency: 'USD' },
        outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
      },
      requestId: 'test',
    });
  });

  it('omits outstandingAmount when owing spans two currencies', async () => {
    await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    await recognise({ trip: { amountMinor: 200000, currency: 'ZWG' } });

    const error = await capture(gateCheck());
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('COMMISSION_OUTSTANDING');
    expect(error.details).toEqual({
      outstandingByCurrency: [
        { amountMinor: 5000, currency: 'USD' },
        { amountMinor: 10000, currency: 'ZWG' },
      ],
    });
    expect(error.details && 'outstandingAmount' in error.details).toBe(false);

    const body = { code: error.code, message: error.message, details: error.details, requestId: 'test' };
    assertSchema('CommissionOutstandingError', body);
  });

  it('applies a collection oldest-first and leaves other currencies untouched', async () => {
    const first = await recognise({
      trip: { amountMinor: 20000, currency: 'USD' },
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await recognise({
      trip: { amountMinor: 40000, currency: 'USD' },
      completedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const third = await recognise({
      trip: { amountMinor: 60000, currency: 'USD' },
      completedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    const zwg = await recognise({
      trip: { amountMinor: 50000, currency: 'ZWG' },
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const record = await collect({
      amount: { amountMinor: 2500, currency: 'USD' },
      externalReference: 'BANK-001',
      notes: 'Partial collection',
    });
    assertSchema('CommissionCollectionRecord', record);
    expect(record.companyId).toBe(companyId);
    expect(record.amount).toEqual({ amountMinor: 2500, currency: 'USD' });
    expect(record.outstandingAmountAfter).toEqual({ amountMinor: 3500, currency: 'USD' });
    expect(record.outstandingByCurrencyAfter).toEqual([
      { amountMinor: 3500, currency: 'USD' },
      { amountMinor: 2500, currency: 'ZWG' },
    ]);
    expect(record.externalReference).toBe('BANK-001');
    expect(record.notes).toBe('Partial collection');
    expect(record.fundsMovementClaimedByTruber).toBe(false);
    expect(record.recordedByUserId).toBe(actor.id);

    const account = await receivables.account(companyId);
    const byBooking = new Map(account.receivables.map((row) => [row.bookingId, row]));
    expect(byBooking.get(first.bookingId)).toMatchObject({
      status: 'collected',
      collectedAmount: { amountMinor: 1000, currency: 'USD' },
      remainingAmount: { amountMinor: 0, currency: 'USD' },
    });
    expect(byBooking.get(second.bookingId)).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 1500, currency: 'USD' },
      remainingAmount: { amountMinor: 500, currency: 'USD' },
    });
    expect(byBooking.get(third.bookingId)).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 0, currency: 'USD' },
      remainingAmount: { amountMinor: 3000, currency: 'USD' },
    });
    expect(byBooking.get(zwg.bookingId)).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 0, currency: 'ZWG' },
      remainingAmount: { amountMinor: 2500, currency: 'ZWG' },
    });

    const allocations = await db.query<{ amount_minor: string }>(
      `SELECT amount_minor FROM commission_collection_allocations ORDER BY amount_minor`,
    );
    expect(allocations.rows.map((row) => Number(row.amount_minor))).toEqual([1000, 1500]);
  });

  it('rejects a collection that exceeds outstanding without changing anything', async () => {
    await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });

    const exceeds = await capture(
      collect({ amount: { amountMinor: 5001, currency: 'USD' } }),
    );
    expect(exceeds.getStatus()).toBe(409);
    expect(exceeds.code).toBe('COLLECTION_EXCEEDS_OUTSTANDING');
    expect(exceeds.message).toBe('Collection exceeds the outstanding commission in that currency.');
    expect(exceeds.details).toEqual({ outstandingAmount: { amountMinor: 5000, currency: 'USD' } });

    const noOwing = await capture(
      collect({ amount: { amountMinor: 1, currency: 'ZWG' } }),
    );
    expect(noOwing.getStatus()).toBe(409);
    expect(noOwing.code).toBe('COLLECTION_EXCEEDS_OUTSTANDING');

    const account = await receivables.account(companyId);
    expect(account.outstandingByCurrency).toEqual([{ amountMinor: 5000, currency: 'USD' }]);
    expect(account.receivables[0]).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 0, currency: 'USD' },
      remainingAmount: { amountMinor: 5000, currency: 'USD' },
    });
    const collections = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM commission_collections`);
    expect(collections.rows[0].count).toBe('0');
  });

  it('clears owing and unblocks the gate once every currency is collected', async () => {
    await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    await recognise({ trip: { amountMinor: 50000, currency: 'ZWG' } });

    const usd = await collect({
      amount: { amountMinor: 5000, currency: 'USD' },
    });
    expect(usd.outstandingAmountAfter).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(usd.outstandingByCurrencyAfter).toEqual([{ amountMinor: 2500, currency: 'ZWG' }]);
    await expect(gateCheck()).rejects.toBeInstanceOf(ApiException);

    const zwg = await collect({
      amount: { amountMinor: 2500, currency: 'ZWG' },
    });
    expect(zwg.outstandingByCurrencyAfter).toEqual([]);
    await expect(gateCheck()).resolves.toBeUndefined();
  });

  it('voids an open receivable and keeps previously collected amounts when voiding a partial one', async () => {
    const open = await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    const voided = await receivables.voidForBooking(null, open.bookingId);
    expect(voided.status).toBe('voided');
    expect(voided.remainingAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(voided.collectedAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    await expect(gateCheck()).resolves.toBeUndefined();

    const partial = await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    await collect({
      amount: { amountMinor: 2000, currency: 'USD' },
    });
    const partialVoid = await receivables.voidForBooking(null, partial.bookingId);
    expect(partialVoid.status).toBe('voided');
    expect(partialVoid.remainingAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(partialVoid.collectedAmount).toEqual({ amountMinor: 2000, currency: 'USD' });

    const account = await receivables.account(companyId);
    expect(account.outstandingByCurrency).toEqual([]);
    await expect(gateCheck()).resolves.toBeUndefined();
  });

  it('records zero commission as already collected and never blocks', async () => {
    const zero = await recognise({ trip: { amountMinor: 9, currency: 'USD' } });
    expect(zero.receivable.amount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(zero.receivable.collectedAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(zero.receivable.remainingAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(zero.receivable.status).toBe('collected');
    expect(zero.receivable.settledAt).not.toBeNull();
    await expect(gateCheck()).resolves.toBeUndefined();
  });

  it('rejects a duplicate recognition and allows re-recognition after voiding', async () => {
    const bookingId = randomUUID();
    const first = await recognise({ trip: { amountMinor: 20000, currency: 'USD' }, bookingId });
    const duplicate = await capture(
      receivables.recognise(null, {
        bookingId,
        transporterCompanyId: companyId,
        tripAmount: { amountMinor: 20000, currency: 'USD' },
        paymentMethod: 'prepay',
      }),
    );
    expect(duplicate.getStatus()).toBe(409);
    expect(duplicate.code).toBe('COMMISSION_ALREADY_RECOGNISED');
    expect(duplicate.message).toBe('Commission for this booking is already recognised.');

    await receivables.voidForBooking(null, bookingId);
    const again = await receivables.recognise(null, {
      bookingId,
      transporterCompanyId: companyId,
      tripAmount: { amountMinor: 20000, currency: 'USD' },
      paymentMethod: 'prepay',
    });
    expect(again.id).not.toBe(first.receivable.id);
    expect(again.status).toBe('open');
  });

  it('settles non-cash commission on release but rejects cash', async () => {
    const prepay = await recognise({
      trip: { amountMinor: 100000, currency: 'USD' },
      paymentMethod: 'prepay',
    });
    const settled = await receivables.settleOnRelease(null, prepay.bookingId);
    expect(settled.status).toBe('settled_on_release');
    expect(settled.remainingAmount).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(settled.settledAt).not.toBeNull();

    const notOpen = await capture(receivables.settleOnRelease(null, prepay.bookingId));
    expect(notOpen.getStatus()).toBe(409);
    expect(notOpen.code).toBe('RECEIVABLE_NOT_OPEN');

    const cash = await recognise({
      trip: { amountMinor: 100000, currency: 'USD' },
      paymentMethod: 'cash',
    });
    const cashError = await capture(receivables.settleOnRelease(null, cash.bookingId));
    expect(cashError.getStatus()).toBe(409);
    expect(cashError.code).toBe('CASH_COMMISSION_NOT_SETTLED_BY_RELEASE');
    expect(cashError.message).toBe('Cash commission stays owing until collected.');

    const account = await receivables.account(companyId);
    const cashRow = account.receivables.find((row) => row.bookingId === cash.bookingId);
    expect(cashRow).toMatchObject({ status: 'open', paymentMethod: 'cash' });
  });

  it('presents the commission account with outstandingAmount only for a single currency', async () => {
    const empty = await receivables.account(companyId);
    assertSchema('CommissionAccount', empty);
    expect(empty).toEqual({ companyId, outstandingByCurrency: [], receivables: [] });
    expect('outstandingAmount' in empty).toBe(false);

    await recognise({ trip: { amountMinor: 100000, currency: 'USD' } });
    const single = await receivables.account(companyId);
    assertSchema('CommissionAccount', single);
    expect(single.outstandingAmount).toEqual({ amountMinor: 5000, currency: 'USD' });
    expect(single.outstandingByCurrency).toEqual([{ amountMinor: 5000, currency: 'USD' }]);

    await recognise({ trip: { amountMinor: 200000, currency: 'ZWG' } });
    const multiple = await receivables.account(companyId);
    assertSchema('CommissionAccount', multiple);
    expect('outstandingAmount' in multiple).toBe(false);
    expect(multiple.outstandingByCurrency).toEqual([
      { amountMinor: 5000, currency: 'USD' },
      { amountMinor: 10000, currency: 'ZWG' },
    ]);
    expect(multiple.receivables).toHaveLength(2);
  });

  it('exposes a records-only noop payment provider', () => {
    const provider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    expect(provider).toBeInstanceOf(NoopPaymentProvider);
    expect(provider.name).toBe('noop');
    expect(provider.describe()).toEqual({ live: false, movesFunds: false });
  });
});

async function capture(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ApiException');
}

async function insertActor(db: DbService): Promise<DbUser> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, account_status, created_at, updated_at)
     VALUES ($1, $2, 'test-hash', 'Billing Ops', 'admin', 'active', now(), now())`,
    [id, `${id}@example.com`],
  );
  const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] as DbUser;
}

async function insertCompany(db: DbService): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO companies (id, type, legal_name, verification_status, created_at, updated_at)
     VALUES ($1, 'transporter', 'Billing Carrier', 'verified', now(), now())`,
    [id],
  );
  return id;
}
