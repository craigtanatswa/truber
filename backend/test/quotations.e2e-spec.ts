import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiException } from '../src/common/api.exception';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { NewWorkCommissionGate } from '../src/quotations/commission-gate';
import { TruckQuoteCheck } from '../src/quotations/truck-quote-check';
import { assertOperationResponse } from './contract';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  HttpResult,
  http,
  latestPayload,
  seedAdmin,
  truncate,
  uniqueEmail,
} from './helpers';
import { prepareTestDatabase } from './prepare-db';

describe('quotations API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a quotation and creates exactly one pending booking', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const first = await verifiedTransporter(app, admin.token, 'Happy Path Fleet One');
    const second = await verifiedTransporter(app, admin.token, 'Happy Path Fleet Two');

    const firstQuote = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, load.id, first.companyId),
      201,
    );
    expect(firstQuote.body.status).toBe('submitted');
    expect(firstQuote.body).not.toHaveProperty('submittedByUserId');
    const secondQuote = expectContract(
      'createQuotation',
      await submitQuote(app, second.token, load.id, second.companyId),
      201,
    );

    const quotingLoad = expectContract('getLoad', await http(app, 'get', `/loads/${load.id}`, { token: shipper.token }), 200);
    expect(quotingLoad.body.status).toBe('quoting');

    const shipperList = expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${load.id}/quotations?page=1&pageSize=10`, { token: shipper.token }),
      200,
    );
    expect(shipperList.body.data.map((row: { id: string }) => row.id)).toEqual([
      firstQuote.body.id,
      secondQuote.body.id,
    ]);
    expect(shipperList.body.meta).toMatchObject({ page: 1, pageSize: 10, totalItems: 2, totalPages: 1 });

    const firstList = expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${load.id}/quotations`, { token: first.token }),
      200,
    );
    expect(firstList.body.data.map((row: { id: string }) => row.id)).toEqual([firstQuote.body.id]);

    const accepted = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/accept`, {
        token: shipper.token,
        body: { notes: 'Please proceed with this booking' },
        idempotencyKey: `accept-${randomUUID()}`,
      }),
      201,
    );
    expect(accepted.body.quotation.status).toBe('accepted');
    expect(accepted.body.booking).toMatchObject({
      loadId: load.id,
      quotationId: firstQuote.body.id,
      transporterCompanyId: first.companyId,
      status: 'pending_payment_arrangement',
      tripStatus: 'not_started',
      completionStatus: 'not_complete',
      agreedAmount: firstQuote.body.amount,
      commissionRateBps: 500,
      confirmedPaymentArrangementId: null,
      confirmedAt: null,
      truckId: null,
    });
    expect(JSON.stringify(accepted.body)).not.toMatch(/payout|processingFee|"fee"|acceptNotes/i);

    const sibling = expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${secondQuote.body.id}`, { token: second.token }),
      200,
    );
    expect(sibling.body.status).toBe('not_selected');

    const bookedLoad = expectContract('getLoad', await http(app, 'get', `/loads/${load.id}`, { token: shipper.token }), 200);
    expect(bookedLoad.body.status).toBe('booking_pending');

    const db = app.get(DbService);
    const bookingRows = await db.query<{
      status: string;
      confirmed_payment_arrangement_id: string | null;
      confirmed_at: Date | null;
    }>('SELECT status, confirmed_payment_arrangement_id, confirmed_at FROM bookings');
    expect(bookingRows.rows).toHaveLength(1);
    expect(bookingRows.rows[0]).toMatchObject({
      status: 'pending_payment_arrangement',
      confirmed_payment_arrangement_id: null,
      confirmed_at: null,
    });

    const withdrawAccepted = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/withdraw`, { token: first.token }),
      409,
    );
    expect(withdrawAccepted.body.code).toBe('SELF_CANCEL_NOT_ALLOWED');
    expect(withdrawAccepted.body.details).toEqual({
      bookingId: accepted.body.booking.id,
      bookingStatus: 'pending_payment_arrangement',
    });

    const cancelLoad = expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${load.id}/cancel`, {
        token: shipper.token,
        body: { reason: 'Trying to walk away after acceptance' },
      }),
      409,
    );
    expect(cancelLoad.body.code).toBe('SELF_CANCEL_NOT_ALLOWED');
    expect(cancelLoad.body.details).toEqual({
      bookingId: accepted.body.booking.id,
      bookingStatus: 'pending_payment_arrangement',
    });

    // The pending booking is real: the off-platform report flow resolves it through PostgresBookingDirectory.
    const report = await http(app, 'post', `/bookings/${accepted.body.booking.id}/off-platform-reports`, {
      token: first.token,
      body: { suspectedParty: 'shipper', description: 'Suspected off-platform dealing on this booking' },
    });
    expect(report.status).toBe(201);
    assertOperationResponse('createOffPlatformReport', 201, report.body);
    const outsider = await register(app, 'shipper');
    const hiddenReport = await http(app, 'post', `/bookings/${accepted.body.booking.id}/off-platform-reports`, {
      token: outsider.token,
      body: { suspectedParty: 'shipper', description: 'Suspected off-platform dealing on this booking' },
    });
    expect(hiddenReport.status).toBe(404);

    // A second accept on the same load is refused and still leaves one booking.
    const again = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${secondQuote.body.id}/accept`, { token: shipper.token, body: {} }),
      409,
    );
    expect(again.body.code).toBe('QUOTATION_NOT_ACCEPTABLE');
    const stillOne = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings');
    expect(stillOne.rows[0].count).toBe(1);
  });

  it('blocks accept when the accepting shipper is banned and when only the submitting user is banned', async () => {
    const { shipper, shipperCompany, load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Shipper Ban Fleet');
    const quote = expectContract('createQuotation', await submitQuote(app, transporter.token, load.id, transporter.companyId), 201);
    await insertActiveBan(app, { userId: shipper.userId, companyId: shipperCompany.id, partyRole: 'shipper' });
    const blocked = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/accept`, { token: shipper.token, body: {} }),
      409,
    );
    expect(blocked.body.code).toBe('ACCOUNT_BANNED');
    expect(blocked.body.details.bannedParty).toBe('caller');

    const second = await setupPostedLoad(app);
    const other = await verifiedTransporter(app, admin.token, 'Submitter Ban Fleet');
    const otherQuote = expectContract('createQuotation', await submitQuote(app, other.token, second.load.id, other.companyId), 201);
    // Ban row on the submitting user under an unrelated company: only the user match can block it.
    const unrelated = await verifiedTransporter(app, admin.token, 'Unrelated Fleet');
    await insertActiveBan(app, { userId: other.userId, companyId: unrelated.companyId, partyRole: 'transporter' });
    const submitterBlocked = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${otherQuote.body.id}/accept`, { token: second.shipper.token, body: {} }),
      409,
    );
    expect(submitterBlocked.body.code).toBe('ACCOUNT_BANNED');
    expect(submitterBlocked.body.details.bannedParty).toBe('counterparty_company');
    const db = app.get(DbService);
    const bookings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings');
    expect(bookings.rows[0].count).toBe(0);
  });

  it('withdraws, refuses a second withdraw, and allows revision by resubmission', async () => {
    const { load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Revision Fleet');
    const quote = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId),
      201,
    );

    const withdrawn = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/withdraw`, { token: transporter.token }),
      200,
    );
    expect(withdrawn.body.status).toBe('withdrawn');

    const secondWithdraw = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/withdraw`, { token: transporter.token }),
      409,
    );
    expect(secondWithdraw.body.code).toBe('QUOTATION_NOT_WITHDRAWABLE');
    expect(secondWithdraw.body.details).toEqual({ status: 'withdrawn' });

    const revised = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId, {
        amount: { amountMinor: 125000, currency: 'USD' },
      }),
      201,
    );
    expect(revised.body.status).toBe('submitted');
    expect(revised.body.amount.amountMinor).toBe(125000);

    const duplicate = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId),
      409,
    );
    expect(duplicate.body.code).toBe('QUOTATION_ALREADY_OPEN');
  });

  it('hides quotations across tenants and enforces roles for every operation', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const first = await verifiedTransporter(app, admin.token, 'Isolation Fleet One');
    const second = await verifiedTransporter(app, admin.token, 'Isolation Fleet Two');
    const otherShipper = await register(app, 'shipper');

    const firstQuote = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, load.id, first.companyId),
      201,
    );
    const secondQuote = expectContract(
      'createQuotation',
      await submitQuote(app, second.token, load.id, second.companyId),
      201,
    );

    const otherList = expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${load.id}/quotations`, { token: otherShipper.token }),
      404,
    );
    expect(otherList.body.code).toBe('NOT_FOUND');
    expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${firstQuote.body.id}`, { token: otherShipper.token }),
      404,
    );
    expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/accept`, {
        token: otherShipper.token,
        body: {},
      }),
      404,
    );

    expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${firstQuote.body.id}`, { token: second.token }),
      404,
    );
    expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/withdraw`, { token: second.token }),
      404,
    );
    const secondList = expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${load.id}/quotations`, { token: second.token }),
      200,
    );
    expect(secondList.body.data.map((row: { id: string }) => row.id)).toEqual([secondQuote.body.id]);

    const transporterAccept = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${secondQuote.body.id}/accept`, {
        token: second.token,
        body: {},
      }),
      403,
    );
    expect(transporterAccept.body.code).toBe('ROLE_NOT_PERMITTED');

    const shipperCreate = expectContract(
      'createQuotation',
      await submitQuote(app, shipper.token, load.id, first.companyId),
      403,
    );
    expect(shipperCreate.body.code).toBe('ROLE_NOT_PERMITTED');
    const shipperWithdraw = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/withdraw`, { token: shipper.token }),
      403,
    );
    expect(shipperWithdraw.body.code).toBe('ROLE_NOT_PERMITTED');

    const adminList = expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${load.id}/quotations`, { token: admin.token }),
      200,
    );
    expect(adminList.body.data).toHaveLength(2);
    expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${firstQuote.body.id}`, { token: admin.token }),
      200,
    );
    const adminAccept = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/accept`, { token: admin.token, body: {} }),
      403,
    );
    expect(adminAccept.body.code).toBe('ROLE_NOT_PERMITTED');
    const adminWithdraw = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${firstQuote.body.id}/withdraw`, { token: admin.token }),
      403,
    );
    expect(adminWithdraw.body.code).toBe('ROLE_NOT_PERMITTED');

    const unauthenticated = [
      { operationId: 'listQuotationsForLoad', method: 'get' as const, url: `/loads/${load.id}/quotations` },
      { operationId: 'getQuotation', method: 'get' as const, url: `/quotations/${firstQuote.body.id}` },
      { operationId: 'acceptQuotation', method: 'post' as const, url: `/quotations/${firstQuote.body.id}/accept` },
      {
        operationId: 'withdrawQuotation',
        method: 'post' as const,
        url: `/quotations/${firstQuote.body.id}/withdraw`,
      },
    ];
    for (const endpoint of unauthenticated) {
      expectContract(endpoint.operationId, await http(app, endpoint.method, endpoint.url), 401);
    }
  });

  it('validates quotation bodies, dates, currencies, ids, and the truck seam', async () => {
    const { load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Validation Fleet');
    const base = quoteInput(transporter.companyId);

    const invalidBodies: Record<string, unknown>[] = [
      { transporterCompanyId: transporter.companyId, validUntil: base.validUntil },
      { ...base, amount: '1000' },
      { ...base, amount: { amountMinor: 0, currency: 'USD' } },
      { ...base, amount: { amountMinor: 1000, currency: 'usd' } },
      { ...base, validUntil: new Date(Date.now() - 60_000).toISOString() },
      { ...base, validUntil: '2027-01-01' },
      { ...base, unexpectedField: 'not allowed' },
      { ...base, amount: { amountMinor: 2147483648, currency: 'USD' } },
      { ...base, amount: { amountMinor: 10.5, currency: 'USD' } },
      { ...base, notes: 'x'.repeat(2001) },
    ];
    for (const body of invalidBodies) {
      const response = expectContract(
        'createQuotation',
        await http(app, 'post', `/loads/${load.id}/quotations`, { token: transporter.token, body }),
        400,
      );
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }

    const past = expectContract(
      'createQuotation',
      await http(app, 'post', `/loads/${load.id}/quotations`, {
        token: transporter.token,
        body: { ...base, validUntil: new Date(Date.now() - 60_000).toISOString() },
      }),
      400,
    );
    expect(past.body.details.fields.validUntil).toBeDefined();

    const mismatch = expectContract(
      'createQuotation',
      await http(app, 'post', `/loads/${load.id}/quotations`, {
        token: transporter.token,
        body: { ...base, amount: { amountMinor: 1000, currency: 'EUR' } },
      }),
      400,
    );
    expect(mismatch.body.code).toBe('CURRENCY_MISMATCH');

    const truckMissing = expectContract(
      'createQuotation',
      await http(app, 'post', `/loads/${load.id}/quotations`, {
        token: transporter.token,
        body: { ...base, truckId: randomUUID() },
      }),
      404,
    );
    expect(truckMissing.body.code).toBe('NOT_FOUND');

    expect((await http(app, 'get', '/quotations/not-a-uuid', { token: transporter.token })).status).toBe(400);
    expect((await http(app, 'get', `/loads/not-a-uuid/quotations`, { token: transporter.token })).status).toBe(400);
  });

  it('calls the truck check with the company and truck, and stores an accepted truck id', async () => {
    const { load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Truck Seam Fleet');
    const truckId = randomUUID();
    const check = app.get(TruckQuoteCheck);
    const spy = jest.spyOn(check, 'assertTruckUsableForQuote').mockResolvedValue();

    const created = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId, { truckId }),
      201,
    );
    expect(created.body.truckId).toBe(truckId);
    expect(spy).toHaveBeenCalledWith(expect.anything(), transporter.companyId, truckId);
  });

  it('enforces account and company verification before accepting a quotation', async () => {
    const { load, admin } = await setupPostedLoad(app);

    const pending = await register(app, 'transporter');
    const pendingCompany = await createCompany(app, pending, 'transporter', 'Pending Account Fleet');
    await verifyCompany(app, admin.token, pendingCompany.id);
    const pendingBlocked = expectContract(
      'createQuotation',
      await submitQuote(app, pending.token, load.id, pendingCompany.id),
      403,
    );
    expect(pendingBlocked.body.code).toBe('VERIFICATION_REQUIRED');
    expect(pendingBlocked.body.details).toMatchObject({
      accountStatus: 'pending_verification',
      companyVerificationStatus: 'verified',
    });
    await verifyOtp(app, pending.token, pending.userId);
    expectContract('createQuotation', await submitQuote(app, pending.token, load.id, pendingCompany.id), 201);

    const active = await register(app, 'transporter');
    const unverifiedCompany = await createCompany(app, active, 'transporter', 'Unverified Fleet');
    await verifyOtp(app, active.token, active.userId);
    const companyBlocked = expectContract(
      'createQuotation',
      await submitQuote(app, active.token, load.id, unverifiedCompany.id),
      403,
    );
    expect(companyBlocked.body.code).toBe('VERIFICATION_REQUIRED');
    expect(companyBlocked.body.details).toMatchObject({
      accountStatus: 'active',
      companyVerificationStatus: 'unverified',
    });
    await verifyCompany(app, admin.token, unverifiedCompany.id);
    expectContract('createQuotation', await submitQuote(app, active.token, load.id, unverifiedCompany.id), 201);
  });

  it('rejects closed loads and blocks new work for banned parties', async () => {
    const { shipper, shipperCompany, load, admin } = await setupPostedLoad(app);
    const first = await verifiedTransporter(app, admin.token, 'Closed Load Fleet One');
    const second = await verifiedTransporter(app, admin.token, 'Closed Load Fleet Two');

    const draft = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expectContract(
      'listQuotationsForLoad',
      await http(app, 'get', `/loads/${draft.body.id}/quotations`, { token: first.token }),
      404,
    );
    expectContract(
      'createQuotation',
      await submitQuote(app, first.token, draft.body.id, first.companyId),
      404,
    );

    expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${load.id}/cancel`, {
        token: shipper.token,
        body: { reason: 'Closing this load for the test' },
      }),
      200,
    );
    expectContract(
      'createQuotation',
      await submitQuote(app, first.token, load.id, first.companyId),
      404,
    );

    const acceptedLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${acceptedLoad.body.id}/post`, { token: shipper.token }),
      200,
    );
    const acceptedQuote = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, acceptedLoad.body.id, first.companyId),
      201,
    );
    expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${acceptedQuote.body.id}/accept`, { token: shipper.token, body: {} }),
      201,
    );
    const closedForQuotes = expectContract(
      'createQuotation',
      await submitQuote(app, second.token, acceptedLoad.body.id, second.companyId),
      409,
    );
    expect(closedForQuotes.body.code).toBe('LOAD_NOT_OPEN_FOR_QUOTES');

    const bannedLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${bannedLoad.body.id}/post`, { token: shipper.token }),
      200,
    );
    await insertActiveBan(app, {
      userId: first.userId,
      companyId: first.companyId,
      partyRole: 'transporter',
    });
    const bannedCreate = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, bannedLoad.body.id, first.companyId),
      409,
    );
    expect(bannedCreate.body.code).toBe('ACCOUNT_BANNED');
    expect(bannedCreate.body.details.bannedParty).toBe('caller');

    const acceptBanLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${acceptBanLoad.body.id}/post`, { token: shipper.token }),
      200,
    );
    const quotingTransporter = await verifiedTransporter(app, admin.token, 'Counterparty Ban Fleet');
    const quotingTransporterQuote = expectContract(
      'createQuotation',
      await submitQuote(app, quotingTransporter.token, acceptBanLoad.body.id, quotingTransporter.companyId),
      201,
    );
    await insertActiveBan(app, {
      userId: quotingTransporter.userId,
      companyId: quotingTransporter.companyId,
      partyRole: 'transporter',
    });
    const bannedAccept = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quotingTransporterQuote.body.id}/accept`, {
        token: shipper.token,
        body: {},
      }),
      409,
    );
    expect(bannedAccept.body.code).toBe('ACCOUNT_BANNED');
    expect(bannedAccept.body.details.bannedParty).toBe('counterparty_company');
    const db = app.get(DbService);
    const bookings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings WHERE load_id = $1', [
      acceptBanLoad.body.id,
    ]);
    expect(bookings.rows[0].count).toBe(0);
    const unchanged = expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${quotingTransporterQuote.body.id}`, {
        token: quotingTransporter.token,
      }),
      200,
    );
    expect(unchanged.body.status).toBe('submitted');
  });

  it('surfaces the commission gate conflict without creating quotes or bookings', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const first = await verifiedTransporter(app, admin.token, 'Commission Fleet One');
    const second = await verifiedTransporter(app, admin.token, 'Commission Fleet Two');
    const existingQuote = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, load.id, first.companyId),
      201,
    );

    const gate = app.get(NewWorkCommissionGate);
    jest.spyOn(gate, 'assertCanTakeNewWork').mockRejectedValue(
      new ApiException(
        409,
        'COMMISSION_OUTSTANDING',
        'Outstanding commission must be settled before taking new work.',
        {
          outstandingAmount: { amountMinor: 5000, currency: 'USD' },
          outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
        },
      ),
    );

    const createBlocked = expectContract(
      'createQuotation',
      await submitQuote(app, second.token, load.id, second.companyId),
      409,
    );
    expect(createBlocked.body.code).toBe('COMMISSION_OUTSTANDING');

    const acceptBlocked = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${existingQuote.body.id}/accept`, {
        token: shipper.token,
        body: {},
      }),
      409,
    );
    expect(acceptBlocked.body.code).toBe('COMMISSION_OUTSTANDING');

    const db = app.get(DbService);
    const quotes = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM quotations');
    expect(quotes.rows[0].count).toBe(1);
    const bookings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings');
    expect(bookings.rows[0].count).toBe(0);
    const unchanged = await db.query<{ status: string }>('SELECT status FROM quotations WHERE id = $1', [
      existingQuote.body.id,
    ]);
    expect(unchanged.rows[0].status).toBe('submitted');
  });

  it('presents submitted quotations as expired and refuses accept or withdraw', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Expiry Fleet');
    const quote = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId, {
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
      201,
    );

    const db = app.get(DbService);
    await db.query(`UPDATE quotations SET valid_until = clock_timestamp() - interval '1 second' WHERE id = $1`, [
      quote.body.id,
    ]);

    const expired = expectContract(
      'getQuotation',
      await http(app, 'get', `/quotations/${quote.body.id}`, { token: shipper.token }),
      200,
    );
    expect(expired.body.status).toBe('expired');

    const accept = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/accept`, { token: shipper.token, body: {} }),
      409,
    );
    expect(accept.body.code).toBe('QUOTATION_EXPIRED');

    const withdraw = expectContract(
      'withdrawQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/withdraw`, { token: transporter.token }),
      409,
    );
    expect(withdraw.body.code).toBe('QUOTATION_NOT_WITHDRAWABLE');
    expect(withdraw.body.details).toEqual({ status: 'expired' });
  });

  it('replays an accepted quotation idempotently and rejects a changed body', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const transporter = await verifiedTransporter(app, admin.token, 'Idempotent Fleet');
    const quote = expectContract(
      'createQuotation',
      await submitQuote(app, transporter.token, load.id, transporter.companyId),
      201,
    );
    const key = `accept-${randomUUID()}`;
    const body = { notes: 'First acceptance notes' };

    const first = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/accept`, {
        token: shipper.token,
        body,
        idempotencyKey: key,
      }),
      201,
    );
    const replay = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/accept`, {
        token: shipper.token,
        body,
        idempotencyKey: key,
      }),
      201,
    );
    expect(replay.body).toEqual(first.body);

    const changed = expectContract(
      'acceptQuotation',
      await http(app, 'post', `/quotations/${quote.body.id}/accept`, {
        token: shipper.token,
        body: { notes: 'Different notes with the same key' },
        idempotencyKey: key,
      }),
      409,
    );
    expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const db = app.get(DbService);
    const bookings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings');
    expect(bookings.rows[0].count).toBe(1);
  });

  it('serializes concurrent accepts so only one booking is created', async () => {
    const { shipper, load, admin } = await setupPostedLoad(app);
    const first = await verifiedTransporter(app, admin.token, 'Race Fleet One');
    const second = await verifiedTransporter(app, admin.token, 'Race Fleet Two');
    const firstQuote = expectContract(
      'createQuotation',
      await submitQuote(app, first.token, load.id, first.companyId),
      201,
    );
    const secondQuote = expectContract(
      'createQuotation',
      await submitQuote(app, second.token, load.id, second.companyId),
      201,
    );

    const responses = await Promise.all([
      http(app, 'post', `/quotations/${firstQuote.body.id}/accept`, { token: shipper.token, body: {} }),
      http(app, 'post', `/quotations/${secondQuote.body.id}/accept`, { token: shipper.token, body: {} }),
    ]);
    const created = responses.filter((response) => response.status === 201);
    const conflicted = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    assertOperationResponse('acceptQuotation', 201, created[0].body);
    assertOperationResponse('acceptQuotation', 409, conflicted[0].body);

    const db = app.get(DbService);
    const bookings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings');
    expect(bookings.rows[0].count).toBe(1);
    const loadRow = await db.query<{ status: string }>('SELECT status FROM loads WHERE id = $1', [load.id]);
    expect(loadRow.rows[0].status).toBe('booking_pending');
  });

  it('runs accept and withdraw concurrently on one load without deadlock and keeps a consistent state', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { shipper, load, admin } = await setupPostedLoad(app);
      const first = await verifiedTransporter(app, admin.token, `Lock Fleet A${round}`);
      const second = await verifiedTransporter(app, admin.token, `Lock Fleet B${round}`);
      const q1 = await submitQuote(app, first.token, load.id, first.companyId);
      const q2 = await submitQuote(app, second.token, load.id, second.companyId);
      const [accept, withdraw] = await Promise.all([
        http(app, 'post', `/quotations/${q1.body.id}/accept`, { token: shipper.token, body: {} }),
        http(app, 'post', `/quotations/${q2.body.id}/withdraw`, { token: second.token }),
      ]);
      expect(accept.status).toBe(201);
      assertOperationResponse('acceptQuotation', 201, accept.body);
      // Withdraw either won the lock first (200, withdrawn) or ran after accept (409, sibling not_selected).
      expect([200, 409]).toContain(withdraw.status);
      assertOperationResponse('withdrawQuotation', withdraw.status, withdraw.body);
      const sibling = await http(app, 'get', `/quotations/${q2.body.id}`, { token: second.token });
      expect(sibling.body.status).toBe(withdraw.status === 200 ? 'withdrawn' : 'not_selected');
    }
  });
});

