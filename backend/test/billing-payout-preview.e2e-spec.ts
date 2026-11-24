import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ReceivablesService } from '../src/billing/receivables.service';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { DbUser } from '../src/domain';
import { assertOperationResponse, assertSchema } from './contract';
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

const PREVIEW_KEYS = [
  'agreedAmount',
  'commissionRateBps',
  'commissionAmount',
  'knownFees',
  'knownFeesTotal',
  'netPayoutBeforeUnknownFees',
  'feeStatus',
  'unknownFees',
  'paymentMethod',
  'farePayoutDueThroughTruber',
  'paymentProtectedPossible',
  'submissionBlockers',
];

const PROVIDER_NOT_CONTRACTED = [
  { feeType: 'processing_fee', reason: 'provider_not_contracted' },
];
const RAIL_NOT_SELECTED = [
  { feeType: 'processing_fee', reason: 'payment_rail_not_selected' },
];

describe('quotation payout preview API', () => {
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

  it('rounds commission half-up and computes net exactly', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Rounding Carrier');

    const cases = [
      { amountMinor: 1, commissionMinor: 0, netMinor: 1 },
      { amountMinor: 9, commissionMinor: 0, netMinor: 9 },
      { amountMinor: 10, commissionMinor: 1, netMinor: 9 },
      { amountMinor: 29, commissionMinor: 1, netMinor: 28 },
      { amountMinor: 30, commissionMinor: 2, netMinor: 28 },
      { amountMinor: 50, commissionMinor: 3, netMinor: 47 },
      { amountMinor: 100000, commissionMinor: 5000, netMinor: 95000 },
      { amountMinor: 25010, commissionMinor: 1251, netMinor: 23759 },
    ];

    for (const item of cases) {
      const response = expectPreview(
        await preview(app, transporter.token, company.id, {
          amountMinor: item.amountMinor,
          currency: 'USD',
        }),
      );
      expect(response.body.agreedAmount).toEqual({
        amountMinor: item.amountMinor,
        currency: 'USD',
      });
      expect(response.body.commissionRateBps).toBe(500);
      expect(response.body.commissionAmount).toEqual({
        amountMinor: item.commissionMinor,
        currency: 'USD',
      });
      expect(response.body.netPayoutBeforeUnknownFees).toEqual({
        amountMinor: item.netMinor,
        currency: 'USD',
      });
      expect(response.body.knownFees).toEqual([]);
      expect(response.body.knownFeesTotal).toEqual({ amountMinor: 0, currency: 'USD' });
      expect(response.body.netPayoutBeforeUnknownFees.amountMinor).toBeGreaterThanOrEqual(0);
    }

    const max = Number.MAX_SAFE_INTEGER;
    const expectedCommission = Number((BigInt(max) * 500n + 5000n) / 10000n);
    const expectedNet = max - expectedCommission;
    const maxResponse = expectPreview(
      await preview(app, transporter.token, company.id, {
        amountMinor: max,
        currency: 'USD',
      }),
    );
    expect(maxResponse.body.commissionAmount).toEqual({
      amountMinor: expectedCommission,
      currency: 'USD',
    });
    expect(maxResponse.body.netPayoutBeforeUnknownFees).toEqual({
      amountMinor: expectedNet,
      currency: 'USD',
    });
  });

  it('reproduces the noBlockers contract example', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'No Blockers Carrier');

    const response = expectPreview(
      await preview(app, transporter.token, company.id, {
        amountMinor: 100000,
        currency: 'USD',
        paymentMethod: 'prepay',
      }),
    );

    expect(response.body).toEqual({
      agreedAmount: { amountMinor: 100000, currency: 'USD' },
      commissionRateBps: 500,
      commissionAmount: { amountMinor: 5000, currency: 'USD' },
      knownFees: [],
      knownFeesTotal: { amountMinor: 0, currency: 'USD' },
      netPayoutBeforeUnknownFees: { amountMinor: 95000, currency: 'USD' },
      feeStatus: 'unknown',
      unknownFees: PROVIDER_NOT_CONTRACTED,
      paymentMethod: 'prepay',
      farePayoutDueThroughTruber: true,
      paymentProtectedPossible: true,
      submissionBlockers: [],
    });
  });

  it('reproduces the owingTwoCurrencies contract example', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Two Currency Carrier');
    await recognise(app, company.id, 30000, 'USD');
    await recognise(app, company.id, 800000, 'ZWG');

    const response = expectPreview(
      await preview(app, transporter.token, company.id, {
        amountMinor: 50000,
        currency: 'USD',
        paymentMethod: 'cash',
      }),
    );

    expect(response.body).toEqual({
      agreedAmount: { amountMinor: 50000, currency: 'USD' },
      commissionRateBps: 500,
      commissionAmount: { amountMinor: 2500, currency: 'USD' },
      knownFees: [],
      knownFeesTotal: { amountMinor: 0, currency: 'USD' },
      netPayoutBeforeUnknownFees: { amountMinor: 47500, currency: 'USD' },
      feeStatus: 'not_applicable',
      unknownFees: [],
      paymentMethod: 'cash',
      farePayoutDueThroughTruber: false,
      paymentProtectedPossible: false,
      submissionBlockers: [
        {
          code: 'COMMISSION_OUTSTANDING',
          details: {
            outstandingByCurrency: [
              { amountMinor: 1500, currency: 'USD' },
              { amountMinor: 40000, currency: 'ZWG' },
            ],
          },
        },
      ],
    });
  });

  it('reproduces the bothBlockers contract example with the inserted ban expiry', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Both Blockers Carrier');
    const otherCompany = await createCompany(app, other.token, 'transporter', 'Both Blockers Other');
    await recognise(app, company.id, 30000, 'USD');
    const ban = await insertBan(app.get(DbService), {
      userId: other.userId,
      companyId: company.id,
      appliedByUserId: other.userId,
    });

    const response = expectPreview(
      await preview(app, transporter.token, company.id, {
        amountMinor: 25010,
        currency: 'USD',
        paymentMethod: 'escrow',
      }),
    );

    expect(response.body).toEqual({
      agreedAmount: { amountMinor: 25010, currency: 'USD' },
      commissionRateBps: 500,
      commissionAmount: { amountMinor: 1251, currency: 'USD' },
      knownFees: [],
      knownFeesTotal: { amountMinor: 0, currency: 'USD' },
      netPayoutBeforeUnknownFees: { amountMinor: 23759, currency: 'USD' },
      feeStatus: 'unknown',
      unknownFees: PROVIDER_NOT_CONTRACTED,
      paymentMethod: 'escrow',
      farePayoutDueThroughTruber: true,
      paymentProtectedPossible: true,
      submissionBlockers: [
        { code: 'ACCOUNT_BANNED', details: { bannedUntil: ban.endsAt } },
        {
          code: 'COMMISSION_OUTSTANDING',
          details: {
            outstandingAmount: { amountMinor: 1500, currency: 'USD' },
            outstandingByCurrency: [{ amountMinor: 1500, currency: 'USD' }],
          },
        },
      ],
    });
    expect(response.body.submissionBlockers[0].code).toBe('ACCOUNT_BANNED');
    expect(otherCompany.id).not.toBe(company.id);
  });

  it('reports fees per payment method and never claims unknown fees are known', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Fee Methods Carrier');
    const cases: {
      paymentMethod?: string;
      expectedMethod: string | null;
      feeStatus: string;
      unknownFees: unknown[];
      fare: boolean;
      protectedPossible: boolean;
    }[] = [
      {
        paymentMethod: 'prepay',
        expectedMethod: 'prepay',
        feeStatus: 'unknown',
        unknownFees: PROVIDER_NOT_CONTRACTED,
        fare: true,
        protectedPossible: true,
      },
      {
        paymentMethod: 'escrow',
        expectedMethod: 'escrow',
        feeStatus: 'unknown',
        unknownFees: PROVIDER_NOT_CONTRACTED,
        fare: true,
        protectedPossible: true,
      },
      {
        paymentMethod: 'deposit_balance',
        expectedMethod: 'deposit_balance',
        feeStatus: 'unknown',
        unknownFees: PROVIDER_NOT_CONTRACTED,
        fare: true,
        protectedPossible: true,
      },
      {
        paymentMethod: 'corporate_credit',
        expectedMethod: 'corporate_credit',
        feeStatus: 'unknown',
        unknownFees: PROVIDER_NOT_CONTRACTED,
        fare: true,
        protectedPossible: true,
      },
      {
        paymentMethod: 'cash',
        expectedMethod: 'cash',
        feeStatus: 'not_applicable',
        unknownFees: [],
        fare: false,
        protectedPossible: false,
      },
      {
        expectedMethod: null,
        feeStatus: 'unknown',
        unknownFees: RAIL_NOT_SELECTED,
        fare: false,
        protectedPossible: false,
      },
    ];

    for (const item of cases) {
      const response = expectPreview(
        await preview(app, transporter.token, company.id, {
          amountMinor: 10000,
          currency: 'USD',
          ...(item.paymentMethod === undefined ? {} : { paymentMethod: item.paymentMethod }),
        }),
      );
      expect(response.body.paymentMethod).toBe(item.expectedMethod);
      expect(response.body.feeStatus).toBe(item.feeStatus);
      expect(response.body.feeStatus).not.toBe('known');
      expect(response.body.unknownFees).toEqual(item.unknownFees);
      expect(response.body.unknownFees.length > 0).toBe(item.feeStatus === 'unknown');
      expect(response.body.farePayoutDueThroughTruber).toBe(item.fare);
      expect(response.body.paymentProtectedPossible).toBe(item.protectedPossible);
      expect(response.body.knownFees).toEqual([]);
      expect(response.body.knownFeesTotal).toEqual({ amountMinor: 0, currency: 'USD' });
    }
  });

  it('lists a company ban as an ACCOUNT_BANNED blocker', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Company Ban Carrier');
    await createCompany(app, other.token, 'transporter', 'Company Ban Other');
    const ban = await insertBan(app.get(DbService), {
      userId: other.userId,
      companyId: company.id,
      appliedByUserId: other.userId,
    });

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([
      { code: 'ACCOUNT_BANNED', details: { bannedUntil: ban.endsAt } },
    ]);
  });

  it('lists a ban on the calling user as an ACCOUNT_BANNED blocker', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'User Ban Carrier');
    const otherCompany = await createCompany(app, other.token, 'transporter', 'User Ban Other');
    const ban = await insertBan(app.get(DbService), {
      userId: transporter.userId,
      companyId: otherCompany.id,
      appliedByUserId: other.userId,
    });

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([
      { code: 'ACCOUNT_BANNED', details: { bannedUntil: ban.endsAt } },
    ]);
  });

  it('ignores lifted and expired bans', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'History Ban Carrier');
    await createCompany(app, other.token, 'transporter', 'History Ban Other');
    const now = Date.now();

    await insertBan(app.get(DbService), {
      userId: other.userId,
      companyId: company.id,
      appliedByUserId: other.userId,
      liftedAt: new Date(now - 1000),
      liftedByUserId: other.userId,
      liftReason: 'Mistaken identity',
    });
    await insertBan(app.get(DbService), {
      userId: other.userId,
      companyId: company.id,
      appliedByUserId: other.userId,
      startsAt: new Date(now - 15 * 24 * 3600 * 1000),
    });

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([]);
  });

  it('never reports another company ban', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Isolated Ban Carrier');
    const otherCompany = await createCompany(app, other.token, 'transporter', 'Isolated Ban Other');
    await insertBan(app.get(DbService), {
      userId: other.userId,
      companyId: otherCompany.id,
      appliedByUserId: other.userId,
    });

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([]);
  });

  it('reports owing in one currency with outstandingAmount', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Single Owing Carrier');
    await recognise(app, company.id, 30000, 'USD');

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([
      {
        code: 'COMMISSION_OUTSTANDING',
        details: {
          outstandingAmount: { amountMinor: 1500, currency: 'USD' },
          outstandingByCurrency: [{ amountMinor: 1500, currency: 'USD' }],
        },
      },
    ]);
  });

  it('reports owing in two currencies without outstandingAmount', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Dual Owing Carrier');
    await recognise(app, company.id, 30000, 'USD');
    await recognise(app, company.id, 800000, 'ZWG');

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([
      {
        code: 'COMMISSION_OUTSTANDING',
        details: {
          outstandingByCurrency: [
            { amountMinor: 1500, currency: 'USD' },
            { amountMinor: 40000, currency: 'ZWG' },
          ],
        },
      },
    ]);
    expect('outstandingAmount' in response.body.submissionBlockers[0].details).toBe(false);
  });

  it('never reports another company owing', async () => {
    const transporter = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Isolated Owing Carrier');
    const otherCompany = await createCompany(app, other.token, 'transporter', 'Isolated Owing Other');
    await recognise(app, otherCompany.id, 100000, 'USD');

    const response = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(response.body.submissionBlockers).toEqual([]);
  });

  it('excludes held commission, then reports it after finalisation, and clears it with credit', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Held Commission Carrier');
    const admin = await loginAdmin(app);
    const adminUser = await loadUser(app, admin.userId);
    const receivables = app.get(ReceivablesService);
    const completedAt = new Date(Date.now() - 2 * 3600 * 1000);
    const bookingId = randomUUID();
    const disputeRef = randomUUID();
    await receivables.recognise(null, {
      bookingId,
      transporterCompanyId: company.id,
      tripAmount: { amountMinor: 30000, currency: 'USD' },
      paymentMethod: 'cash',
      completedAt,
    });
    await receivables.holdForDispute(null, {
      bookingId,
      disputeRef,
      disputedAt: new Date(completedAt.getTime() + 1000),
    });

    const held = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(held.body.submissionBlockers).toEqual([]);

    await receivables.recordDisputeResponse(null, {
      bookingId,
      disputeRef,
      respondedAt: new Date(completedAt.getTime() + 2000),
    });
    await receivables.finaliseAfterDispute(null, {
      bookingId,
      disputeRef,
      source: 'admin_decision',
      outcomeReason: 'Reviewed with no change',
      actorUserId: admin.userId,
      at: new Date(completedAt.getTime() + 3000),
      idempotencyKey: `finalise-${randomUUID()}`,
    });
    const finalised = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(finalised.body.submissionBlockers).toEqual([
      {
        code: 'COMMISSION_OUTSTANDING',
        details: {
          outstandingAmount: { amountMinor: 1500, currency: 'USD' },
          outstandingByCurrency: [{ amountMinor: 1500, currency: 'USD' }],
        },
      },
    ]);

    const collection = await receivables.recordCollectionForAdmin(
      adminUser,
      company.id,
      { amount: { amountMinor: 2000, currency: 'USD' } },
      `collection-${randomUUID()}`,
    );
    expect(collection.creditedAmount).toEqual({ amountMinor: 500, currency: 'USD' });
    const cleared = expectPreview(
      await preview(app, transporter.token, company.id, { amountMinor: 1000, currency: 'USD' }),
    );
    expect(cleared.body.submissionBlockers).toEqual([]);
  });

  it('authenticates and authorises the preview exactly as the contract says', async () => {
    const transporter = await register(app, 'transporter');
    const outsider = await register(app, 'transporter');
    const shipper = await register(app, 'shipper');
    const company = await createCompany(app, transporter.token, 'transporter', 'Auth Carrier');
    await createCompany(app, outsider.token, 'transporter', 'Auth Outsider');
    const shipperCompany = await createCompany(app, shipper.token, 'shipper', 'Auth Shipper');
    const admin = await loginAdmin(app);
    const validBody = bodyFor(company.id, 100000, 'USD', 'prepay');

    const anonymous = await http(app, 'post', '/quotations/payout-preview', { body: validBody });
    expectPreview(anonymous, 401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');

    const asShipper = await http(app, 'post', '/quotations/payout-preview', {
      token: shipper.token,
      body: validBody,
    });
    expectPreview(asShipper, 403);
    expect(asShipper.body.code).toBe('ROLE_NOT_PERMITTED');

    const asNonMember = await http(app, 'post', '/quotations/payout-preview', {
      token: outsider.token,
      body: validBody,
    });
    expectPreview(asNonMember, 404);
    expect(asNonMember.body.code).toBe('NOT_FOUND');

    const unknownCompany = await http(app, 'post', '/quotations/payout-preview', {
      token: transporter.token,
      body: bodyFor(randomUUID(), 100000, 'USD', 'prepay'),
    });
    expectPreview(unknownCompany, 404);
    expect(unknownCompany.body.code).toBe('NOT_FOUND');

    const asAdmin = expectPreview(
      await http(app, 'post', '/quotations/payout-preview', {
        token: admin.token,
        body: validBody,
      }),
    );
    expect(asAdmin.body.agreedAmount).toEqual({ amountMinor: 100000, currency: 'USD' });

    const adminShipperCompany = await http(app, 'post', '/quotations/payout-preview', {
      token: admin.token,
      body: bodyFor(shipperCompany.id, 100000, 'USD', 'prepay'),
    });
    expectPreview(adminShipperCompany, 403);
    expect(adminShipperCompany.body.code).toBe('COMPANY_TYPE_MISMATCH');
    expect(shipperCompany.id).not.toBe(company.id);
  });

  it('rejects invalid preview bodies with 400 VALIDATION_ERROR', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Validation Carrier');
    const base = bodyFor(company.id, 100000, 'USD', 'prepay');

    const invalidBodies: Record<string, unknown>[] = [
      { amount: base.amount, paymentMethod: 'prepay' },
      { transporterCompanyId: 'not-a-uuid', amount: base.amount, paymentMethod: 'prepay' },
      bodyFor(company.id, 0, 'USD', 'prepay'),
      bodyFor(company.id, -1, 'USD', 'prepay'),
      bodyFor(company.id, 1.5, 'USD', 'prepay'),
      bodyFor(company.id, '100', 'USD', 'prepay'),
      bodyFor(company.id, 9007199254740992, 'USD', 'prepay'),
      bodyFor(company.id, 100000, 'usd', 'prepay'),
      bodyFor(company.id, 100000, 'USD', 'card'),
      { ...base, foo: 'not allowed' },
      { ...base, loadId: 'x' },
      { transporterCompanyId: company.id, paymentMethod: 'prepay' },
    ];

    for (const body of invalidBodies) {
      const response = expectPreview(
        await http(app, 'post', '/quotations/payout-preview', {
          token: transporter.token,
          body,
        }),
        400,
      );
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('checks load visibility and currency when loadId is supplied', async () => {
    const posted = await createPostedLoad(app, 'Preview Load Shipper');
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Load Preview Carrier');
    const base = bodyFor(company.id, 100000, 'USD', 'prepay');

    const matching = expectPreview(
      await http(app, 'post', '/quotations/payout-preview', {
        token: transporter.token,
        body: { ...base, loadId: posted.loadId },
      }),
    );
    expect(matching.body.agreedAmount).toEqual({ amountMinor: 100000, currency: 'USD' });

    const wrongCurrency = await http(app, 'post', '/quotations/payout-preview', {
      token: transporter.token,
      body: { ...base, amount: { amountMinor: 100000, currency: 'ZWG' }, loadId: posted.loadId },
    });
    expectPreview(wrongCurrency, 400);
    expect(wrongCurrency.body.code).toBe('CURRENCY_MISMATCH');

    const unknownLoad = await http(app, 'post', '/quotations/payout-preview', {
      token: transporter.token,
      body: { ...base, loadId: randomUUID() },
    });
    expectPreview(unknownLoad, 404);
    expect(unknownLoad.body.code).toBe('NOT_FOUND');

    const otherShipper = await register(app, 'shipper');
    const otherShipperCompany = await createCompany(
      app,
      otherShipper.token,
      'shipper',
      'Preview Draft Shipper',
    );
    const draft = await http(app, 'post', '/loads', {
      token: otherShipper.token,
      body: draftInput(otherShipperCompany.id),
    });
    expect(draft.status).toBe(201);
    const invisibleDraft = await http(app, 'post', '/quotations/payout-preview', {
      token: transporter.token,
      body: { ...base, loadId: draft.body.id },
    });
    expectPreview(invisibleDraft, 404);
    expect(invisibleDraft.body.code).toBe('NOT_FOUND');
  });

  it('writes nothing across a batch of previews', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Side Effect Carrier');
    const before = await tableCounts(app);

    const bodies = [
      bodyFor(company.id, 100000, 'USD', 'prepay'),
      bodyFor(company.id, 50000, 'USD', 'cash'),
      bodyFor(company.id, 25010, 'USD', 'escrow'),
      bodyFor(company.id, 1000, 'USD', 'deposit_balance'),
      bodyFor(company.id, 1000, 'USD', 'corporate_credit'),
      bodyFor(company.id, 1000, 'USD'),
    ];
    for (const body of bodies) {
      expectPreview(
        await http(app, 'post', '/quotations/payout-preview', {
          token: transporter.token,
          body,
          idempotencyKey: `preview-${randomUUID()}`,
        }),
      );
    }

    expect(await tableCounts(app)).toEqual(before);
  });

  it('routes POST /quotations/payout-preview to exactly one handler without shadowing', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Routing Carrier');
    const validBody = bodyFor(company.id, 100000, 'USD', 'prepay');

    const success = expectPreview(
      await http(app, 'post', '/quotations/payout-preview', {
        token: transporter.token,
        body: validBody,
      }),
    );
    expect(success.status).toBe(200);

    const quotationId = randomUUID();
    const responses = [
      await http(app, 'post', `/quotations/${quotationId}/withdraw`, {
        token: transporter.token,
        body: {},
      }),
      await http(app, 'post', `/quotations/${quotationId}/accept`, {
        token: transporter.token,
        body: {},
      }),
      await http(app, 'get', '/quotations/payout-preview', { token: transporter.token }),
    ];
    for (const response of responses) {
      expect(response.status).not.toBe(200);
      expect(response.body).not.toHaveProperty('agreedAmount');
      expect(response.body).not.toHaveProperty('submissionBlockers');
    }

    const routes = routeTable(app);
    const payoutRoutes = routes.filter(
      (route) => route.path === '/quotations/payout-preview' && route.post,
    );
    expect(payoutRoutes).toHaveLength(1);
    const payoutIndex = payoutRoutes[0].index;

    const shadowingParamRoutes = routes.filter(
      (route) => route.post && /^\/quotations\/:[^/]+$/.test(route.path),
    );
    for (const route of shadowingParamRoutes) {
      expect(route.index).toBeGreaterThan(payoutIndex);
    }

    // Express dispatches to the first matching layer, so the property that matters is:
    // the first POST route whose pattern matches the literal path is the preview handler.
    // (`/quotations/:id/withdraw|accept` can never match a one-segment path, so their
    // position relative to the preview route does not matter.)
    const matching = routes.filter(
      (route) => route.post && route.matches('/quotations/payout-preview'),
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
    expect(matching[0].path).toBe('/quotations/payout-preview');
  });
});

