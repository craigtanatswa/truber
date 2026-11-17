import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiException } from '../src/common/api.exception';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
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

  it('rejects duplicate registration numbers across case, spacing, hyphen and company variants', async () => {
    const transporter = await register(app, 'transporter');
    const firstCompany = await createCompany(app, transporter.token, 'transporter', 'Duplicate One');
    const secondCompany = await createCompany(app, transporter.token, 'transporter', 'Duplicate Two');

    await createTruck(app, transporter.token, firstCompany.id, { registrationNumber: 'aez-12 34' });

    const duplicates: Array<[string, string]> = [
      [firstCompany.id, 'AEZ 12-34'],
      [firstCompany.id, 'aez\t12\t34'],
      [secondCompany.id, 'aez-12-34'],
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

  it('scopes truck lists to the caller fleet, verified trucks for shippers, and everything for admins', async () => {
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
      200,
    );
    expect(shipperList.body.data.length).toBeGreaterThan(0);
    expect(
      shipperList.body.data.every(
        (truck: { verificationStatus: string }) => truck.verificationStatus === 'verified',
      ),
    ).toBe(true);
    const shipperIds = shipperList.body.data.map((truck: { id: string }) => truck.id);
    expect(shipperIds).toEqual(expect.arrayContaining([truckA1.id, truckB.id]));
    expect(shipperIds).not.toContain(truckA2.id);

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
    const withAvailableOn = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?availableOn=2030-01-01', { token: transporter.token }),
      200,
    );
    expect(withAvailableOn.body.meta).toEqual(withoutAvailableOn.body.meta);
    expect(withAvailableOn.body.data.map((truck: { id: string }) => truck.id)).toEqual(
      withoutAvailableOn.body.data.map((truck: { id: string }) => truck.id),
    );

    const impossibleDate = expectContract(
      'listTrucks',
      await http(app, 'get', '/trucks?availableOn=2030-02-30', { token: transporter.token }),
      400,
    );
    expect(impossibleDate.body.code).toBe('VALIDATION_ERROR');

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
      404,
    );
    expect(shipperUnverified.body.code).toBe('NOT_FOUND');

    await setTruckStatus(admin, truck.id, 'verified');

    expectContract('getTruck', await http(app, 'get', `/trucks/${truck.id}`, { token: shipper.token }), 200);
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

    const verified = await setTruckStatus(admin, truck.id, 'verified');
    expect(verified.body.verificationStatus).toBe('verified');

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

    const cases: Array<[string, string | null, string]> = [
      [unverifiedCompany.id, null, 'TRANSPORTER_COMPANY_NOT_VERIFIED'],
      [shipperCompany.id, null, 'TRANSPORTER_COMPANY_NOT_VERIFIED'],
      [company.id, otherTruck.id, 'TRUCK_NOT_IN_COMPANY'],
      [company.id, randomUUID(), 'TRUCK_NOT_IN_COMPANY'],
      [company.id, unverifiedTruck.id, 'TRUCK_NOT_VERIFIED'],
    ];
    for (const [companyId, truckId, code] of cases) {
      const error = await usabilityFailure(companyId, truckId);
      expect(error).toBeInstanceOf(ApiException);
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe(code);
    }
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
