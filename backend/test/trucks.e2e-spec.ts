import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { ApiException } from '../src/common/api.exception';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { qualifyAppSql } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { assertTruckUsableForQuote } from '../src/trucks/truck-usability';
import { http, seedAdmin, truncate } from './helpers';
import {
  activate,
  createCompany,
  createTruck,
  expectContract,
  loginAdmin,
  register,
  Session,
} from './item5-helpers';
import { prepareTestDatabase } from './prepare-db';

type BanState = 'active' | 'lifted' | 'expired';

async function insertCompanyBan(input: {
  companyId: string;
  userId: string;
  appliedByUserId: string;
  state?: BanState;
}): Promise<{ id: string; endsAt: string }> {
  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env.db, 'migration'));
  const sql = (text: string) =>
    qualifyAppSql(text, { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA });
  const reportId = randomUUID();
  const findingId = randomUUID();
  const banId = randomUUID();
  const bookingId = randomUUID();
  const state = input.state ?? 'active';
  const startsAtExpression =
    state === 'expired' ? "clock_timestamp() - interval '15 days'" : 'clock_timestamp()';
  try {
    await pool.query(
      sql(`INSERT INTO off_platform_reports (
         id, booking_id, reported_by_user_id, reporter_role, suspected_party, description, created_at
       ) VALUES ($1, $2, $3, 'admin', 'transporter', $4, clock_timestamp())`),
      [reportId, bookingId, input.appliedByUserId, 'Direct test report for truck restriction visibility'],
    );
    await pool.query(
      sql(`INSERT INTO off_platform_findings (
         id, report_id, booking_id, outcome, reason, responsible_parties, reviewed_by_user_id, reviewed_at
       ) VALUES ($1, $2, $3, 'confirmed', $4, '[]'::jsonb, $5, clock_timestamp())`),
      [
        findingId,
        reportId,
        bookingId,
        'Direct test finding for truck restriction visibility',
        input.appliedByUserId,
      ],
    );
    const inserted = await pool.query<{ endsAt: Date | string }>(
      sql(`WITH applied AS (SELECT ${startsAtExpression} AS starts_at)
       INSERT INTO off_platform_bans (
         id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at,
         duration_days, applied_by_user_id, created_at, lifted_at, lifted_by_user_id, lift_reason
       )
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'transporter', $5::text, applied.starts_at,
              applied.starts_at + interval '336 hours', 14, $6::uuid, applied.starts_at,
              CASE WHEN $7::boolean THEN applied.starts_at ELSE NULL END,
              CASE WHEN $7::boolean THEN $6::uuid ELSE NULL END,
              CASE WHEN $7::boolean THEN $8::text ELSE NULL END
       FROM applied
       RETURNING ends_at AS "endsAt"`),
      [
        banId,
        findingId,
        input.userId,
        input.companyId,
        'Direct test off-platform ban',
        input.appliedByUserId,
        state === 'lifted',
        state === 'lifted' ? 'Lifting the direct test ban early' : null,
      ],
    );
    return { id: banId, endsAt: new Date(inserted.rows[0].endsAt).toISOString() };
  } finally {
    await pool.end();
  }
}