interface Session {
  token: string;
  userId: string;
  email: string;
  password: string;
}

function expectContract(operationId: string, response: HttpResult, status: number): HttpResult {
  expect(response.status).toBe(status);
  assertOperationResponse(operationId, status, response.body);
  return response;
}

async function register(app: INestApplication, role: 'shipper' | 'transporter'): Promise<Session> {
  const email = uniqueEmail(role);
  const password = `${role}-password`;
  const response = await http(app, 'post', '/auth/register', {
    body: { email, password, fullName: `${role} user`, role },
  });
  if (response.status !== 201) {
    throw new Error(`register failed ${response.status}`);
  }
  return { token: response.body.accessToken as string, userId: response.body.user.id as string, email, password };
}

async function createCompany(
  app: INestApplication,
  session: Session,
  type: 'shipper' | 'transporter',
  legalName: string,
): Promise<{ id: string }> {
  const response = await http(app, 'post', '/companies', {
    token: session.token,
    body: { type, legalName },
  });
  if (response.status !== 201) {
    throw new Error(`company create failed ${response.status}`);
  }
  return { id: response.body.id as string };
}

async function verifyCompany(app: INestApplication, adminToken: string, companyId: string): Promise<void> {
  const response = await http(app, 'patch', `/companies/${companyId}`, {
    token: adminToken,
    body: { verificationStatus: 'verified' },
  });
  if (response.status !== 200) {
    throw new Error(`company verification failed ${response.status}`);
  }
}