interface Session {
  token: string;
  userId: string;
  email: string;
}

interface RouteEntry {
  path: string;
  post: boolean;
  index: number;
  matches: (candidate: string) => boolean;
}

function bodyFor(
  transporterCompanyId: string,
  amountMinor: number | string,
  currency: string,
  paymentMethod?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transporterCompanyId,
    amount: { amountMinor, currency },
  };
  if (paymentMethod !== undefined) body.paymentMethod = paymentMethod;
  return body;
}

async function preview(
  app: INestApplication,
  token: string,
  transporterCompanyId: string,
  amount: { amountMinor: number; currency: string; paymentMethod?: string },
): Promise<HttpResult> {
  return http(app, 'post', '/quotations/payout-preview', {
    token,
    body: {
      transporterCompanyId,
      amount: { amountMinor: amount.amountMinor, currency: amount.currency },
      ...(amount.paymentMethod === undefined ? {} : { paymentMethod: amount.paymentMethod }),
    },
  });
}

function expectPreview(response: HttpResult, status = 200): HttpResult {
  expect(response.status).toBe(status);
  assertOperationResponse('previewQuotationPayout', status, response.body);
  if (status === 200) {
    assertSchema('PayoutPreview', response.body);
    expect(Object.keys(response.body).sort()).toEqual([...PREVIEW_KEYS].sort());
    for (const blocker of response.body.submissionBlockers as Record<string, unknown>[]) {
      expect(Object.keys(blocker).sort()).toEqual(['code', 'details']);
    }
  }
  return response;
}

