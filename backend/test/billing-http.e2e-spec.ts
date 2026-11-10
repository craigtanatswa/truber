import { ArgumentsHost, INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommissionGateService, COMMISSION_OUTSTANDING_MESSAGE } from '../src/billing/commission-gate.service';
import { CommissionReceivable, ReceivablesService } from '../src/billing/receivables.service';
import { ApiException } from '../src/common/api.exception';
import { ApiExceptionFilter } from '../src/common/exception.filter';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { assertOperationResponse, assertSchema } from './contract';
import { ADMIN_EMAIL, ADMIN_PASSWORD, http, seedAdmin, truncate, uniqueEmail } from './helpers';
import { prepareTestDatabase } from './prepare-db';

describe('billing HTTP endpoints', () => {
  let app: INestApplication;
  let admin: Session;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
    await seedAdmin();
    admin = await loginAdmin(app);
  });

  it('returns an empty commission account without an outstandingAmount key', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);

    const response = await http(app, 'get', `/companies/${companyId}/commission-account`, {
      token: transporter.token,
    });

    expect(response.status).toBe(200);
    assertOperationResponse('getCompanyCommissionAccount', 200, response.body);
    expect(response.body).toEqual({ companyId, outstandingByCurrency: [], receivables: [] });
    expect('outstandingAmount' in response.body).toBe(false);
  });

  it('copies the single outstanding currency into outstandingAmount', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');

    const response = await http(app, 'get', `/companies/${companyId}/commission-account`, {
      token: transporter.token,
    });

    expect(response.status).toBe(200);
    assertOperationResponse('getCompanyCommissionAccount', 200, response.body);
    expect(response.body.outstandingByCurrency).toEqual([{ amountMinor: 5000, currency: 'USD' }]);
    expect(response.body.outstandingAmount).toEqual({ amountMinor: 5000, currency: 'USD' });
  });

  it('omits outstandingAmount when owing spans two currencies', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');
    await recognise(app, companyId, 200000, 'ZWG');

    const response = await http(app, 'get', `/companies/${companyId}/commission-account`, {
      token: transporter.token,
    });

    expect(response.status).toBe(200);
    assertOperationResponse('getCompanyCommissionAccount', 200, response.body);
    expect(response.body.outstandingByCurrency).toEqual([
      { amountMinor: 5000, currency: 'USD' },
      { amountMinor: 10000, currency: 'ZWG' },
    ]);
    expect('outstandingAmount' in response.body).toBe(false);
  });

  it('allows members and admins to read the account and hides it from non-members', async () => {
    const owner = await register(app, 'transporter');
    const outsider = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, owner.token);
    await recognise(app, companyId, 100000, 'USD');

    const member = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: owner.token });
    expect(member.status).toBe(200);
    assertOperationResponse('getCompanyCommissionAccount', 200, member.body);

    const nonMember = await http(app, 'get', `/companies/${companyId}/commission-account`, {
      token: outsider.token,
    });
    expect(nonMember.status).toBe(404);
    assertOperationResponse('getCompanyCommissionAccount', 404, nonMember.body);
    expect(nonMember.body.code).toBe('NOT_FOUND');

    const anonymous = await http(app, 'get', `/companies/${companyId}/commission-account`);
    expect(anonymous.status).toBe(401);
    assertOperationResponse('getCompanyCommissionAccount', 401, anonymous.body);

    const asAdmin = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    expect(asAdmin.status).toBe(200);
    assertOperationResponse('getCompanyCommissionAccount', 200, asAdmin.body);
  });

  it('records a collection oldest-first and reports the balances after it', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    const later = await recognise(app, companyId, 40000, 'USD', new Date('2026-01-02T00:00:00.000Z'));
    const older = await recognise(app, companyId, 20000, 'USD', new Date('2026-01-01T00:00:00.000Z'));
    const zwg = await recognise(app, companyId, 50000, 'ZWG');

    const response = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: admin.token,
      idempotencyKey: 'collection-oldest-first',
      body: {
        amount: { amountMinor: 2500, currency: 'USD' },
        externalReference: 'BANK-001',
        notes: 'Partial collection',
      },
    });

    expect(response.status).toBe(201);
    assertOperationResponse('recordCommissionCollection', 201, response.body);
    expect(response.body.companyId).toBe(companyId);
    expect(response.body.amount).toEqual({ amountMinor: 2500, currency: 'USD' });
    expect(response.body.outstandingAmountAfter).toEqual({ amountMinor: 500, currency: 'USD' });
    expect(response.body.outstandingByCurrencyAfter).toEqual([
      { amountMinor: 500, currency: 'USD' },
      { amountMinor: 2500, currency: 'ZWG' },
    ]);
    expect(response.body.externalReference).toBe('BANK-001');
    expect(response.body.notes).toBe('Partial collection');
    expect(response.body.fundsMovementClaimedByTruber).toBe(false);
    expect(response.body.recordedByUserId).toBe(admin.userId);

    const account = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    assertOperationResponse('getCompanyCommissionAccount', 200, account.body);
    const rows = new Map<string, CommissionReceivable>(
      (account.body.receivables as CommissionReceivable[]).map((row) => [row.bookingId, row]),
    );
    expect(rows.get(older.bookingId)).toMatchObject({
      status: 'collected',
      collectedAmount: { amountMinor: 1000, currency: 'USD' },
      remainingAmount: { amountMinor: 0, currency: 'USD' },
    });
    expect(rows.get(later.bookingId)).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 1500, currency: 'USD' },
      remainingAmount: { amountMinor: 500, currency: 'USD' },
    });
    expect(rows.get(zwg.bookingId)).toMatchObject({
      status: 'open',
      collectedAmount: { amountMinor: 0, currency: 'ZWG' },
      remainingAmount: { amountMinor: 2500, currency: 'ZWG' },
    });
  });

  it('replays the same collection body and rejects the same key with a different body', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');

    const idempotencyKey = 'collection-replay-01';
    const body = { amount: { amountMinor: 2500, currency: 'USD' } };
    const original = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: admin.token,
      idempotencyKey,
      body,
    });
    expect(original.status).toBe(201);
    assertOperationResponse('recordCommissionCollection', 201, original.body);

    const replay = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: admin.token,
      idempotencyKey,
      body,
    });
    expect(replay.status).toBe(201);
    assertOperationResponse('recordCommissionCollection', 201, replay.body);
    expect(replay.body).toEqual(original.body);

    const account = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    assertOperationResponse('getCompanyCommissionAccount', 200, account.body);
    expect(account.body.outstandingByCurrency).toEqual([{ amountMinor: 2500, currency: 'USD' }]);
    const db = app.get(DbService);
    const collections = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM commission_collections');
    expect(collections.rows[0].count).toBe('1');

    const reused = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: admin.token,
      idempotencyKey,
      body: { amount: { amountMinor: 1000, currency: 'USD' } },
    });
    expect(reused.status).toBe(409);
    assertOperationResponse('recordCommissionCollection', 409, reused.body);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const afterReuse = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    expect(afterReuse.body.outstandingByCurrency).toEqual([{ amountMinor: 2500, currency: 'USD' }]);
  });

  it('requires a valid Idempotency-Key and validates the collection body', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');
    const url = `/admin/companies/${companyId}/commission-collections`;
    const validAmount = { amountMinor: 100, currency: 'USD' };

    const missingKey = await http(app, 'post', url, {
      token: admin.token,
      body: { amount: validAmount },
    });
    expect(missingKey.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, missingKey.body);
    expect(missingKey.body.code).toBe('VALIDATION_ERROR');
    expect(missingKey.body.details.fields).toEqual({ 'Idempotency-Key': 'required' });

    const zero = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-zero',
      body: { amount: { amountMinor: 0, currency: 'USD' } },
    });
    expect(zero.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, zero.body);

    const fractional = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-fractional',
      body: { amount: { amountMinor: 1.5, currency: 'USD' } },
    });
    expect(fractional.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, fractional.body);

    const unsafe = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-unsafe',
      body: { amount: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' } },
    });
    expect(unsafe.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, unsafe.body);

    const lowercase = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-lowercase',
      body: { amount: { amountMinor: 100, currency: 'usd' } },
    });
    expect(lowercase.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, lowercase.body);

    const extra = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-extra',
      body: { amount: validAmount, unexpected: true },
    });
    expect(extra.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, extra.body);

    const extraNested = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-extra-nested',
      body: { amount: { ...validAmount, unexpected: true } },
    });
    expect(extraNested.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, extraNested.body);

    const missingAmount = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-missing-amount',
      body: { notes: 'no amount' },
    });
    expect(missingAmount.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, missingAmount.body);

    const stringAmount = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'validation-string-amount',
      body: { amount: { amountMinor: '100', currency: 'USD' } },
    });
    expect(stringAmount.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, stringAmount.body);

    const shortKey = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'short',
      body: { amount: validAmount },
    });
    expect(shortKey.status).toBe(400);
    assertOperationResponse('recordCommissionCollection', 400, shortKey.body);

    const after = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    expect(after.status).toBe(200);
    expect(after.body.outstandingByCurrency).toEqual([{ amountMinor: 5000, currency: 'USD' }]);
  });

  it('rejects over-collection and a currency with nothing owing', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');
    const url = `/admin/companies/${companyId}/commission-collections`;

    const exceeds = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'collection-exceeds',
      body: { amount: { amountMinor: 5001, currency: 'USD' } },
    });
    expect(exceeds.status).toBe(409);
    assertOperationResponse('recordCommissionCollection', 409, exceeds.body);
    expect(exceeds.body.code).toBe('COLLECTION_EXCEEDS_OUTSTANDING');
    expect(exceeds.body.details).toEqual({ outstandingAmount: { amountMinor: 5000, currency: 'USD' } });

    const noOwing = await http(app, 'post', url, {
      token: admin.token,
      idempotencyKey: 'collection-no-owing',
      body: { amount: { amountMinor: 1, currency: 'ZWG' } },
    });
    expect(noOwing.status).toBe(409);
    assertOperationResponse('recordCommissionCollection', 409, noOwing.body);
    expect(noOwing.body.code).toBe('COLLECTION_EXCEEDS_OUTSTANDING');

    const account = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    expect(account.body.outstandingByCurrency).toEqual([{ amountMinor: 5000, currency: 'USD' }]);
  });

  it('forbids non-admin collection posts', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);

    const response = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: transporter.token,
      idempotencyKey: 'collection-forbidden',
      body: { amount: { amountMinor: 100, currency: 'USD' } },
    });

    expect(response.status).toBe(403);
    assertOperationResponse('recordCommissionCollection', 403, response.body);
    expect(response.body.code).toBe('ADMIN_ONLY');
    expect(response.body.message).toBe('Only an admin can record commission collections.');
  });

  it('returns 404 for an unknown company on both routes', async () => {
    const companyId = randomUUID();

    const account = await http(app, 'get', `/companies/${companyId}/commission-account`, { token: admin.token });
    expect(account.status).toBe(404);
    assertOperationResponse('getCompanyCommissionAccount', 404, account.body);
    expect(account.body.code).toBe('NOT_FOUND');

    const collection = await http(app, 'post', `/admin/companies/${companyId}/commission-collections`, {
      token: admin.token,
      idempotencyKey: 'collection-unknown-company',
      body: { amount: { amountMinor: 100, currency: 'USD' } },
    });
    expect(collection.status).toBe(404);
    assertOperationResponse('recordCommissionCollection', 404, collection.body);
    expect(collection.body.code).toBe('NOT_FOUND');
  });

  it('serializes the CommissionOutstandingError gate body for quotation and booking operations', async () => {
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    await recognise(app, companyId, 100000, 'USD');

    const gate = app.get(CommissionGateService);
    const filter = new ApiExceptionFilter();
    const single = applyFilter(filter, await captureError(gate.assertCanTakeNewWork(companyId)));
    const singleBody = {
      code: 'COMMISSION_OUTSTANDING',
      message: COMMISSION_OUTSTANDING_MESSAGE,
      details: {
        outstandingAmount: { amountMinor: 5000, currency: 'USD' },
        outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
      },
      requestId: 'req-test',
    };
    expect(single.status).toBe(409);
    expect(single.body).toEqual(singleBody);
    assertSchema('CommissionOutstandingError', single.body);
    for (const operationId of ['createQuotation', 'acceptQuotation', 'confirmBooking']) {
      assertOperationResponse(operationId, 409, single.body);
    }

    await recognise(app, companyId, 200000, 'ZWG');
    const multiple = applyFilter(filter, await captureError(gate.assertCanTakeNewWork(companyId)));
    const multipleBody = {
      code: 'COMMISSION_OUTSTANDING',
      message: COMMISSION_OUTSTANDING_MESSAGE,
      details: {
        outstandingByCurrency: [
          { amountMinor: 5000, currency: 'USD' },
          { amountMinor: 10000, currency: 'ZWG' },
        ],
      },
      requestId: 'req-test',
    };
    expect(multiple.status).toBe(409);
    expect(multiple.body).toEqual(multipleBody);
    expect(multiple.body.details && 'outstandingAmount' in multiple.body.details).toBe(false);
    assertSchema('CommissionOutstandingError', multiple.body);
    for (const operationId of ['createQuotation', 'acceptQuotation', 'confirmBooking']) {
      assertOperationResponse(operationId, 409, multiple.body);
    }
  });

  it('keeps unimplemented billing routes absent', async () => {
    const bookingId = randomUUID();
    const transporter = await register(app, 'transporter');
    const companyId = await createTransporterCompany(app, transporter.token);
    const cases: { method: 'get' | 'post'; path: string }[] = [
      { method: 'get', path: `/bookings/${bookingId}/payment-arrangements` },
      { method: 'post', path: `/payment-arrangements/${bookingId}/release` },
      { method: 'get', path: `/companies/${companyId}/credit-account` },
      { method: 'post', path: `/bookings/${bookingId}/payment-arrangements` },
    ];

    for (const item of cases) {
      const response = await http(app, item.method, item.path, { token: admin.token });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: 'Resource not found.',
        requestId: expect.any(String),
      });
      assertSchema('Error', response.body);
    }
  });
});