async function loginAdmin(app: INestApplication): Promise<Session> {
  await seedAdmin();
  const response = await http(app, 'post', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (response.status !== 200) {
    throw new Error(`admin login failed ${response.status}`);
  }
  return {
    token: response.body.accessToken as string,
    userId: response.body.user.id as string,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  };
}

async function verifyOtp(app: INestApplication, token: string, userId: string): Promise<void> {
  const requested = await http(app, 'post', '/auth/otp/request', { token, body: { channel: 'sms' } });
  if (requested.status !== 202) {
    throw new Error(`otp request failed ${requested.status}`);
  }
  const code = await latestPayload(app, userId, 'otp');
  const verified = await http(app, 'post', '/auth/otp/verify', { token, body: { code } });
  if (verified.status !== 200 || verified.body.accountStatus !== 'active') {
    throw new Error(`otp verify failed ${verified.status}`);
  }
}

function draftInput(companyId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    companyId,
    goodsType: 'General cargo',
    weightKg: 1500,
    truckTypeRequired: 'flatbed',
    pickupAddress: 'Pickup yard',
    destinationAddress: 'Destination yard',
    loadingDate: '2026-12-20',
    rateType: 'negotiable',
    currency: 'USD',
    ...overrides,
  };
}

async function createDraft(
  app: INestApplication,
  token: string,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return http(app, 'post', '/loads', { token, body: draftInput(companyId, overrides) });
}