async function register(app: INestApplication, role: 'shipper' | 'transporter'): Promise<Session> {
  const email = uniqueEmail(role);
  const response = await http(app, 'post', '/auth/register', {
    body: { email, password: `${role}-password`, fullName: `${role} user`, role },
  });
  if (response.status !== 201) {
    throw new Error(`register failed ${response.status}`);
  }
  return {
    token: response.body.accessToken as string,
    userId: response.body.user.id as string,
    email,
  };
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
  };
}

async function createCompany(
  app: INestApplication,
  token: string,
  type: 'shipper' | 'transporter',
  legalName: string,
): Promise<{ id: string }> {
  const response = await http(app, 'post', '/companies', {
    token,
    body: { type, legalName },
  });
  if (response.status !== 201) {
    throw new Error(`company create failed ${response.status}`);
  }
  return { id: response.body.id as string };
}

async function loadUser(app: INestApplication, userId: string): Promise<DbUser> {
  const result = await app.get(DbService).query<DbUser>('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user) throw new Error('user not found');
  return user;
}

async function recognise(
  app: INestApplication,
  companyId: string,
  amountMinor: number,
  currency: string,
) {
  return app.get(ReceivablesService).recognise(null, {
    bookingId: randomUUID(),
    transporterCompanyId: companyId,
    tripAmount: { amountMinor, currency },
    paymentMethod: 'cash',
  });
}

interface InsertBanOptions {
  userId: string;
  companyId: string;
  appliedByUserId: string;
  startsAt?: Date;
  liftedAt?: Date;
  liftedByUserId?: string;
  liftReason?: string;
}

async function insertBan(
  db: DbService,
  options: InsertBanOptions,
): Promise<{ id: string; endsAt: string }> {
  const reportId = randomUUID();
  const findingId = randomUUID();
  const banId = randomUUID();
  const startsAt = options.startsAt ?? new Date(Date.now() - 1000);
  const endsAt = new Date(startsAt.getTime() + 14 * 24 * 3600 * 1000);
  await db.query(
    `INSERT INTO off_platform_reports (
       id, booking_id, reported_by_user_id, reporter_role, suspected_party,
       description, created_at
     ) VALUES ($1, $2, $3, 'transporter', 'both', $4, clock_timestamp())`,
    [
      reportId,
      randomUUID(),
      options.appliedByUserId,
      'Confirmed off-platform dealing for the preview test',
    ],
  );
  await db.query(
    `INSERT INTO off_platform_findings (
       id, report_id, booking_id, outcome, reason, responsible_parties,
       reviewed_by_user_id, reviewed_at
     ) VALUES ($1, $2, $3, 'confirmed', $4, '[]'::jsonb, $5, clock_timestamp())`,
    [
      findingId,
      reportId,
      randomUUID(),
      'Confirmed off-platform dealing for the preview test',
      options.appliedByUserId,
    ],
  );
  const inserted = await db.query<{ ends_at: Date }>(
    `INSERT INTO off_platform_bans (
       id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at,
       duration_days, applied_by_user_id, lifted_at, lifted_by_user_id, lift_reason,
       created_at
     ) VALUES (
       $1, $2, $3, $4, 'transporter', $5, $6, $7, 14, $8, $9, $10, $11,
       clock_timestamp()
     )
     RETURNING ends_at`,
    [
      banId,
      findingId,
      options.userId,
      options.companyId,
      'Confirmed off-platform dealing for the preview test',
      startsAt,
      endsAt,
      options.appliedByUserId,
      options.liftedAt ?? null,
      options.liftedByUserId ?? null,
      options.liftReason ?? null,
    ],
  );
  return {
    id: banId,
    endsAt: new Date(inserted.rows[0].ends_at).toISOString(),
  };
}

async function tableCounts(app: INestApplication): Promise<Record<string, number>> {
  const db = app.get(DbService);
  const tables = [
    'idempotency_records',
    'commission_receivables',
    'commission_collections',
    'commission_credits',
    'loads',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table}`,
    );
    counts[table] = result.rows[0].count;
  }
  return counts;
}

interface RouterLike {
  _router: {
    stack: Array<{
      regexp: RegExp;
      route?: {
        path: string;
        methods: Record<string, boolean>;
      };
    }>;
  };
}

function routeTable(app: INestApplication): RouteEntry[] {
  const instance = app.getHttpAdapter().getInstance() as unknown as RouterLike;
  return instance._router.stack
    .map((layer, index) =>
      layer.route
        ? {
            path: layer.route.path,
            post: layer.route.methods.post === true,
            index,
            matches: (candidate: string) => layer.regexp.test(candidate),
          }
        : null,
    )
    .filter((entry): entry is RouteEntry => entry !== null);
}

async function createPostedLoad(
  app: INestApplication,
  legalName: string,
): Promise<{ shipper: Session; companyId: string; loadId: string }> {
  const shipper = await register(app, 'shipper');
  const company = await createCompany(app, shipper.token, 'shipper', legalName);
  await verifyOtp(app, shipper.token, shipper.userId);
  const admin = await loginAdmin(app);
  const verified = await http(app, 'patch', `/companies/${company.id}`, {
    token: admin.token,
    body: { verificationStatus: 'verified' },
  });
  if (verified.status !== 200) {
    throw new Error(`company verify failed ${verified.status}`);
  }
  const draft = await http(app, 'post', '/loads', {
    token: shipper.token,
    body: draftInput(company.id),
  });
  if (draft.status !== 201) {
    throw new Error(`load create failed ${draft.status}`);
  }
  const posted = await http(app, 'post', `/loads/${draft.body.id}/post`, {
    token: shipper.token,
  });
  if (posted.status !== 200) {
    throw new Error(`load post failed ${posted.status}`);
  }
  return { shipper, companyId: company.id, loadId: draft.body.id as string };
}

function draftInput(companyId: string): Record<string, unknown> {
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
