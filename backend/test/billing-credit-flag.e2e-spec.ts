import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommissionGateService } from '../src/billing/commission-gate.service';
import { ReceivablesService } from '../src/billing/receivables.service';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { DbUser } from '../src/domain';
import { truncate } from './helpers';
import { prepareTestDatabase } from './prepare-db';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function money(amountMinor: number, currency = 'USD') {
  return { amountMinor, currency };
}

interface RawReceivable {
  id: string;
  status: string;
  remaining_minor: string;
  credit_applied_minor: string;
}

interface ScenarioResult {
  afterAdjustB: RawReceivable;
  afterAdjustCredit: { amountMinor: number; currency: string }[];
  afterC: {
    b: RawReceivable;
    c: RawReceivable;
    credit: { amountMinor: number; currency: string }[];
  };
}

async function loadReceivable(db: DbService, id: string): Promise<RawReceivable> {
  const result = await db.query<RawReceivable>(
    'SELECT * FROM commission_receivables WHERE id = $1',
    [id],
  );
  return result.rows[0];
}

async function runScenario(flag: 'true' | 'false'): Promise<ScenarioResult> {
  const previous = process.env.BILLING_CREDIT_OFFSETS_EXISTING;
  process.env.BILLING_CREDIT_OFFSETS_EXISTING = flag;
  let app: INestApplication | undefined;
  try {
    await truncate();
    app = await createApp({ logger: false });
    const db = app.get(DbService);
    const receivables = app.get(ReceivablesService);
    const admin = await insertUser(db);
    const companyId = await insertCompany(db);

    const tripA = await receivables.recognise(null, {
      bookingId: randomUUID(),
      transporterCompanyId: companyId,
      tripAmount: money(100000),
      paymentMethod: 'cash',
      completedAt: T0,
    });
    await receivables.recordCollectionForAdmin(
      admin,
      companyId,
      { amount: money(5000) },
      'flag-collection-a',
    );

    const tripB = await receivables.recognise(null, {
      bookingId: randomUUID(),
      transporterCompanyId: companyId,
      tripAmount: money(100000),
      paymentMethod: 'cash',
      completedAt: at(1 * HOUR),
    });

    await receivables.holdForDispute(null, {
      bookingId: tripA.bookingId,
      disputeRef: 'da000000-0000-4000-8000-00000000000a',
      disputedAt: at(2 * HOUR),
    });
    await receivables.recordDisputeResponse(null, {
      bookingId: tripA.bookingId,
      disputeRef: 'da000000-0000-4000-8000-00000000000a',
      respondedAt: at(3 * HOUR),
    });
    await receivables.adjustForResolvedDispute(null, {
      bookingId: tripA.bookingId,
      disputeRef: 'da000000-0000-4000-8000-00000000000a',
      source: 'admin_decision',
      newTripAmount: money(50000),
      reason: 'Half the load was rejected',
      actorUserId: admin.id,
      decidedAt: at(4 * HOUR),
      idempotencyKey: 'flag-adjust-a',
    });

    const afterAdjustB = await loadReceivable(db, tripB.id);
    const afterAdjustBalances = await receivables.commissionBalances(null, companyId);

    const tripC = await receivables.recognise(null, {
      bookingId: randomUUID(),
      transporterCompanyId: companyId,
      tripAmount: money(40000),
      paymentMethod: 'cash',
      completedAt: at(5 * HOUR),
    });

    return {
      afterAdjustB,
      afterAdjustCredit: afterAdjustBalances.creditByCurrency,
      afterC: {
        b: await loadReceivable(db, tripB.id),
        c: await loadReceivable(db, tripC.id),
        credit: (await receivables.commissionBalances(null, companyId)).creditByCurrency,
      },
    };
  } finally {
    if (app) {
      await app.close();
    }
    if (previous === undefined) {
      delete process.env.BILLING_CREDIT_OFFSETS_EXISTING;
    } else {
      process.env.BILLING_CREDIT_OFFSETS_EXISTING = previous;
    }
  }
}