describe('trucks API', () => {
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
    await seedAdmin();
  });

  async function setCompanyVerified(admin: Session, companyId: string): Promise<void> {
    expectContract(
      'updateCompany',
      await http(app, 'patch', `/companies/${companyId}`, {
        token: admin.token,
        body: { verificationStatus: 'verified' },
      }),
      200,
    );
  }

  async function setTruckStatus(admin: Session, truckId: string, verificationStatus: string) {
    return expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truckId}`, {
        token: admin.token,
        body: { verificationStatus },
      }),
      200,
    );
  }

  it('lets an owning transporter create a truck with a normalised registration number', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Create Fleet');

    const created = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: transporter.token,
        body: {
          companyId: company.id,
          registrationNumber: 'aez 12-34',
          truckType: 'flatbed',
          capacityKg: 12_000,
        },
      }),
      201,
    );

    expect(created.body).toMatchObject({
      companyId: company.id,
      registrationNumber: 'AEZ1234',
      verificationStatus: 'unverified',
    });
  });

  it('rejects duplicate registration numbers across case, spacing, Unicode and punctuation variants', async () => {
    const transporter = await register(app, 'transporter');
    const firstCompany = await createCompany(app, transporter.token, 'transporter', 'Duplicate One');
    const secondCompany = await createCompany(app, transporter.token, 'transporter', 'Duplicate Two');

    await createTruck(app, transporter.token, firstCompany.id, { registrationNumber: 'aez-12 34' });
    await createTruck(app, transporter.token, firstCompany.id, { registrationNumber: 'ABC123' });

    const duplicates: Array<[string, string]> = [
      [firstCompany.id, 'AEZ 12-34'],
      [firstCompany.id, 'aez\t12\t34'],
      [secondCompany.id, 'aez-12-34'],
      [firstCompany.id, 'ABC\u200b123'],
      [secondCompany.id, '\ufeffABC123'],
      [firstCompany.id, 'ＡＢＣ１２３'],
      [secondCompany.id, 'ＡＢＣ123'],
      [firstCompany.id, 'ABC.123'],
      [secondCompany.id, 'abc-123'],
      [firstCompany.id, 'ABC 123'],
      [secondCompany.id, 'ABC_123'],
      [firstCompany.id, 'A.B-C_1/2 3'],
    ];
    for (const [companyId, registrationNumber] of duplicates) {
      const response = expectContract(
        'createTruck',
        await http(app, 'post', '/trucks', {
          token: transporter.token,
          body: { companyId, registrationNumber, truckType: 'box', capacityKg: 5000 },
        }),
        409,
      );
      expect(response.body.code).toBe('TRUCK_REGISTRATION_EXISTS');
    }
  });

  it('rejects unusable registration numbers without creating a truck row', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Invalid Plates');

    const cases: Array<{ registrationNumber: string; expectField: boolean }> = [
      { registrationNumber: '', expectField: false },
      { registrationNumber: ' .-_ ', expectField: true },
      { registrationNumber: '\u200b\u200b', expectField: true },
      { registrationNumber: 'АВС123', expectField: true },
      { registrationNumber: 'ABCß', expectField: true },
      { registrationNumber: 'A'.repeat(65), expectField: false },
      { registrationNumber: 'A'.repeat(63) + '\u338f', expectField: true },
    ];
    for (const { registrationNumber, expectField } of cases) {
      const response = expectContract(
        'createTruck',
        await http(app, 'post', '/trucks', {
          token: transporter.token,
          body: { companyId: company.id, registrationNumber, truckType: 'box', capacityKg: 5000 },
        }),
        400,
      );
      expect(response.body.code).toBe('VALIDATION_ERROR');
      if (expectField) {
        expect(response.body.details?.fields?.registrationNumber).toBe(
          'must contain 1 to 64 letters A-Z or digits 0-9 after removing spaces and punctuation',
        );
      }
    }

    const env = loadEnv();
    const pool = new Pool(buildPoolConfig(env.db, 'migration'));
    try {
      const count = await pool.query<{ count: number }>(
        qualifyAppSql('SELECT count(*)::int AS count FROM trucks', {
          appSchema: env.db.DB_SCHEMA,
          postgisSchema: env.db.POSTGIS_SCHEMA,
        }),
      );
      expect(count.rows[0].count).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('enforces company membership, transporter company type and admin validation', async () => {
    const shipper = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper.token, 'shipper', 'Shipper Co');
    const transporterA = await register(app, 'transporter');
    const companyA = await createCompany(app, transporterA.token, 'transporter', 'Transporter A');
    const transporterB = await register(app, 'transporter');
    await createCompany(app, transporterB.token, 'transporter', 'Transporter B');
    const admin = await loginAdmin(app);
    const truckBody = { truckType: 'flatbed', capacityKg: 9000 };

    const shipperAttempt = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: shipper.token,
        body: { companyId: shipperCompany.id, registrationNumber: 'SHIP123', ...truckBody },
      }),
      403,
    );
    expect(shipperAttempt.body.code).toBe('FORBIDDEN');

    const foreignAttempt = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: transporterB.token,
        body: { companyId: companyA.id, registrationNumber: 'FOREIGN1', ...truckBody },
      }),
      403,
    );
    expect(foreignAttempt.body.code).toBe('FORBIDDEN');

    const unknownCompanyAttempt = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: transporterA.token,
        body: { companyId: randomUUID(), registrationNumber: 'UNKNOWN1', ...truckBody },
      }),
      403,
    );
    expect(unknownCompanyAttempt.body.code).toBe('FORBIDDEN');

    const shipperTypeAttempt = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: admin.token,
        body: { companyId: shipperCompany.id, registrationNumber: 'ADMINSHIP', ...truckBody },
      }),
      403,
    );
    expect(shipperTypeAttempt.body.code).toBe('COMPANY_NOT_TRANSPORTER');

    const adminUnknown = expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: admin.token,
        body: { companyId: randomUUID(), registrationNumber: 'ADMINUNK', ...truckBody },
      }),
      400,
    );
    expect(adminUnknown.body.code).toBe('VALIDATION_ERROR');
  });

  it('scopes truck lists to the caller fleet and everything for admins while disabling shipper browsing', async () => {
    const transporterA = await register(app, 'transporter');
    const companyA = await createCompany(app, transporterA.token, 'transporter', 'Scope A');
    const truckA1 = await createTruck(app, transporterA.token, companyA.id, {
      registrationNumber: 'SCOPEA1',
    });
    const truckA2 = await createTruck(app, transporterA.token, companyA.id, {
      registrationNumber: 'SCOPEA2',
      truckType: 'box',
    });

    const transporterB = await register(app, 'transporter');
    const companyB = await createCompany(app, transporterB.token, 'transporter', 'Scope B');
    const truckB = await createTruck(app, transporterB.token, companyB.id, {
      registrationNumber: 'SCOPEB1',
    });

    const admin = await loginAdmin(app);
    await setTruckStatus(admin, truckA1.id, 'verified');
    await setTruckStatus(admin, truckB.id, 'verified');

    const ownList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: transporterA.token }),
      200,
    );
    expect(ownList.body.data.map((truck: { id: string }) => truck.id).sort()).toEqual(
      [truckA1.id, truckA2.id].sort(),
    );

    const shipper = await register(app, 'shipper');
    const shipperList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: shipper.token }),
      403,
    );
    expect(shipperList.body.code).toBe('TRUCK_BROWSING_DISABLED');

    const shipperVerifiedList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?verificationStatus=verified', { token: shipper.token }),
      403,
    );
    expect(shipperVerifiedList.body.code).toBe('TRUCK_BROWSING_DISABLED');

    const adminList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: admin.token }),
      200,
    );
    const adminIds = adminList.body.data.map((truck: { id: string }) => truck.id);
    expect(adminIds).toEqual(expect.arrayContaining([truckA1.id, truckA2.id, truckB.id]));
  });

  it('filters, paginates and validates list query parameters', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Filter Fleet');
    const flatbed = await createTruck(app, transporter.token, company.id, {
      registrationNumber: 'FILTER1',
      truckType: 'flatbed',
    });
    const second = await createTruck(app, transporter.token, company.id, {
      registrationNumber: 'FILTER2',
      truckType: 'box',
    });
    const third = await createTruck(app, transporter.token, company.id, {
      registrationNumber: 'FILTER3',
      truckType: 'flatbed',
    });

    const otherTransporter = await register(app, 'transporter');
    const otherCompany = await createCompany(app, otherTransporter.token, 'transporter', 'Other Fleet');
    const otherTruck = await createTruck(app, otherTransporter.token, otherCompany.id, {
      registrationNumber: 'OTHERFILTER',
      truckType: 'flatbed',
    });

    const admin = await loginAdmin(app);
    await setTruckStatus(admin, flatbed.id, 'verified');
    await setTruckStatus(admin, third.id, 'verified');

    const byCompany = expectContract(
      'listTrucks',
      await http(app, 'get', `/trucks?companyId=${company.id}`, { token: admin.token }),
      200,
    );
    expect(byCompany.body.data.map((truck: { id: string }) => truck.id).sort()).toEqual(
      [flatbed.id, second.id, third.id].sort(),
    );
    expect(byCompany.body.data.map((truck: { id: string }) => truck.id)).not.toContain(otherTruck.id);

    const byType = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?truckType=box', { token: admin.token }),
      200,
    );
    expect(byType.body.data.length).toBeGreaterThan(0);
    expect(
      byType.body.data.every((truck: { truckType: string }) => truck.truckType === 'box'),
    ).toBe(true);

    const byStatus = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?verificationStatus=verified', { token: admin.token }),
      200,
    );
    expect(byStatus.body.data.map((truck: { id: string }) => truck.id).sort()).toEqual(
      [flatbed.id, third.id].sort(),
    );

    const paginated = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?pageSize=1', { token: transporter.token }),
      200,
    );
    expect(paginated.body.data).toHaveLength(1);
    expect(paginated.body.meta).toMatchObject({ page: 1, pageSize: 1, totalItems: 3, totalPages: 3 });

    const withoutAvailableOn = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: transporter.token }),
      200,
    );
    const availableOnValues = ['2030-01-01', '2030-02-30', 'garbage'];
    for (const availableOn of availableOnValues) {
      const ignored = expectContract(
        'listTrucks',
        await http(app, 'get', `/trucks?availableOn=${availableOn}`, { token: transporter.token }),
        200,
      );
      expect(ignored.body.meta).toEqual(withoutAvailableOn.body.meta);
      expect(ignored.body.data.map((truck: { id: string }) => truck.id)).toEqual(
        withoutAvailableOn.body.data.map((truck: { id: string }) => truck.id),
      );
    }
    const availableOnQueries = ['availableOn=a&availableOn=b', 'availableOn='];
    for (const availableOnQuery of availableOnQueries) {
      const ignored = expectContract(
        'listTrucks',
        await http(app, 'get', `/trucks?${availableOnQuery}`, { token: transporter.token }),
        200,
      );
      expect(ignored.body.meta).toEqual(withoutAvailableOn.body.meta);
      expect(ignored.body.data.map((truck: { id: string }) => truck.id)).toEqual(
        withoutAvailableOn.body.data.map((truck: { id: string }) => truck.id),
      );
    }

    const unknownQuery = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?status=verified', { token: transporter.token }),
      400,
    );
    expect(unknownQuery.body.code).toBe('VALIDATION_ERROR');
  });

  it('applies getTruck visibility rules', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Get Fleet');
    const truck = await createTruck(app, owner.token, company.id, { registrationNumber: 'GETOWN1' });
    const otherTransporter = await register(app, 'transporter');
    const shipper = await register(app, 'shipper');
    const admin = await loginAdmin(app);

    expectContract('getTruck', await http(app, 'get', `/trucks/${truck.id}`, { token: owner.token }), 200);

    const otherResult = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: otherTransporter.token }),
      404,
    );
    expect(otherResult.body.code).toBe('NOT_FOUND');

    const shipperUnverified = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: shipper.token }),
      403,
    );
    expect(shipperUnverified.body.code).toBe('TRUCK_BROWSING_DISABLED');

    await setTruckStatus(admin, truck.id, 'verified');

    const shipperVerified = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: shipper.token }),
      403,
    );
    expect(shipperVerified.body.code).toBe('TRUCK_BROWSING_DISABLED');

    const shipperMissing = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${randomUUID()}`, { token: shipper.token }),
      403,
    );
    expect(shipperMissing.body.code).toBe('TRUCK_BROWSING_DISABLED');

    expectContract('getTruck', await http(app, 'get', `/trucks/${truck.id}`, { token: admin.token }), 200);

    const missing = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${randomUUID()}`, { token: admin.token }),
      404,
    );
    expect(missing.body.code).toBe('NOT_FOUND');

    const malformed = expectContract(
      'getTruck',
      await http(app, 'get', '/trucks/not-a-uuid', { token: admin.token }),
      400,
    );
    expect(malformed.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns a null counterparty restriction to the owning company', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Restriction Owner');
    const truck = await createTruck(app, owner.token, company.id, { registrationNumber: 'RESTRICT1' });
    expect(truck.counterpartyRestrictedUntil).toBeNull();

    const updated = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { trailerSpecs: 'Restriction test trailer' },
      }),
      200,
    );
    expect(updated.body.counterpartyRestrictedUntil).toBeNull();

    const detail = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: owner.token }),
      200,
    );
    expect(detail.body.counterpartyRestrictedUntil).toBeNull();

    const list = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: owner.token }),
      200,
    );
    const listed = list.body.data.find((row: { id: string }) => row.id === truck.id);
    expect(listed.counterpartyRestrictedUntil).toBeNull();
  });

  it('keeps shipper truck reads disabled and a null restriction visible to owners and admins during an active ban', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Restricted Fleet');
    const truck = await createTruck(app, owner.token, company.id, { registrationNumber: 'RESTRICT2' });
    const admin = await loginAdmin(app);
    await setTruckStatus(admin, truck.id, 'verified');
    const shipper = await register(app, 'shipper');

    await insertCompanyBan({
      companyId: company.id,
      userId: owner.userId,
      appliedByUserId: admin.userId,
    });

    const shipperDetail = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: shipper.token }),
      403,
    );
    expect(shipperDetail.body.code).toBe('TRUCK_BROWSING_DISABLED');

    const shipperList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: shipper.token }),
      403,
    );
    expect(shipperList.body.code).toBe('TRUCK_BROWSING_DISABLED');

    const ownerDetail = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: owner.token }),
      200,
    );
    expect(ownerDetail.body.counterpartyRestrictedUntil).toBeNull();

    const ownerList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: owner.token }),
      200,
    );
    const ownerListed = ownerList.body.data.find((row: { id: string }) => row.id === truck.id);
    expect(ownerListed.counterpartyRestrictedUntil).toBeNull();

    const ownerUpdate = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { currentLocationText: 'Restricted but still editable' },
      }),
      200,
    );
    expect(ownerUpdate.body.counterpartyRestrictedUntil).toBeNull();

    const adminDetail = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: admin.token }),
      200,
    );
    expect(adminDetail.body.counterpartyRestrictedUntil).toBeNull();

    const adminList = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks', { token: admin.token }),
      200,
    );
    const adminListed = adminList.body.data.find((row: { id: string }) => row.id === truck.id);
    expect(adminListed.counterpartyRestrictedUntil).toBeNull();
  });

  it('does not show lifted or expired bans on the owning company', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Formerly Restricted Fleet');
    const truck = await createTruck(app, owner.token, company.id, { registrationNumber: 'RESTRICT3' });
    const admin = await loginAdmin(app);
    await setTruckStatus(admin, truck.id, 'verified');
    const shipper = await register(app, 'shipper');

    await insertCompanyBan({
      companyId: company.id,
      userId: owner.userId,
      appliedByUserId: admin.userId,
      state: 'lifted',
    });

    async function expectShipperReadsDisabled(): Promise<void> {
      const detail = expectContract(
        'getTruck',
        await http(app, 'get', `/trucks/${truck.id}`, { token: shipper.token }),
        403,
      );
      expect(detail.body.code).toBe('TRUCK_BROWSING_DISABLED');
      const list = expectContract(
        'listTrucks',
        await http(app, 'get', '/trucks', { token: shipper.token }),
        403,
      );
      expect(list.body.code).toBe('TRUCK_BROWSING_DISABLED');
    }

    async function expectNullRestrictionForOwnerAndAdmin(): Promise<void> {
      const ownerDetail = expectContract(
        'getTruck',
        await http(app, 'get', `/trucks/${truck.id}`, { token: owner.token }),
        200,
      );
      expect(ownerDetail.body.counterpartyRestrictedUntil).toBeNull();
      const ownerList = expectContract(
        'listTrucks',
        await http(app, 'get', '/trucks', { token: owner.token }),
        200,
      );
      expect(
        ownerList.body.data.find((row: { id: string }) => row.id === truck.id)
          .counterpartyRestrictedUntil,
      ).toBeNull();
      const adminDetail = expectContract(
        'getTruck',
        await http(app, 'get', `/trucks/${truck.id}`, { token: admin.token }),
        200,
      );
      expect(adminDetail.body.counterpartyRestrictedUntil).toBeNull();
      const adminList = expectContract(
        'listTrucks',
        await http(app, 'get', '/trucks', { token: admin.token }),
        200,
      );
      expect(
        adminList.body.data.find((row: { id: string }) => row.id === truck.id)
          .counterpartyRestrictedUntil,
      ).toBeNull();
    }

    await expectShipperReadsDisabled();
    await expectNullRestrictionForOwnerAndAdmin();

    await insertCompanyBan({
      companyId: company.id,
      userId: owner.userId,
      appliedByUserId: admin.userId,
      state: 'expired',
    });

    await expectShipperReadsDisabled();
    await expectNullRestrictionForOwnerAndAdmin();
  });

  it('enforces update permissions, admin-only verification and re-verification rules', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Update Fleet');
    const truck = await createTruck(app, owner.token, company.id, { registrationNumber: 'UPDATE1' });
    const otherTransporter = await register(app, 'transporter');
    const shipper = await register(app, 'shipper');
    const admin = await loginAdmin(app);

    const edited = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { trailerSpecs: 'Low bed', currentLocationText: 'Harare yard' },
      }),
      200,
    );
    expect(edited.body).toMatchObject({
      trailerSpecs: 'Low bed',
      currentLocationText: 'Harare yard',
    });

    const ownerStatus = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { verificationStatus: 'verified' },
      }),
      403,
    );
    expect(ownerStatus.body.code).toBe('VERIFICATION_ADMIN_ONLY');

    const foreign = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: otherTransporter.token,
        body: { currentLocationText: 'Foreign attempt' },
      }),
      404,
    );
    expect(foreign.body.code).toBe('NOT_FOUND');

    const shipperUnverifiedUpdate = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: shipper.token,
        body: { currentLocationText: 'Shipper attempt on unverified truck' },
      }),
      403,
    );
    expect(shipperUnverifiedUpdate.body.code).toBe('FORBIDDEN');

    const verified = await setTruckStatus(admin, truck.id, 'verified');
    expect(verified.body.verificationStatus).toBe('verified');

    const shipperMissingUpdate = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${randomUUID()}`, {
        token: shipper.token,
        body: { currentLocationText: 'Shipper attempt on missing truck' },
      }),
      403,
    );
    expect(shipperMissingUpdate.body.code).toBe('FORBIDDEN');

    const shipperUpdate = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: shipper.token,
        body: { currentLocationText: 'Shipper attempt' },
      }),
      403,
    );
    expect(shipperUpdate.body.code).toBe('FORBIDDEN');

    const registrationAttempt = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { registrationNumber: 'CHANGED1' },
      }),
      400,
    );
    expect(registrationAttempt.body.code).toBe('VALIDATION_ERROR');

    const nullType = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { truckType: null },
      }),
      400,
    );
    expect(nullType.body.code).toBe('VALIDATION_ERROR');

    const capacityChange = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { capacityKg: 13_000 },
      }),
      200,
    );
    expect(capacityChange.body.verificationStatus).toBe('pending');
  });

  it('keeps verification when only location text changes or the truck type is unchanged', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Stable Fleet');
    const truck = await createTruck(app, owner.token, company.id, {
      registrationNumber: 'STABLE1',
      truckType: 'flatbed',
    });
    const admin = await loginAdmin(app);
    await setTruckStatus(admin, truck.id, 'verified');

    const locationOnly = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { currentLocationText: 'Bulawayo yard' },
      }),
      200,
    );
    expect(locationOnly.body.verificationStatus).toBe('verified');
    expect(locationOnly.body.currentLocationText).toBe('Bulawayo yard');

    const sameType = expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: owner.token,
        body: { truckType: 'flatbed' },
      }),
      200,
    );
    expect(sameType.body.verificationStatus).toBe('verified');
  });

  it('checks truck usability for quoting directly', async () => {
    const db = app.get(DbService);
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Quote Fleet');
    const unverifiedCompany = await createCompany(app, transporter.token, 'transporter', 'Quote Unverified');
    const truck = await createTruck(app, transporter.token, company.id, { registrationNumber: 'QUOTE1' });
    const unverifiedTruck = await createTruck(app, transporter.token, company.id, {
      registrationNumber: 'QUOTE2',
    });

    const other = await register(app, 'transporter');
    const otherCompany = await createCompany(app, other.token, 'transporter', 'Quote Other');
    const otherTruck = await createTruck(app, other.token, otherCompany.id, {
      registrationNumber: 'QUOTE3',
    });
    const otherUnverifiedTruck = await createTruck(app, other.token, otherCompany.id, {
      registrationNumber: 'QUOTE4',
    });

    const shipper = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper.token, 'shipper', 'Quote Shipper');

    const admin = await loginAdmin(app);
    await setCompanyVerified(admin, company.id);
    await setCompanyVerified(admin, otherCompany.id);
    await setCompanyVerified(admin, shipperCompany.id);
    await setTruckStatus(admin, truck.id, 'verified');
    await setTruckStatus(admin, otherTruck.id, 'verified');

    await expect(assertTruckUsableForQuote(db, company.id, truck.id)).resolves.toBeUndefined();
    await expect(assertTruckUsableForQuote(db, company.id, null)).resolves.toBeUndefined();

    async function usabilityFailure(companyId: string, truckId: string | null): Promise<ApiException> {
      try {
        await assertTruckUsableForQuote(db, companyId, truckId);
      } catch (error) {
        return error as ApiException;
      }
      throw new Error('expected assertTruckUsableForQuote to reject');
    }

    const cases: Array<[string, string | null, number, string]> = [
      [unverifiedCompany.id, null, 409, 'TRANSPORTER_COMPANY_NOT_VERIFIED'],
      [shipperCompany.id, null, 409, 'TRANSPORTER_COMPANY_NOT_VERIFIED'],
      [company.id, otherTruck.id, 400, 'TRUCK_NOT_IN_COMPANY'],
      [company.id, otherUnverifiedTruck.id, 400, 'TRUCK_NOT_IN_COMPANY'],
      [company.id, randomUUID(), 400, 'TRUCK_NOT_IN_COMPANY'],
      [company.id, unverifiedTruck.id, 409, 'TRUCK_NOT_VERIFIED'],
    ];
    for (const [companyId, truckId, status, code] of cases) {
      const error = await usabilityFailure(companyId, truckId);
      expect(error).toBeInstanceOf(ApiException);
      expect(error.getStatus()).toBe(status);
      expect(error.code).toBe(code);
    }

    const foreignVerified = await usabilityFailure(company.id, otherTruck.id);
    const foreignUnverified = await usabilityFailure(company.id, otherUnverifiedTruck.id);
    const unknownTruck = await usabilityFailure(company.id, randomUUID());
    for (const error of [foreignVerified, foreignUnverified, unknownTruck]) {
      expect(error.getStatus()).toBe(foreignVerified.getStatus());
      expect(error.code).toBe(foreignVerified.code);
      expect(error.message).toBe(foreignVerified.message);
      expect(error.getResponse()).toEqual(foreignVerified.getResponse());
      expect(error.details).toBeUndefined();
    }
    expect(foreignVerified.getStatus()).toBe(400);
    expect(foreignVerified.code).toBe('TRUCK_NOT_IN_COMPANY');
    expect(foreignVerified.message).toBe('The truck does not belong to this company.');
  });

  it('does not require an activated account to register a truck', async () => {
    const transporter = await register(app, 'transporter');
    await activate(app, transporter);
    const company = await createCompany(app, transporter.token, 'transporter', 'Activated Fleet');
    expectContract(
      'createTruck',
      await http(app, 'post', '/trucks', {
        token: transporter.token,
        body: {
          companyId: company.id,
          registrationNumber: 'ACTIVE1',
          truckType: 'flatbed',
          capacityKg: 8000,
        },
      }),
      201,
    );
  });
});