async function setupPostedLoad(
  app: INestApplication,
): Promise<{
  shipper: Session;
  shipperCompany: { id: string };
  load: { id: string };
  admin: Session;
}> {
  const shipper = await register(app, 'shipper');
  const shipperCompany = await createCompany(app, shipper, 'shipper', 'Quotation Test Shipper');
  await verifyOtp(app, shipper.token, shipper.userId);
  const admin = await loginAdmin(app);
  await verifyCompany(app, admin.token, shipperCompany.id);
  const draft = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
  const posted = expectContract(
    'postLoad',
    await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token }),
    200,
  );
  return { shipper, shipperCompany, load: posted.body as { id: string }, admin };
}

async function verifiedTransporter(
  app: INestApplication,
  adminToken: string,
  legalName: string,
): Promise<Session & { companyId: string }> {
  const session = await register(app, 'transporter');
  const company = await createCompany(app, session, 'transporter', legalName);
  await verifyOtp(app, session.token, session.userId);
  await verifyCompany(app, adminToken, company.id);
  return { ...session, companyId: company.id };
}

function quoteInput(companyId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transporterCompanyId: companyId,
    amount: { amountMinor: 100000, currency: 'USD' },
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

async function submitQuote(
  app: INestApplication,
  token: string,
  loadId: string,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return http(app, 'post', `/loads/${loadId}/quotations`, {
    token,
    body: quoteInput(companyId, overrides),
  });
}

async function insertActiveBan(
  app: INestApplication,
  input: { userId: string; companyId: string; partyRole: 'shipper' | 'transporter' },
): Promise<void> {
  const db = app.get(DbService);
  const reportId = randomUUID();
  const findingId = randomUUID();
  const banId = randomUUID();
  const bookingId = randomUUID();
  const reason = 'Direct test fixture for an active off-platform ban';
  await db.query(
    `INSERT INTO off_platform_reports (
       id, booking_id, reported_by_user_id, reporter_role, suspected_party,
       description, evidence_uris, status, created_at
     ) VALUES ($1, $2, $3, $4, 'transporter', $5, '[]'::jsonb, 'open', clock_timestamp())`,
    [reportId, bookingId, input.userId, input.partyRole, reason],
  );
  await db.query(
    `INSERT INTO off_platform_findings (
       id, report_id, booking_id, outcome, reason, responsible_parties,
       reviewed_by_user_id, reviewed_at
     ) VALUES ($1, $2, $3, 'confirmed', $4, '[]'::jsonb, $5, clock_timestamp())`,
    [findingId, reportId, bookingId, reason, input.userId],
  );
  await db.query(
    `INSERT INTO off_platform_bans (
       id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at,
       duration_days, applied_by_user_id, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, clock_timestamp(), clock_timestamp() + interval '336 hours',
       14, $7, clock_timestamp()
     )`,
    [banId, findingId, input.userId, input.companyId, input.partyRole, reason, input.userId],
  );
}