describe('billing credit offsets existing commission (U1)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  it('nets a new credit against already owing commission when the flag is true', async () => {
    const result = await runScenario('true');

    expect(result.afterAdjustB.remaining_minor).toBe('2500');
    expect(result.afterAdjustCredit).toEqual([]);
    expect(result.afterC.b.remaining_minor).toBe('2500');
    expect(result.afterC.c.remaining_minor).toBe('2000');
    expect(result.afterC.credit).toEqual([]);
  });

  it('only offsets commission recognised after the credit when the flag is false', async () => {
    const result = await runScenario('false');

    expect(result.afterAdjustB.remaining_minor).toBe('5000');
    expect(result.afterAdjustCredit).toEqual([money(2500)]);
    expect(result.afterC.b.remaining_minor).toBe('5000');
    expect(result.afterC.c.status).toBe('collected');
    expect(result.afterC.c.remaining_minor).toBe('0');
    expect(result.afterC.c.credit_applied_minor).toBe('2000');
    expect(result.afterC.credit).toEqual([money(500)]);
  });

  it('always lets collection credit pay debt left by a held dispute, even with the flag off', async () => {
    const result = await runHeldCollectionScenario('false', 'finalise');

    expect(result.collection.creditedAmount).toEqual(money(5000));
    expect(result.receivable.status).toBe('collected');
    expect(result.receivable.remaining_minor).toBe('0');
    expect(result.receivable.credit_applied_minor).toBe('5000');
    expect(result.credits).toEqual([
      { amount_minor: '5000', remaining_minor: '0', source_kind: 'collection' },
    ]);
    expect(result.balances.outstandingByCurrency).toEqual([]);
    expect(result.gatePassed).toBe(true);
  });

  it('applies a held collection to an adjustment and leaves the rest as collection credit', async () => {
    const result = await runHeldCollectionScenario('false', 'adjust');

    expect(result.adjustment?.adjustment.newCommission).toEqual(money(3000));
    expect(result.receivable.status).toBe('collected');
    expect(result.receivable.remaining_minor).toBe('0');
    expect(result.receivable.credit_applied_minor).toBe('3000');
    expect(result.credits).toEqual([
      { amount_minor: '5000', remaining_minor: '2000', source_kind: 'collection' },
    ]);
    expect(result.balances.outstandingByCurrency).toEqual([]);
    expect(result.balances.creditByCurrency).toEqual([money(2000)]);
    expect(result.gatePassed).toBe(true);
  });
});

type CollectionResult = Awaited<ReturnType<ReceivablesService['recordCollectionForAdmin']>>;
type AdjustmentResult = Awaited<ReturnType<ReceivablesService['adjustForResolvedDispute']>>;
type Balances = Awaited<ReturnType<ReceivablesService['commissionBalances']>>;

interface RawCredit {
  amount_minor: string;
  remaining_minor: string;
  source_kind: string;
}

interface HeldCollectionResult {
  collection: CollectionResult;
  adjustment?: AdjustmentResult;
  receivable: RawReceivable;
  credits: RawCredit[];
  balances: Balances;
  gatePassed: boolean;
}

async function runHeldCollectionScenario(
  flag: 'true' | 'false',
  afterHold: 'finalise' | 'adjust',
): Promise<HeldCollectionResult> {
  const previous = process.env.BILLING_CREDIT_OFFSETS_EXISTING;
  process.env.BILLING_CREDIT_OFFSETS_EXISTING = flag;
  let app: INestApplication | undefined;
  try {
    await truncate();
    app = await createApp({ logger: false });
    const db = app.get(DbService);
    const receivables = app.get(ReceivablesService);
    const gate = app.get(CommissionGateService);
    const admin = await insertUser(db);
    const companyId = await insertCompany(db);
    const disputeRef = 'da000000-0000-4000-8000-00000000000b';

    const trip = await receivables.recognise(null, {
      bookingId: randomUUID(),
      transporterCompanyId: companyId,
      tripAmount: money(100000),
      paymentMethod: 'cash',
      completedAt: T0,
    });
    await receivables.holdForDispute(null, {
      bookingId: trip.bookingId,
      disputeRef,
      disputedAt: at(1 * HOUR),
    });
    const collection = await receivables.recordCollectionForAdmin(
      admin,
      companyId,
      { amount: money(5000) },
      'held-collection',
    );
    await receivables.recordDisputeResponse(null, {
      bookingId: trip.bookingId,
      disputeRef,
      respondedAt: at(1.5 * HOUR),
    });

    let adjustment: AdjustmentResult | undefined;
    if (afterHold === 'finalise') {
      await receivables.finaliseAfterDispute(null, {
        bookingId: trip.bookingId,
        disputeRef,
        source: 'admin_decision',
        outcomeReason: 'No change after review',
        actorUserId: admin.id,
        at: at(50 * HOUR),
        idempotencyKey: 'held-finalise',
      });
    } else {
      adjustment = await receivables.adjustForResolvedDispute(null, {
        bookingId: trip.bookingId,
        disputeRef,
        source: 'admin_decision',
        newTripAmount: money(60000),
        reason: 'Dispute resolved down to 60000',
        actorUserId: admin.id,
        decidedAt: at(2 * HOUR),
        idempotencyKey: 'held-adjust',
      });
    }

    const credits = await db.query<RawCredit>(
      `SELECT amount_minor, remaining_minor, source_kind
         FROM commission_credits
        ORDER BY created_at, id`,
    );
    let gatePassed = true;
    try {
      await db.tx((client) => gate.assertCanTakeNewWork(client, companyId));
    } catch {
      gatePassed = false;
    }

    return {
      collection,
      adjustment,
      receivable: await loadReceivable(db, trip.id),
      credits: credits.rows,
      balances: await receivables.commissionBalances(null, companyId),
      gatePassed,
    };
  } finally {
    if (app) {
      await app.close();
    }
    if (previous === undefined) {
      delete process.env.BILLING_CREDIT_OFFSETS_EXISTING;
    } else {
      process.env.BILLING_CREDIT_OFFSETS_EXISTING = previous;
    }
  }
}

async function insertUser(db: DbService): Promise<DbUser> {
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
