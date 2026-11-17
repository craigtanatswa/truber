import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommissionGateService } from '../src/billing/commission-gate.service';
import { PaymentMethod } from '../src/billing/commission';
import { DisputeSource, finalAtFor, ReceivablesService } from '../src/billing/receivables.service';
import { ApiException } from '../src/common/api.exception';
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

async function expectReject(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

interface RawReceivable {
  id: string;
  booking_id: string;
  status: string;
  amount_minor: string;
  collected_minor: string;
  remaining_minor: string;
  reduced_minor: string;
  credit_applied_minor: string;
  trip_minor: string | null;
  dispute_window_ends_at: Date;
  dispute_ref: string | null;
  disputed_at: Date | null;
  response_deadline_at: Date | null;
  transporter_responded_at: Date | null;
  final_at: Date | null;
  pre_hold_status: string | null;
}

interface RawCredit {
  id: string;
  amount_minor: string;
  remaining_minor: string;
  source_kind: string;
  source_adjustment_id: string | null;
  source_receivable_id: string | null;
}

describe('billing disputes and adjustments', () => {
  let app: INestApplication;
  let db: DbService;
  let receivables: ReceivablesService;
  let gate: CommissionGateService;
  let admin: DbUser;
  let transporterId: string;
  let shipperId: string;
  let transporterUser: DbUser;
  let shipperUser: DbUser;
  let outsider: DbUser;

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
    admin = await insertUser(db, 'admin');
    transporterUser = await insertUser(db, 'transporter');
    shipperUser = await insertUser(db, 'shipper');
    outsider = await insertUser(db, 'transporter');
    transporterId = await insertCompany(db, 'transporter');
    shipperId = await insertCompany(db, 'shipper');
    await addMember(db, transporterId, transporterUser.id);
    await addMember(db, shipperId, shipperUser.id);
  });

  async function gateCheck(): Promise<void> {
    return db.tx((client) => gate.assertCanTakeNewWork(client, transporterId));
  }

  async function recognise(options: {
    trip?: number;
    currency?: string;
    completedAt?: Date;
    method?: PaymentMethod;
    bookingId?: string;
  } = {}) {
    const bookingId = options.bookingId ?? randomUUID();
    const receivable = await receivables.recognise(null, {
      bookingId,
      transporterCompanyId: transporterId,
      tripAmount: money(options.trip ?? 100000, options.currency ?? 'USD'),
      paymentMethod: options.method ?? 'prepay',
      completedAt: options.completedAt ?? T0,
    });
    return { bookingId, receivable };
  }

  async function hold(
    bookingId: string,
    options: { disputeRef?: string; disputedAt?: Date } = {},
  ) {
    return receivables.holdForDispute(null, {
      bookingId,
      disputeRef: options.disputeRef ?? 'd1000000-0000-4000-8000-000000000001',
      disputedAt: options.disputedAt ?? at(HOUR),
    });
  }

  async function respond(bookingId: string, respondedAt = at(1.5 * HOUR), disputeRef = 'd1000000-0000-4000-8000-000000000001') {
    return receivables.recordDisputeResponse(null, { bookingId, disputeRef, respondedAt });
  }

  async function finalise(options: {
    bookingId: string;
    disputeRef?: string;
    source?: DisputeSource;
    outcomeReason?: string;
    at?: Date;
    idempotencyKey?: string;
  }) {
    return receivables.finaliseAfterDispute(null, {
      bookingId: options.bookingId,
      disputeRef: options.disputeRef ?? 'd1000000-0000-4000-8000-000000000001',
      source: options.source ?? 'admin_decision',
      outcomeReason: options.outcomeReason ?? 'No change after review',
      actorUserId: admin.id,
      at: options.at ?? at(50 * HOUR),
      idempotencyKey: options.idempotencyKey ?? `finalise-${randomUUID()}`,
    });
  }

  async function adjust(options: {
    bookingId: string;
    disputeRef?: string | null;
    newTripMinor?: number;
    currency?: string;
    source?: DisputeSource;
    reason?: string;
    decidedAt?: Date;
    idempotencyKey?: string;
    shipperCompanyId?: string;
    shipperAgreedBy?: string;
    transporterAgreedBy?: string;
    disputedAt?: Date;
    transporterRespondedAt?: Date;
  }) {
    return receivables.adjustForResolvedDispute(null, {
      bookingId: options.bookingId,
      disputeRef:
        options.disputeRef === null ? undefined : options.disputeRef ?? 'd1000000-0000-4000-8000-000000000001',
      source: options.source ?? 'admin_decision',
      newTripAmount: money(options.newTripMinor ?? 50000, options.currency ?? 'USD'),
      reason: options.reason ?? 'Resolved dispute',
      actorUserId: admin.id,
      decidedAt: options.decidedAt ?? at(50 * HOUR),
      idempotencyKey: options.idempotencyKey ?? `adjust-${randomUUID()}`,
      shipperCompanyId: options.shipperCompanyId,
      shipperAgreedBy: options.shipperAgreedBy,
      transporterAgreedBy: options.transporterAgreedBy,
      disputedAt: options.disputedAt,
      transporterRespondedAt: options.transporterRespondedAt,
    });
  }

  async function collect(amountMinor: number, currency = 'USD') {
    return receivables.recordCollectionForAdmin(
      admin,
      transporterId,
      { amount: money(amountMinor, currency) },
      `collection-${randomUUID()}`,
    );
  }

  async function balances() {
    return receivables.commissionBalances(null, transporterId);
  }

  async function rawReceivable(id: string): Promise<RawReceivable> {
    const result = await db.query<RawReceivable>(
      'SELECT * FROM commission_receivables WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async function credits(): Promise<RawCredit[]> {
    const result = await db.query<RawCredit>(
      'SELECT * FROM commission_credits ORDER BY created_at, id',
    );
    return result.rows;
  }

  it('reduces unpaid cash commission and leaves no credit', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);
    await respond(trip.bookingId);

    const result = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    });

    expect(result.adjustment.source).toBe('admin_decision');
    expect(result.adjustment.previousTripAmount).toEqual(money(100000));
    expect(result.adjustment.newTripAmount).toEqual(money(50000));
    expect(result.adjustment.previousCommission).toEqual(money(5000));
    expect(result.adjustment.newCommission).toEqual(money(2500));
    expect(result.adjustment.reducedOpenAmount).toEqual(money(2500));
    expect(result.adjustment.creditedAmount).toEqual(money(0));
    expect(result.adjustment.fundsMovementClaimedByTruber).toBe(false);
    expect(result.receivable).toMatchObject({
      status: 'open',
      collectedAmount: money(0),
      remainingAmount: money(2500),
    });

    expect(await credits()).toEqual([]);
    expect((await balances()).creditByCurrency).toEqual([]);
    expect((await balances()).outstandingByCurrency).toEqual([money(2500)]);

    const row = await rawReceivable(trip.receivable.id);
    expect(row.reduced_minor).toBe('2500');
    expect(row.trip_minor).toBe('100000');
  });

  it('credits fully collected cash commission when the trip is adjusted down', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);

    const result = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    });

    expect(result.adjustment.reducedOpenAmount).toEqual(money(0));
    expect(result.adjustment.creditedAmount).toEqual(money(2500));
    expect(result.receivable).toMatchObject({
      status: 'collected',
      collectedAmount: money(5000),
      remainingAmount: money(0),
    });
    expect((await balances()).creditByCurrency).toEqual([money(2500)]);
    expect((await balances()).outstandingByCurrency).toEqual([]);

    const [credit] = await credits();
    expect(credit.source_kind).toBe('adjustment');
    expect(credit.source_adjustment_id).toBe(result.adjustment.id);
    expect(credit.amount_minor).toBe('2500');
    expect(credit.remaining_minor).toBe('2500');
  });

  it('enforces the half-open 24h dispute and void windows', async () => {
    const before = await recognise({});
    const held = await hold(before.bookingId, { disputedAt: at(24 * HOUR - 1) });
    expect(held.status).toBe('held');

    for (const offset of [24 * HOUR, 24 * HOUR + 1]) {
      const trip = await recognise({});
      const error = await capture(hold(trip.bookingId, { disputedAt: at(offset) }));
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('DISPUTE_WINDOW_CLOSED');
    }

    const voidBefore = await recognise({});
    const voided = await receivables.voidForBooking(null, voidBefore.bookingId, {
      at: at(24 * HOUR - 1),
    });
    expect(voided.status).toBe('voided');

    for (const offset of [24 * HOUR, 24 * HOUR + 1]) {
      const trip = await recognise({});
      const error = await capture(
        receivables.voidForBooking(null, trip.bookingId, { at: at(offset) }),
      );
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('COMMISSION_FINAL');
      expect(error.message).toBe('Trip is locked; use a dispute adjustment.');
    }

    const disputeOpen = await capture(
      receivables.voidForBooking(null, before.bookingId, { at: at(2 * HOUR) }),
    );
    expect(disputeOpen.getStatus()).toBe(409);
    expect(disputeOpen.code).toBe('DISPUTE_OPEN');
  });

  it('keeps held commission out of owing until the dispute is finalised', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);

    const heldRow = await rawReceivable(trip.receivable.id);
    expect(finalAtFor(heldRow, at(2 * HOUR))).toBeNull();
    expect((await balances()).heldByCurrency).toEqual([money(5000)]);
    expect((await balances()).outstandingByCurrency).toEqual([]);
    await expect(gateCheck()).resolves.toBeUndefined();

    const collection = await collect(1, 'ZWG');
    expect(collection.creditedAmount).toEqual(money(1, 'ZWG'));
    expect((await balances()).creditByCurrency).toEqual([money(1, 'ZWG')]);
    expect((await rawReceivable(trip.receivable.id)).remaining_minor).toBe('5000');

    await respond(trip.bookingId, at(2 * HOUR));
    const finalised = await finalise({
      bookingId: trip.bookingId,
      at: at(3 * HOUR),
      idempotencyKey: 'finalise-held',
    });

    expect(finalised.receivable.status).toBe('open');
    expect(finalised.outcome.kind).toBe('unchanged');
    expect((await balances()).outstandingByCurrency).toEqual([money(5000)]);
    const finalRow = await rawReceivable(trip.receivable.id);
    expect(finalAtFor(finalRow, at(4 * HOUR))).toEqual(finalRow.final_at);

    const gateError = await capture(gateCheck());
    expect(gateError.getStatus()).toBe(409);
    expect(gateError.code).toBe('COMMISSION_OUTSTANDING');
  });

  it('skips held receivables when netting a void credit', async () => {
    const heldTrip = await recognise({});
    await hold(heldTrip.bookingId);

    const collectedTrip = await recognise({ trip: 20000, completedAt: at(2 * HOUR) });
    await collect(1000);
    await receivables.voidForBooking(null, collectedTrip.bookingId, { at: at(4 * HOUR) });

    const heldRow = await rawReceivable(heldTrip.receivable.id);
    expect(heldRow.remaining_minor).toBe('5000');
    expect((await balances()).heldByCurrency).toEqual([money(5000)]);
    expect((await balances()).creditByCurrency).toEqual([money(1000)]);
    expect((await balances()).outstandingByCurrency).toEqual([]);
  });

  it('supports party settlement and validates both agreers', async () => {
    const settled = await recognise({ method: 'cash' });
    await hold(settled.bookingId);

    const result = await adjust({
      bookingId: settled.bookingId,
      source: 'party_settlement',
      newTripMinor: 60000,
      decidedAt: at(2 * HOUR),
      shipperCompanyId: shipperId,
      shipperAgreedBy: shipperUser.id,
      transporterAgreedBy: transporterUser.id,
      reason: 'Party settlement',
    });

    expect(result.adjustment.source).toBe('party_settlement');
    expect(result.adjustment.shipperAgreedByUserId).toBe(shipperUser.id);
    expect(result.adjustment.transporterAgreedByUserId).toBe(transporterUser.id);
    expect(result.adjustment.newCommission).toEqual(money(3000));
    expect(result.receivable).toMatchObject({
      status: 'open',
      remainingAmount: money(3000),
    });
    expect(await credits()).toEqual([]);
    expect((await rawReceivable(settled.receivable.id)).final_at).not.toBeNull();

    const missing = await recognise({ method: 'cash' });
    await hold(missing.bookingId);
    const missingError = await capture(
      adjust({
        bookingId: missing.bookingId,
        source: 'party_settlement',
        newTripMinor: 60000,
        decidedAt: at(2 * HOUR),
        shipperCompanyId: shipperId,
        shipperAgreedBy: shipperUser.id,
      }),
    );
    expect(missingError.getStatus()).toBe(400);
    expect(missingError.code).toBe('VALIDATION_ERROR');
    expect(missingError.details).toEqual({
      fields: { transporterAgreedBy: 'required for party settlement' },
    });

    const forbidden = await recognise({ method: 'cash' });
    await hold(forbidden.bookingId);
    const forbiddenError = await capture(
      adjust({
        bookingId: forbidden.bookingId,
        source: 'party_settlement',
        newTripMinor: 60000,
        decidedAt: at(2 * HOUR),
        shipperCompanyId: shipperId,
        shipperAgreedBy: shipperUser.id,
        transporterAgreedBy: outsider.id,
      }),
    );
    expect(forbiddenError.getStatus()).toBe(403);
    expect(forbiddenError.code).toBe('FORBIDDEN');
  });

  it('requires a transporter response or the full 48h response window for admin decisions', async () => {
    const disputed = await recognise({ method: 'cash' });
    await hold(disputed.bookingId, { disputedAt: at(HOUR) });

    const early = await capture(
      adjust({
        bookingId: disputed.bookingId,
        newTripMinor: 50000,
        decidedAt: at(HOUR + 48 * HOUR - 1),
      }),
    );
    expect(early.getStatus()).toBe(409);
    expect(early.code).toBe('DISPUTE_RESPONSE_WINDOW_OPEN');

    const exact = await adjust({
      bookingId: disputed.bookingId,
      newTripMinor: 50000,
      decidedAt: at(HOUR + 48 * HOUR),
    });
    expect(exact.receivable.remainingAmount).toEqual(money(2500));

    const responded = await recognise({ method: 'cash' });
    await hold(responded.bookingId, { disputedAt: at(HOUR) });
    await respond(responded.bookingId, at(6 * HOUR));
    const afterResponse = await adjust({
      bookingId: responded.bookingId,
      newTripMinor: 50000,
      decidedAt: at(7 * HOUR),
    });
    expect(afterResponse.receivable.status).toBe('open');
  });

  it('cancels an unpaid receivable reduced to zero without creating a credit', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);
    await respond(trip.bookingId);

    const result = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 0,
      decidedAt: at(3 * HOUR),
    });

    expect(result.receivable).toMatchObject({
      status: 'cancelled',
      collectedAmount: money(0),
      remainingAmount: money(0),
    });
    expect(await credits()).toEqual([]);
    expect((await balances()).outstandingByCurrency).toEqual([]);
    const row = await rawReceivable(trip.receivable.id);
    expect(row.reduced_minor).toBe('5000');
    expect(row.final_at).not.toBeNull();
  });

  it('replays adjustments and finalisations by Idempotency-Key', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);

    const key = 'adjust-replay';
    const first = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
      idempotencyKey: key,
    });
    const replay = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
      idempotencyKey: key,
    });
    expect(replay.adjustment.id).toBe(first.adjustment.id);
    expect(replay.receivable.id).toBe(first.receivable.id);

    const counts = await db.query<{ adjustments: string; credits: string }>(
      `SELECT
         (SELECT count(*) FROM commission_adjustments)::text AS adjustments,
         (SELECT count(*) FROM commission_credits)::text AS credits`,
    );
    expect(counts.rows[0]).toEqual({ adjustments: '1', credits: '1' });

    const reused = await capture(
      adjust({
        bookingId: trip.bookingId,
        newTripMinor: 40000,
        decidedAt: at(2 * HOUR),
        idempotencyKey: key,
      }),
    );
    expect(reused.getStatus()).toBe(409);
    expect(reused.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const unchanged = await recognise({});
    await hold(unchanged.bookingId);
    const finaliseKey = 'finalise-replay';
    const finalised = await finalise({
      bookingId: unchanged.bookingId,
      at: at(50 * HOUR),
      idempotencyKey: finaliseKey,
    });
    const finaliseReplay = await finalise({
      bookingId: unchanged.bookingId,
      at: at(50 * HOUR),
      idempotencyKey: finaliseKey,
    });
    expect(finaliseReplay.outcome.id).toBe(finalised.outcome.id);
    const outcomeCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM commission_dispute_outcomes
        WHERE receivable_id = $1`,
      [unchanged.receivable.id],
    );
    expect(outcomeCount.rows[0].count).toBe('1');

    const different = await recognise({ method: 'cash' });
    await hold(different.bookingId, { disputeRef: 'd1000000-0000-4000-8000-000000000001' });
    const alreadyOpen = await capture(hold(different.bookingId, { disputeRef: 'd2000000-0000-4000-8000-000000000002' }));
    expect(alreadyOpen.getStatus()).toBe(409);
    expect(alreadyOpen.code).toBe('DISPUTE_ALREADY_OPEN');
    const same = await hold(different.bookingId, { disputeRef: 'd1000000-0000-4000-8000-000000000001' });
    expect(same.id).toBe(different.receivable.id);
  });

  it('carries a large credit across later receivables', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 0,
      decidedAt: at(2 * HOUR),
    });

    const second = await recognise({ trip: 50000, completedAt: at(3 * HOUR) });
    expect(second.receivable).toMatchObject({
      status: 'collected',
      remainingAmount: money(0),
    });
    const third = await recognise({ trip: 100000, completedAt: at(4 * HOUR) });
    expect(third.receivable).toMatchObject({
      status: 'open',
      remainingAmount: money(2500),
    });

    const [credit] = await credits();
    expect(credit.amount_minor).toBe('5000');
    expect(credit.remaining_minor).toBe('0');
    const allocations = await db.query<{ amount_minor: string }>(
      `SELECT amount_minor FROM commission_credit_allocations ORDER BY created_at, credit_id`,
    );
    expect(allocations.rows.map((row) => row.amount_minor)).toEqual(['2500', '2500']);
  });

  it('applies two credits FIFO across a later receivable', async () => {
    const first = await recognise({ trip: 20000, method: 'cash', completedAt: T0 });
    const second = await recognise({
      trip: 30000,
      method: 'cash',
      completedAt: at(1),
    });
    await collect(1000);
    await collect(1500);

    await hold(first.bookingId, { disputedAt: at(HOUR) });
    await respond(first.bookingId, at(1.5 * HOUR));
    await adjust({
      bookingId: first.bookingId,
      newTripMinor: 0,
      decidedAt: at(2 * HOUR),
    });

    await hold(second.bookingId, { disputedAt: at(3 * HOUR) });
    await respond(second.bookingId, at(3.5 * HOUR));
    await adjust({
      bookingId: second.bookingId,
      newTripMinor: 0,
      decidedAt: at(4 * HOUR),
    });

    const later = await recognise({ trip: 100000, completedAt: at(5 * HOUR) });
    expect(later.receivable).toMatchObject({
      status: 'open',
      remainingAmount: money(2500),
    });

    const allocations = await db.query<{ amount_minor: string; created_at: Date }>(
      `SELECT a.amount_minor, c.created_at
         FROM commission_credit_allocations a
         JOIN commission_credits c ON c.id = a.credit_id
        ORDER BY c.created_at, c.id`,
    );
    expect(allocations.rows.map((row) => row.amount_minor)).toEqual(['1000', '1500']);
    expect((await credits()).map((credit) => credit.remaining_minor)).toEqual(['0', '0']);
  });

  it('nets a credit against a new trip and clears the gate', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    });
    await expect(gateCheck()).resolves.toBeUndefined();

    const newTrip = await recognise({ trip: 50000, completedAt: at(3 * HOUR) });
    expect(newTrip.receivable).toMatchObject({
      status: 'collected',
      remainingAmount: money(0),
    });
    expect((await balances()).outstandingByCurrency).toEqual([]);
    expect((await balances()).creditByCurrency).toEqual([]);
    await expect(gateCheck()).resolves.toBeUndefined();
  });

  it('keeps credits in their own currency and rejects a currency mismatch', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    });

    const zwg = await recognise({ trip: 100000, currency: 'ZWG', completedAt: at(3 * HOUR) });
    expect(zwg.receivable).toMatchObject({
      status: 'open',
      remainingAmount: money(5000, 'ZWG'),
    });
    expect((await balances()).creditByCurrency).toEqual([money(2500, 'USD')]);
    expect((await balances()).outstandingByCurrency).toEqual([money(5000, 'ZWG')]);

    const usd = await recognise({ trip: 100000, completedAt: at(4 * HOUR) });
    await hold(usd.bookingId, { disputedAt: at(5 * HOUR) });
    await respond(usd.bookingId, at(5.5 * HOUR));
    const mismatch = await capture(
      adjust({
        bookingId: usd.bookingId,
        newTripMinor: 50000,
        currency: 'ZWG',
        decidedAt: at(6 * HOUR),
      }),
    );
    expect(mismatch.getStatus()).toBe(409);
    expect(mismatch.code).toBe('CURRENCY_MISMATCH');
  });

  it('rejects increases and chains a second late admin adjustment from the prior baseline', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    const first = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 60000,
      decidedAt: at(2 * HOUR),
    });
    expect(first.receivable.remainingAmount).toEqual(money(3000));

    const increase = await capture(
      adjust({
        bookingId: trip.bookingId,
        newTripMinor: 70000,
        disputedAt: at(HOUR),
        decidedAt: at(50 * HOUR),
      }),
    );
    expect(increase.getStatus()).toBe(409);
    expect(increase.code).toBe('ADJUSTMENT_INCREASE_NOT_ALLOWED');

    const second = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      disputedAt: at(HOUR),
      decidedAt: at(50 * HOUR),
    });
    expect(second.adjustment.previousTripAmount).toEqual(money(60000));
    expect(second.adjustment.previousCommission).toEqual(money(3000));
    expect(second.adjustment.reducedOpenAmount).toEqual(money(500));
    expect(second.receivable.remainingAmount).toEqual(money(2500));
  });

  it('accepts a late admin decision without a hold but rejects a later party settlement', async () => {
    const trip = await recognise({ method: 'cash' });
    const disputedAt = at(HOUR);

    const result = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      disputedAt,
      decidedAt: new Date(disputedAt.getTime() + 48 * HOUR),
    });
    expect(result.receivable.remainingAmount).toEqual(money(2500));
    expect((await rawReceivable(trip.receivable.id)).final_at).not.toBeNull();

    const party = await capture(
      adjust({
        bookingId: trip.bookingId,
        source: 'party_settlement',
        newTripMinor: 40000,
        disputedAt,
        decidedAt: at(50 * HOUR),
        shipperCompanyId: shipperId,
        shipperAgreedBy: shipperUser.id,
        transporterAgreedBy: transporterUser.id,
      }),
    );
    expect(party.getStatus()).toBe(409);
    expect(party.code).toBe('COMMISSION_FINAL');
  });

  it('records a support-case admin adjustment with no dispute reference', async () => {
    const trip = await recognise({ method: 'cash' });

    const result = await adjust({
      bookingId: trip.bookingId,
      disputeRef: null,
      newTripMinor: 50000,
      decidedAt: at(25 * HOUR),
    });

    expect(result.adjustment.disputeRef).toBeNull();
    expect(result.adjustment.source).toBe('admin_decision');
    expect(result.receivable.remainingAmount).toEqual(money(2500));
    expect(result.adjustment).not.toHaveProperty('currency');
    expect(result.adjustment).not.toHaveProperty('idempotencyKey');
    expect(result.adjustment).not.toHaveProperty('requestHash');

    const row = await db.query<{ dispute_ref: string | null }>(
      'SELECT dispute_ref FROM commission_adjustments WHERE id = $1',
      [result.adjustment.id],
    );
    expect(row.rows[0].dispute_ref).toBeNull();
    const outcome = await db.query<{ dispute_ref: string | null }>(
      'SELECT dispute_ref FROM commission_dispute_outcomes WHERE adjustment_id = $1',
      [result.adjustment.id],
    );
    expect(outcome.rows[0].dispute_ref).toBeNull();
  });

  it('counts adjustments against a transporter since a timestamp', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 60000,
      decidedAt: at(2 * HOUR),
    });
    await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      disputedAt: at(HOUR),
      decidedAt: at(50 * HOUR),
    });

    await expect(receivables.countAdjustmentsAgainst(null, transporterId, at(-HOUR))).resolves.toBe(
      2,
    );
    await expect(
      receivables.countAdjustmentsAgainst(null, transporterId, new Date(Date.now() + HOUR)),
    ).resolves.toBe(0);
  });

  it('makes adjustments, outcomes, and allocations append-only and credits decrease-only', async () => {
    const trip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(trip.bookingId);
    await respond(trip.bookingId);
    const adjusted = await adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    });
    await recognise({ trip: 100000, completedAt: at(3 * HOUR) });

    const outcome = await db.query<{ id: string }>(
      'SELECT id FROM commission_dispute_outcomes LIMIT 1',
    );
    const [credit] = await credits();

    await expectReject(
      db.query(`UPDATE commission_adjustments SET reason = 'changed' WHERE id = $1`, [
        adjusted.adjustment.id,
      ]),
      /append-only/,
    );
    await expectReject(
      db.query('DELETE FROM commission_adjustments WHERE id = $1', [adjusted.adjustment.id]),
      /append-only/,
    );
    await expectReject(
      db.query(`UPDATE commission_dispute_outcomes SET reason = 'changed' WHERE id = $1`, [
        outcome.rows[0].id,
      ]),
      /append-only/,
    );
    await expectReject(
      db.query('DELETE FROM commission_dispute_outcomes WHERE id = $1', [outcome.rows[0].id]),
      /append-only/,
    );
    await expectReject(
      db.query('UPDATE commission_credit_allocations SET amount_minor = 1'),
      /append-only/,
    );
    await expectReject(db.query('DELETE FROM commission_credit_allocations'), /append-only/);
    await expectReject(
      db.query('DELETE FROM commission_credits WHERE id = $1', [credit.id]),
      /append-only/,
    );
    await expectReject(
      db.query(
        'UPDATE commission_credits SET remaining_minor = remaining_minor + 1 WHERE id = $1',
        [credit.id],
      ),
      /only decrease/,
    );
  });

  it('has no cash payout, cash-out, or refund column on billing tables', async () => {
    const result = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN (
            'commission_credits',
            'commission_credit_allocations',
            'commission_adjustments',
            'commission_dispute_outcomes'
          )
          AND (column_name ~ 'payout' OR column_name ~ 'cash_out' OR column_name ~ 'refund')`,
    );
    expect(result.rows).toEqual([]);
  });

  it('serialises adjust, recognise, collection and an overpayment on one company', async () => {
    const adjustedTrip = await recognise({ method: 'cash' });
    await collect(5000);
    await hold(adjustedTrip.bookingId);
    await respond(adjustedTrip.bookingId);
    await recognise({ trip: 100000, completedAt: at(2 * HOUR) });

    await Promise.all([
      adjust({
        bookingId: adjustedTrip.bookingId,
        newTripMinor: 50000,
        decidedAt: at(2 * HOUR),
      }),
      recognise({ trip: 100000, completedAt: at(3 * HOUR) }),
      collect(1000),
      collect(50000),
    ]);

    // Conservation: every collection splits exactly into allocations plus credited excess,
    // and each credited excess has exactly one 'collection' credit of the same amount.
    const collectionRows = await db.query<{
      amount_minor: string;
      credited_minor: string;
      allocated: string;
      credit_amount: string | null;
    }>(
      `SELECT c.amount_minor::text, c.credited_minor::text,
              COALESCE((SELECT sum(a.amount_minor) FROM commission_collection_allocations a
                         WHERE a.collection_id = c.id), 0)::text AS allocated,
              (SELECT sum(cr.amount_minor) FROM commission_credits cr
                WHERE cr.source_collection_id = c.id)::text AS credit_amount
         FROM commission_collections c`,
    );
    expect(collectionRows.rows).toHaveLength(3);
    for (const row of collectionRows.rows) {
      expect(BigInt(row.allocated) + BigInt(row.credited_minor)).toBe(BigInt(row.amount_minor));
      expect(BigInt(row.credit_amount ?? '0')).toBe(BigInt(row.credited_minor));
    }
    // Order-independent totals (flag on): effective commission 2500 + 5000 + 5000 = 12500,
    // paid 5000 + 1000 + 50000 = 56000, so nothing owing and 43500 USD credit left.
    const balances = await receivables.commissionBalances(null, transporterId);
    expect(balances.outstandingByCurrency).toEqual([]);
    expect(balances.creditByCurrency).toEqual([{ amountMinor: 43500, currency: 'USD' }]);

    const creditRows = await db.query<RawCredit & { allocated: string }>(
      `SELECT c.*, COALESCE(sum(a.amount_minor), 0)::text AS allocated
         FROM commission_credits c
         LEFT JOIN commission_credit_allocations a ON a.credit_id = c.id
        GROUP BY c.id`,
    );
    for (const credit of creditRows.rows) {
      expect(Number(credit.remaining_minor)).toBeGreaterThanOrEqual(0);
      expect(BigInt(credit.amount_minor) - BigInt(credit.remaining_minor)).toBe(
        BigInt(credit.allocated),
      );
    }

    const receivablesRows = await db.query<RawReceivable>(
      `SELECT * FROM commission_receivables
        WHERE status IN ('open', 'held', 'collected')`,
    );
    expect(receivablesRows.rows.length).toBeGreaterThan(0);
    for (const row of receivablesRows.rows) {
      expect(
        BigInt(row.remaining_minor) +
          BigInt(row.collected_minor) +
          BigInt(row.credit_applied_minor) +
          BigInt(row.reduced_minor),
      ).toBe(BigInt(row.amount_minor));
    }
  });

  it('blocks an adjustment while a gate transaction holds the shared lock', async () => {
    const trip = await recognise({ method: 'cash' });
    await hold(trip.bookingId);
    await respond(trip.bookingId);

    let releaseGate!: () => void;
    const gateHeld = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gateEntered!: () => void;
    const gateStarted = new Promise<void>((resolve) => {
      gateEntered = resolve;
    });

    const gateTx = db.tx(async (client) => {
      await gate.assertCanTakeNewWork(client, transporterId);
      gateEntered();
      await gateHeld;
    });
    await gateStarted;

    let adjustmentSettled = false;
    const adjustTx = adjust({
      bookingId: trip.bookingId,
      newTripMinor: 50000,
      decidedAt: at(2 * HOUR),
    }).finally(() => {
      adjustmentSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(adjustmentSettled).toBe(false);

    releaseGate();
    await Promise.all([gateTx, adjustTx]);
    expect(adjustmentSettled).toBe(true);
  });
});

async function insertUser(db: DbService, role: 'admin' | 'shipper' | 'transporter'): Promise<DbUser> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, account_status, created_at, updated_at)
     VALUES ($1, $2, 'test-hash', 'Billing Ops', $3, 'active', now(), now())`,
    [id, `${id}@example.com`, role],
  );
  const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] as DbUser;
}

async function insertCompany(db: DbService, type: 'shipper' | 'transporter'): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO companies (id, type, legal_name, verification_status, created_at, updated_at)
     VALUES ($1, $2, 'Billing Company', 'verified', now(), now())`,
    [id, type],
  );
  return id;
}

async function addMember(db: DbService, companyId: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO company_members (company_id, user_id, member_role, created_at)
     VALUES ($1, $2, 'owner', now())`,
    [companyId, userId],
  );
}