interface Session {
  token: string;
  userId: string;
  email: string;
}

async function register(app: INestApplication, role: 'shipper' | 'transporter'): Promise<Session> {
  const email = uniqueEmail(role);
  const response = await http(app, 'post', '/auth/register', {
    body: { email, password: `${role}-password`, fullName: `${role} user`, role },
  });
  if (response.status !== 201) {
    throw new Error(`register failed ${response.status}`);
  }
  return { token: response.body.accessToken as string, userId: response.body.user.id as string, email };
}

async function loginAdmin(app: INestApplication): Promise<Session> {
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

async function createTransporterCompany(app: INestApplication, token: string): Promise<string> {
  const response = await http(app, 'post', '/companies', {
    token,
    body: { type: 'transporter', legalName: 'HTTP Billing Carrier' },
  });
  if (response.status !== 201) {
    throw new Error(`create company failed ${response.status}`);
  }
  return response.body.id as string;
}

async function recognise(
  app: INestApplication,
  companyId: string,
  amountMinor: number,
  currency: string,
  completedAt?: Date,
): Promise<CommissionReceivable> {
  return app.get(ReceivablesService).recognise(null, {
    bookingId: randomUUID(),
    transporterCompanyId: companyId,
    tripAmount: { amountMinor, currency },
    paymentMethod: 'prepay',
    completedAt,
  });
}

async function captureError(promise: Promise<unknown>): Promise<ApiException> {
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

interface WireBody {
  [key: string]: unknown;
  details?: Record<string, unknown>;
}

interface WireResult {
  status: number;
  body: WireBody;
}

function applyFilter(filter: ApiExceptionFilter, error: ApiException): WireResult {
  const captured: WireResult = {
    status: 0,
    body: {},
  };
  const response = {
    setHeader: () => response,
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body as WireBody;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ requestId: 'req-test' }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(error, host);
  return captured;
}
