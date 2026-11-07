import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { assertOperationResponse } from './contract';
import { ADMIN_EMAIL, ADMIN_PASSWORD, http, latestPayload, seedAdmin, truncate, uniqueEmail } from './helpers';

describe('loads and companies API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate(app);
  });

  it('rejects unverified posting, wrong roles, tenant access, and client-controlled status', async () => {
    const shipper = await register(app, 'shipper');
    const other = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');

    const company = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'shipper', legalName: 'Harare Grain', city: 'Harare' },
    });
    expect(company.status).toBe(201);
    assertOperationResponse('createCompany', 201, company.body);
    expect(company.body.verificationStatus).toBe('unverified');
    expect(company.body.city).toBe('Harare');

    const noCity = await http(app, 'post', '/companies', {
      token: other.token,
      body: { type: 'shipper', legalName: 'No City Co' },
    });
    expect(noCity.body.city).toBeNull();
    expect(noCity.body.countryCode).toBe('ZW');

    const escalatedCompany = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'shipper', legalName: 'Fake Verified', verificationStatus: 'verified' },
    });
    expect(escalatedCompany.status).toBe(400);
    expect(escalatedCompany.body.code).toBe('VALIDATION_ERROR');

    const wrongType = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'transporter', legalName: 'Wrong Type' },
    });
    expect(wrongType.status).toBe(403);
    expect(wrongType.body.code).toBe('ROLE_COMPANY_TYPE_MISMATCH');

    const ownFleet = await http(app, 'post', '/companies', {
      token: transporter.token,
      body: { type: 'transporter', legalName: 'Fleet Co' },
    });
    expect(ownFleet.status).toBe(201);
    expect(ownFleet.body.verificationStatus).toBe('unverified');

    const hidden = await http(app, 'get', `/companies/${company.body.id}`, { token: other.token });
    expect(hidden.status).toBe(404);
    const shipperList = await http(app, 'get', '/companies', { token: shipper.token });
    expect(shipperList.status).toBe(200);
    assertOperationResponse('listCompanies', 200, shipperList.body);
    expect(shipperList.body.data.map((row: { id: string }) => row.id)).toEqual([company.body.id]);

    const selfVerify = await http(app, 'patch', `/companies/${company.body.id}`, {
      token: shipper.token,
      body: { verificationStatus: 'verified' },
    });
    expect(selfVerify.status).toBe(403);
    expect(selfVerify.body.code).toBe('VERIFICATION_ADMIN_ONLY');
    const still = await http(app, 'get', `/companies/${company.body.id}`, { token: shipper.token });
    expect(still.body.verificationStatus).toBe('unverified');

    const draft = await createDraft(app, shipper.token, company.body.id as string);
    expect(draft.status).toBe(201);
    assertOperationResponse('createLoad', 201, draft.body);
    expect(draft.body.status).toBe('draft');

    const forced = await http(app, 'post', '/loads', {
      token: shipper.token,
      body: { ...draftInput(company.body.id as string), status: 'posted' },
    });
    expect(forced.status).toBe(400);
    const db = app.get(DbService);
    const count = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM loads');
    expect(count.rows[0].count).toBe('1');

    const denied = await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token });
    expect(denied.status).toBe(403);
    assertOperationResponse('postLoad', 403, denied.body);
    expect(denied.body.code).toBe('VERIFICATION_REQUIRED');

    await verifyOtp(app, shipper.token, shipper.userId);
    const stillDenied = await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token });
    expect(stillDenied.status).toBe(403);
    expect(stillDenied.body.details.companyVerificationStatus).toBe('unverified');
    expect(stillDenied.body.details.accountStatus).toBe('active');

    const transporterCreate = await http(app, 'post', '/loads', {
      token: transporter.token,
      body: draftInput(company.body.id as string),
    });
    expect(transporterCreate.status).toBe(403);
    expect(transporterCreate.body.code).toBe('ROLE_NOT_PERMITTED');

    const otherGet = await http(app, 'get', `/loads/${draft.body.id}`, { token: other.token });
    expect(otherGet.status).toBe(404);
    const transporterDraft = await http(app, 'get', `/loads/${draft.body.id}`, { token: transporter.token });
    expect(transporterDraft.status).toBe(404);
    const otherList = await http(app, 'get', '/loads', { token: other.token });
    expect(otherList.body.data).toEqual([]);
    const transporterList = await http(app, 'get', '/loads', { token: transporter.token });
    expect(transporterList.body.data).toEqual([]);

    const foreignCompany = await http(app, 'post', '/loads', {
      token: shipper.token,
      body: draftInput(noCity.body.id as string),
    });
    expect(foreignCompany.status).toBe(404);

    const patchedDraft = await http(app, 'patch', `/loads/${draft.body.id}`, {
      token: shipper.token,
      body: { goodsType: 'Maize' },
    });
    expect(patchedDraft.status).toBe(200);
    expect(patchedDraft.body.goodsType).toBe('Maize');
    expect(patchedDraft.body.status).toBe('draft');

    const statusPatch = await http(app, 'patch', `/loads/${draft.body.id}`, {
      token: shipper.token,
      body: { status: 'posted' },
    });
    expect(statusPatch.status).toBe(400);

    const badDate = await http(app, 'post', '/loads', {
      token: shipper.token,
      body: { ...draftInput(company.body.id as string), loadingDate: '2026-12-02', deliveryDeadline: '2026-12-01' },
    });
    expect(badDate.status).toBe(400);
    expect(badDate.body.code).toBe('DELIVERY_DEADLINE_BEFORE_LOADING');
    assertOperationResponse('createLoad', 400, badDate.body);

    const badMoney = await http(app, 'post', '/loads', {
      token: shipper.token,
      body: { ...draftInput(company.body.id as string), offeredRate: { amountMinor: 100, currency: 'ZWG' } },
    });
    expect(badMoney.status).toBe(400);
    expect(badMoney.body.code).toBe('CURRENCY_MISMATCH');
  });

  it('posts, filters, updates, cancels, and reloads a verified shipper load with PostGIS points', async () => {
    const db = app.get(DbService);
    const extension = await db.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'postgis'`);
    expect(extension.rows[0]?.extname).toBe('postgis');

    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const outsider = await register(app, 'shipper');
    const company = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'shipper', legalName: 'Verified Grain', city: 'Harare' },
    });
    const secondCompany = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'shipper', legalName: 'Second Yard' },
    });
    await verifyOtp(app, shipper.token, shipper.userId);
    await seedAdmin();
    const admin = await http(app, 'post', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const verified = await http(app, 'patch', `/companies/${company.body.id}`, {
      token: admin.body.accessToken as string,
      body: { verificationStatus: 'verified' },
    });
    expect(verified.status).toBe(200);
    assertOperationResponse('updateCompany', 200, verified.body);
    expect(verified.body.verificationStatus).toBe('verified');

    const loads = await Promise.all([
      createDraft(app, shipper.token, company.body.id as string, {
        goodsType: 'Fertiliser',
        weightKg: 1000,
        truckTypeRequired: 'flatbed',
        pickupAddress: 'Harare Depot',
        destinationAddress: 'Bulawayo Warehouse',
        loadingDate: '2026-12-01',
        pickupPoint: { latitude: -17.8292, longitude: 31.0522 },
        destinationPoint: { latitude: -20.1325, longitude: 28.6265 },
        offeredRate: { amountMinor: 100000, currency: 'USD' },
      }),
      createDraft(app, shipper.token, company.body.id as string, {
        goodsType: 'Cement',
        weightKg: 5000,
        truckTypeRequired: 'box',
        pickupAddress: 'Mutare Yard',
        destinationAddress: 'Harare Industrial',
        loadingDate: '2026-12-15',
      }),
      createDraft(app, shipper.token, secondCompany.body.id as string, {
        goodsType: 'Sugar',
        weightKg: 20000,
        truckTypeRequired: 'flatbed',
        pickupAddress: 'Gweru Mill',
        destinationAddress: 'Masvingo Depot',
        loadingDate: '2027-01-02',
      }),
    ]);
    for (const created of loads) {
      expect(created.status).toBe(201);
    }

    const unverifiedPost = await http(app, 'post', `/loads/${loads[2].body.id}/post`, { token: shipper.token });
    expect(unverifiedPost.status).toBe(403);

    const postedResponses = [];
    for (const created of loads.slice(0, 2)) {
      const posted = await http(app, 'post', `/loads/${created.body.id}/post`, {
        token: shipper.token,
        idempotencyKey: `post-${created.body.id}`,
      });
      expect(posted.status).toBe(200);
      assertOperationResponse('postLoad', 200, posted.body);
      expect(posted.body.status).toBe('posted');
      postedResponses.push(posted);
    }
    const replay = await http(app, 'post', `/loads/${loads[0].body.id}/post`, {
      token: shipper.token,
      idempotencyKey: `post-${loads[0].body.id}`,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(postedResponses[0].body);
    const conflictKey = await http(app, 'post', `/loads/${loads[1].body.id}/post`, {
      token: shipper.token,
      idempotencyKey: `post-${loads[0].body.id}`,
    });
    expect(conflictKey.status).toBe(409);
    expect(conflictKey.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    await http(app, 'patch', `/companies/${secondCompany.body.id}`, {
      token: admin.body.accessToken as string,
      body: { verificationStatus: 'verified' },
    });
    expect((await http(app, 'post', `/loads/${loads[2].body.id}/post`, { token: shipper.token })).status).toBe(200);

    const detail = await http(app, 'get', `/loads/${loads[0].body.id}`, { token: shipper.token });
    expect(detail.status).toBe(200);
    assertOperationResponse('getLoad', 200, detail.body);
    expect(detail.body.pickupPoint.latitude).toBeCloseTo(-17.8292, 4);
    expect(detail.body.pickupPoint.longitude).toBeCloseTo(31.0522, 4);
    expect(detail.body.offeredRate).toEqual({ amountMinor: 100000, currency: 'USD' });
    const point = await db.query<{ wkt: string }>(
      `SELECT ST_AsText(pickup_geog::geometry) AS wkt FROM loads WHERE id = $1`,
      [loads[0].body.id],
    );
    expect(point.rows[0].wkt).toContain('POINT');
    expect(point.rows[0].wkt).toContain('31.0522');

    const flatbeds = await http(app, 'get', '/loads?truckTypeRequired=flatbed&pageSize=10', { token: shipper.token });
    assertOperationResponse('listLoads', 200, flatbeds.body);
    expect(flatbeds.body.data.map((row: { goodsType: string }) => row.goodsType).sort()).toEqual(['Fertiliser', 'Sugar']);
    const weight = await http(app, 'get', '/loads?minWeightKg=4000&maxWeightKg=6000', { token: shipper.token });
    expect(weight.body.data.map((row: { goodsType: string }) => row.goodsType)).toEqual(['Cement']);
    const pickup = await http(app, 'get', '/loads?pickupText=harare', { token: shipper.token });
    expect(pickup.body.data.map((row: { goodsType: string }) => row.goodsType)).toEqual(['Fertiliser']);
    const destination = await http(app, 'get', '/loads?destinationText=HARARE', { token: shipper.token });
    expect(destination.body.data.map((row: { goodsType: string }) => row.goodsType)).toEqual(['Cement']);
    const dates = await http(app, 'get', '/loads?pickupDateFrom=2026-12-10&pickupDateTo=2026-12-31', { token: shipper.token });
    expect(dates.body.data.map((row: { goodsType: string }) => row.goodsType)).toEqual(['Cement']);
    const byCompany = await http(app, 'get', `/loads?companyId=${secondCompany.body.id}`, { token: shipper.token });
    expect(byCompany.body.data.map((row: { goodsType: string }) => row.goodsType)).toEqual(['Sugar']);
    const page = await http(app, 'get', '/loads?page=1&pageSize=2', { token: shipper.token });
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    const page2 = await http(app, 'get', '/loads?page=2&pageSize=2', { token: shipper.token });
    expect(page2.body.data).toHaveLength(1);
    expect((await http(app, 'get', '/loads?pageSize=101', { token: shipper.token })).status).toBe(400);

    const visible = await http(app, 'get', '/loads?truckTypeRequired=box', { token: transporter.token });
    expect(visible.body.data).toHaveLength(1);
    expect(visible.body.data[0].id).toBe(loads[1].body.id);
    const outsiderList = await http(app, 'get', '/loads', { token: outsider.token });
    expect(outsiderList.body.data).toEqual([]);
    expect((await http(app, 'get', `/loads/${loads[0].body.id}`, { token: outsider.token })).status).toBe(404);

    const mutate = await http(app, 'patch', `/loads/${loads[0].body.id}`, {
      token: transporter.token,
      body: { goodsType: 'Hijack' },
    });
    expect(mutate.status).toBe(403);
    expect((await http(app, 'post', `/loads/${loads[0].body.id}/cancel`, { token: transporter.token, body: {} })).status).toBe(403);
    expect((await http(app, 'patch', `/loads/${loads[0].body.id}`, { token: outsider.token, body: { goodsType: 'Nope' } })).status).toBe(404);

    const edited = await http(app, 'patch', `/loads/${loads[0].body.id}`, {
      token: shipper.token,
      body: { specialRequirements: 'Keep dry', pickupPoint: null },
    });
    expect(edited.status).toBe(200);
    assertOperationResponse('updateLoad', 200, edited.body);
    expect(edited.body.specialRequirements).toBe('Keep dry');
    expect(edited.body.pickupPoint).toBeNull();
    expect(edited.body.status).toBe('posted');

    const cancelled = await http(app, 'post', `/loads/${loads[0].body.id}/cancel`, {
      token: shipper.token,
      body: { reason: 'Shipper withdrew the cargo' },
      idempotencyKey: 'cancel-fertiliser-01',
    });
    expect(cancelled.status).toBe(200);
    assertOperationResponse('cancelLoad', 200, cancelled.body);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.reason).toBeUndefined();
    const reason = await db.query<{ cancel_reason: string; status: string }>('SELECT cancel_reason, status FROM loads WHERE id = $1', [
      loads[0].body.id,
    ]);
    expect(reason.rows[0]).toEqual({ cancel_reason: 'Shipper withdrew the cargo', status: 'cancelled' });
    const cancelReplay = await http(app, 'post', `/loads/${loads[0].body.id}/cancel`, {
      token: shipper.token,
      body: { reason: 'Shipper withdrew the cargo' },
      idempotencyKey: 'cancel-fertiliser-01',
    });
    expect(cancelReplay.status).toBe(200);
    expect(cancelReplay.body.status).toBe('cancelled');
    const secondCancel = await http(app, 'post', `/loads/${loads[0].body.id}/cancel`, { token: shipper.token, body: {} });
    expect(secondCancel.status).toBe(409);
    expect((await http(app, 'get', `/loads/${loads[0].body.id}`, { token: transporter.token })).status).toBe(404);
    expect((await http(app, 'get', `/loads/${loads[0].body.id}`, { token: shipper.token })).body.status).toBe('cancelled');

    const persisted = await db.query<{ status: string; goods_type: string }>('SELECT status, goods_type FROM loads WHERE id = $1', [
      loads[1].body.id,
    ]);
    expect(persisted.rows[0]).toEqual({ status: 'posted', goods_type: 'Cement' });
  });

  it('serializes concurrent post and cancel transitions', async () => {
    const shipper = await register(app, 'shipper');
    const company = await http(app, 'post', '/companies', {
      token: shipper.token,
      body: { type: 'shipper', legalName: 'Race Co' },
    });
    await verifyOtp(app, shipper.token, shipper.userId);
    await seedAdmin();
    const admin = await http(app, 'post', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    await http(app, 'patch', `/companies/${company.body.id}`, {
      token: admin.body.accessToken as string,
      body: { verificationStatus: 'verified' },
    });
    const first = await createDraft(app, shipper.token, company.body.id as string, { goodsType: 'Race post' });
    const second = await createDraft(app, shipper.token, company.body.id as string, { goodsType: 'Race cancel' });
    await http(app, 'post', `/loads/${second.body.id}/post`, { token: shipper.token });

    const posted = await Promise.all([
      http(app, 'post', `/loads/${first.body.id}/post`, { token: shipper.token }),
      http(app, 'post', `/loads/${first.body.id}/post`, { token: shipper.token }),
    ]);
    expect(posted.filter((result) => result.status === 200)).toHaveLength(1);
    expect(posted.filter((result) => result.status === 409)).toHaveLength(1);

    const cancelled = await Promise.all([
      http(app, 'post', `/loads/${second.body.id}/cancel`, { token: shipper.token, body: { reason: 'a' } }),
      http(app, 'post', `/loads/${second.body.id}/cancel`, { token: shipper.token, body: { reason: 'b' } }),
    ]);
    expect(cancelled.filter((result) => result.status === 200)).toHaveLength(1);
    expect(cancelled.filter((result) => result.status === 409)).toHaveLength(1);
    const db = app.get(DbService);
    const rows = await db.query<{ id: string; status: string }>('SELECT id, status FROM loads ORDER BY goods_type');
    expect(rows.rows).toEqual([
      { id: second.body.id, status: 'cancelled' },
      { id: first.body.id, status: 'posted' },
    ]);
  });

  it('does not expose booking or payment operations as working endpoints', async () => {
    const shipper = await register(app, 'shipper');
    for (const path of ['/bookings', '/quotations/11111111-1111-4111-8111-111111111111', '/payment-arrangements']) {
      const response = path === '/bookings'
        ? await http(app, 'get', path, { token: shipper.token })
        : await http(app, 'get', path, { token: shipper.token });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
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

async function createDraft(app: INestApplication, token: string, companyId: string, overrides: Record<string, unknown> = {}) {
  return http(app, 'post', '/loads', { token, body: draftInput(companyId, overrides) });
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
