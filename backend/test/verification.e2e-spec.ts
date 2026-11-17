import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { http, seedAdmin, truncate } from './helpers';
import {
  activate,
  createCompany,
  createTruck,
  docUri,
  expectContract,
  loginAdmin,
  register,
  Session,
} from './item5-helpers';
import { prepareTestDatabase } from './prepare-db';

describe('verification documents API', () => {
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

  async function uploadOk(token: string, body: Record<string, unknown>) {
    return expectContract(
      'uploadVerificationDocument',
      await http(app, 'post', '/verification-documents', { token, body }),
      201,
    );
  }

  async function uploadRejected(
    token: string,
    body: Record<string, unknown>,
    status: number,
    code: string,
  ) {
    const response = expectContract(
      'uploadVerificationDocument',
      await http(app, 'post', '/verification-documents', { token, body }),
      status,
    );
    expect(response.body.code).toBe(code);
    return response;
  }

  async function listDocs(token: string, query = '') {
    return expectContract(
      'listVerificationDocuments',
      await http(app, 'get', `/verification-documents${query}`, { token }),
      200,
    );
  }

  async function review(
    admin: Session,
    documentId: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    return http(app, 'post', `/admin/verification-documents/${documentId}/review`, {
      token: admin.token,
      body,
      idempotencyKey,
    });
  }

  it('marks an unverified company pending when its owner uploads a company document', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Company Doc Fleet');

    const uploaded = await uploadOk(transporter.token, {
      documentType: 'company_registration',
      documentUri: docUri(),
      companyId: company.id,
    });
    expect(uploaded.body).toMatchObject({
      ownerUserId: transporter.userId,
      companyId: company.id,
      truckId: null,
      status: 'submitted',
      reviewedAt: null,
    });

    const shown = expectContract(
      'getCompany',
      await http(app, 'get', `/companies/${company.id}`, { token: transporter.token }),
      200,
    );
    expect(shown.body.verificationStatus).toBe('pending');
  });

  it('fills the company from a truck document without changing the company status', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Truck Doc Fleet');
    const truck = await createTruck(app, transporter.token, company.id, { registrationNumber: 'VDOC1' });

    const uploaded = await uploadOk(transporter.token, {
      documentType: 'vehicle_registration',
      documentUri: docUri(),
      truckId: truck.id,
    });
    expect(uploaded.body).toMatchObject({
      companyId: company.id,
      truckId: truck.id,
      status: 'submitted',
    });

    const shownTruck = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: transporter.token }),
      200,
    );
    expect(shownTruck.body.verificationStatus).toBe('pending');

    const shownCompany = expectContract(
      'getCompany',
      await http(app, 'get', `/companies/${company.id}`, { token: transporter.token }),
      200,
    );
    expect(shownCompany.body.verificationStatus).toBe('unverified');
  });

  it('keeps a verified truck verified and returns a rejected truck to pending', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Truck Status Fleet');
    const truck = await createTruck(app, transporter.token, company.id, { registrationNumber: 'VDOC2' });
    const admin = await loginAdmin(app);

    expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: admin.token,
        body: { verificationStatus: 'verified' },
      }),
      200,
    );

    await uploadOk(transporter.token, {
      documentType: 'insurance',
      documentUri: docUri(),
      truckId: truck.id,
    });
    const stillVerified = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: transporter.token }),
      200,
    );
    expect(stillVerified.body.verificationStatus).toBe('verified');

    expectContract(
      'updateTruck',
      await http(app, 'patch', `/trucks/${truck.id}`, {
        token: admin.token,
        body: { verificationStatus: 'rejected' },
      }),
      200,
    );

    await uploadOk(transporter.token, {
      documentType: 'insurance',
      documentUri: docUri(),
      truckId: truck.id,
    });
    const pendingAgain = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: transporter.token }),
      200,
    );
    expect(pendingAgain.body.verificationStatus).toBe('pending');
  });

  it('allows a personal document and shows it only to its owner and admins', async () => {
    const owner = await register(app, 'transporter');
    const other = await register(app, 'transporter');
    const admin = await loginAdmin(app);

    const uploaded = await uploadOk(owner.token, {
      documentType: 'national_id',
      documentUri: docUri(),
    });
    expect(uploaded.body).toMatchObject({ companyId: null, truckId: null, status: 'submitted' });

    const ownerList = await listDocs(owner.token);
    expect(ownerList.body.data.map((row: { id: string }) => row.id)).toContain(uploaded.body.id);

    const otherList = await listDocs(other.token);
    expect(otherList.body.data.map((row: { id: string }) => row.id)).not.toContain(uploaded.body.id);

    const adminList = await listDocs(admin.token);
    expect(adminList.body.data.map((row: { id: string }) => row.id)).toContain(uploaded.body.id);
  });

  it('rejects foreign and unknown company or truck links plus mismatched own companies', async () => {
    const ownerA = await register(app, 'transporter');
    const companyA1 = await createCompany(app, ownerA.token, 'transporter', 'Links A1');
    const companyA2 = await createCompany(app, ownerA.token, 'transporter', 'Links A2');
    const truckA2 = await createTruck(app, ownerA.token, companyA2.id, { registrationNumber: 'LINKA2' });

    const ownerB = await register(app, 'transporter');
    const companyB = await createCompany(app, ownerB.token, 'transporter', 'Links B');
    await createTruck(app, ownerB.token, companyB.id, { registrationNumber: 'LINKB1' });

    await uploadRejected(
      ownerB.token,
      { documentType: 'other', documentUri: docUri(), companyId: companyA1.id },
      403,
      'FORBIDDEN',
    );
    await uploadRejected(
      ownerB.token,
      { documentType: 'other', documentUri: docUri(), truckId: truckA2.id },
      403,
      'FORBIDDEN',
    );
    await uploadRejected(
      ownerB.token,
      { documentType: 'other', documentUri: docUri(), companyId: randomUUID() },
      403,
      'FORBIDDEN',
    );
    await uploadRejected(
      ownerB.token,
      { documentType: 'other', documentUri: docUri(), truckId: randomUUID() },
      403,
      'FORBIDDEN',
    );
    await uploadRejected(
      ownerA.token,
      { documentType: 'other', documentUri: docUri(), companyId: companyA1.id, truckId: truckA2.id },
      400,
      'TRUCK_NOT_IN_COMPANY',
    );
  });

  it('applies the document link rules over HTTP', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Link Rules Fleet');
    const base = { documentType: 'other', companyId: company.id };
    const longUrl = `https://files.truber.local/${'a'.repeat(
      2049 - 'https://files.truber.local/'.length,
    )}`;

    const cases: Array<[string, string]> = [
      ['http://files.truber.local/docs/a.pdf', 'DOCUMENT_URI_NOT_ALLOWED'],
      ['https://evil.example/docs/a.pdf', 'DOCUMENT_URI_NOT_ALLOWED'],
      ['https://user:pw@files.truber.local/docs/a.pdf', 'DOCUMENT_URI_NOT_ALLOWED'],
      [longUrl, 'VALIDATION_ERROR'],
    ];
    for (const [documentUri, code] of cases) {
      await uploadRejected(transporter.token, { ...base, documentUri }, 400, code);
    }

    for (const extra of [{ mimeType: 'application/pdf' }, { sizeBytes: 1234 }]) {
      await uploadRejected(
        transporter.token,
        { ...base, documentUri: docUri(), ...extra },
        400,
        'VALIDATION_ERROR',
      );
    }
  });

  it('lists documents by ownership and company, and rejects unknown list parameters', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'List Docs Fleet');
    const uploaded = await uploadOk(owner.token, {
      documentType: 'tax_clearance',
      documentUri: docUri(),
      companyId: company.id,
    });
    const other = await register(app, 'transporter');
    const admin = await loginAdmin(app);

    const ownerList = await listDocs(owner.token);
    expect(ownerList.body.data.map((row: { id: string }) => row.id)).toContain(uploaded.body.id);

    const foreignCompany = expectContract(
      'listVerificationDocuments',
      await http(app, 'get', `/verification-documents?companyId=${company.id}`, {
        token: other.token,
      }),
      403,
    );
    expect(foreignCompany.body.code).toBe('FORBIDDEN');

    const otherList = await listDocs(other.token);
    expect(otherList.body.data.map((row: { id: string }) => row.id)).not.toContain(uploaded.body.id);

    const adminAll = await listDocs(admin.token);
    expect(adminAll.body.data.map((row: { id: string }) => row.id)).toContain(uploaded.body.id);

    const adminCompany = await listDocs(admin.token, `?companyId=${company.id}`);
    expect(adminCompany.body.data.map((row: { id: string }) => row.id)).toContain(uploaded.body.id);
    expect(
      adminCompany.body.data.every((row: { companyId: string }) => row.companyId === company.id),
    ).toBe(true);

    const unknownParam = expectContract(
      'listVerificationDocuments',
      await http(app, 'get', '/verification-documents?status=submitted', { token: admin.token }),
      400,
    );
    expect(unknownParam.body.code).toBe('VALIDATION_ERROR');
  });

  it('approves a truck document and verifies the truck', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Review Truck Fleet');
    const truck = await createTruck(app, transporter.token, company.id, { registrationNumber: 'REVTRUCK' });
    const document = await uploadOk(transporter.token, {
      documentType: 'vehicle_registration',
      documentUri: docUri(),
      truckId: truck.id,
    });
    const admin = await loginAdmin(app);

    const nonAdmin = expectContract(
      'reviewVerificationDocument',
      await review(transporter, document.body.id, { decision: 'approved', setTruckVerified: true }),
      403,
    );
    expect(nonAdmin.body.code).toBe('FORBIDDEN');

    const unknown = expectContract(
      'reviewVerificationDocument',
      await review(admin, randomUUID(), { decision: 'approved' }),
      404,
    );
    expect(unknown.body.code).toBe('NOT_FOUND');

    const approved = expectContract(
      'reviewVerificationDocument',
      await review(admin, document.body.id, { decision: 'approved', setTruckVerified: true }),
      200,
    );
    expect(approved.body).toMatchObject({ id: document.body.id, status: 'approved' });
    expect(approved.body.reviewedAt).not.toBeNull();

    const shown = expectContract(
      'getTruck',
      await http(app, 'get', `/trucks/${truck.id}`, { token: transporter.token }),
      200,
    );
    expect(shown.body.verificationStatus).toBe('verified');
  });

  it('verifies a company and lets its active shipper post a load end to end', async () => {
    const shipper = await register(app, 'shipper');
    await activate(app, shipper);
    const company = await createCompany(app, shipper.token, 'shipper', 'Verified Shipper Ltd');
    const document = await uploadOk(shipper.token, {
      documentType: 'company_registration',
      documentUri: docUri(),
      companyId: company.id,
    });
    const admin = await loginAdmin(app);

    expectContract(
      'reviewVerificationDocument',
      await review(admin, document.body.id, { decision: 'approved', setCompanyVerified: true }),
      200,
    );

    const shownCompany = expectContract(
      'getCompany',
      await http(app, 'get', `/companies/${company.id}`, { token: shipper.token }),
      200,
    );
    expect(shownCompany.body.verificationStatus).toBe('verified');

    const draft = expectContract(
      'createLoad',
      await http(app, 'post', '/loads', {
        token: shipper.token,
        body: {
          companyId: company.id,
          goodsType: 'Fertiliser',
          weightKg: 1000,
          truckTypeRequired: 'flatbed',
          pickupAddress: 'Harare Depot',
          destinationAddress: 'Bulawayo Warehouse',
          loadingDate: '2030-12-01',
          rateType: 'negotiable',
          currency: 'USD',
        },
      }),
      201,
    );
    expect(draft.body.status).toBe('draft');

    const posted = expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token }),
      200,
    );
    expect(posted.body.status).toBe('posted');
  });

  it('rejects invalid review flags and repeated reviews without changing documents', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Review Rules Fleet');
    const truck = await createTruck(app, transporter.token, company.id, { registrationNumber: 'REVRULE' });
    const truckDocument = await uploadOk(transporter.token, {
      documentType: 'insurance',
      documentUri: docUri(),
      truckId: truck.id,
    });
    const companyDocument = await uploadOk(transporter.token, {
      documentType: 'tax_clearance',
      documentUri: docUri(),
      companyId: company.id,
    });
    const personalDocument = await uploadOk(transporter.token, {
      documentType: 'national_id',
      documentUri: docUri(),
    });
    const admin = await loginAdmin(app);

    const rejectWithFlag = expectContract(
      'reviewVerificationDocument',
      await review(admin, truckDocument.body.id, {
        decision: 'rejected',
        setTruckVerified: true,
      }),
      409,
    );
    expect(rejectWithFlag.body.code).toBe('REVIEW_FLAGS_REQUIRE_APPROVAL');
    const unchanged = await listDocs(admin.token);
    expect(
      unchanged.body.data.find((row: { id: string }) => row.id === truckDocument.body.id),
    ).toMatchObject({ status: 'submitted', reviewedAt: null });

    const companyHasNoTruck = expectContract(
      'reviewVerificationDocument',
      await review(admin, companyDocument.body.id, {
        decision: 'approved',
        setTruckVerified: true,
      }),
      409,
    );
    expect(companyHasNoTruck.body.code).toBe('DOCUMENT_HAS_NO_TRUCK');

    const personalHasNoCompany = expectContract(
      'reviewVerificationDocument',
      await review(admin, personalDocument.body.id, {
        decision: 'approved',
        setCompanyVerified: true,
      }),
      409,
    );
    expect(personalHasNoCompany.body.code).toBe('DOCUMENT_HAS_NO_COMPANY');

    expectContract(
      'reviewVerificationDocument',
      await review(admin, companyDocument.body.id, { decision: 'approved' }),
      200,
    );
    const reReview = expectContract(
      'reviewVerificationDocument',
      await review(admin, companyDocument.body.id, { decision: 'rejected' }),
      409,
    );
    expect(reReview.body.code).toBe('DOCUMENT_ALREADY_REVIEWED');
  });

  it('replays idempotent reviews and serialises concurrent approvals', async () => {
    const transporter = await register(app, 'transporter');
    const company = await createCompany(app, transporter.token, 'transporter', 'Idempotent Review Fleet');
    const document = await uploadOk(transporter.token, {
      documentType: 'company_registration',
      documentUri: docUri(),
      companyId: company.id,
    });
    const admin = await loginAdmin(app);
    const key = `review-${randomUUID()}`;
    const body = { decision: 'approved', reviewNotes: 'Looks good', setCompanyVerified: true };

    const first = expectContract(
      'reviewVerificationDocument',
      await review(admin, document.body.id, body, key),
      200,
    );
    const second = expectContract(
      'reviewVerificationDocument',
      await review(admin, document.body.id, body, key),
      200,
    );
    expect(second.body).toEqual(first.body);

    const db = app.get(DbService);
    const stored = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM idempotency_records WHERE idempotency_key = $1',
      [key],
    );
    expect(stored.rows[0].count).toBe(1);

    const reused = expectContract(
      'reviewVerificationDocument',
      await review(admin, document.body.id, { decision: 'rejected' }, key),
      409,
    );
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const concurrentDocument = await uploadOk(transporter.token, {
      documentType: 'company_registration',
      documentUri: docUri(),
      companyId: company.id,
    });
    const responses = await Promise.all([
      review(admin, concurrentDocument.body.id, { decision: 'approved' }),
      review(admin, concurrentDocument.body.id, { decision: 'approved' }),
    ]);
    const successes = responses.filter((response) => response.status === 200);
    const conflicts = responses.filter((response) => response.status === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expectContract('reviewVerificationDocument', successes[0], 200);
    expect(conflicts[0].body.code).toBe('DOCUMENT_ALREADY_REVIEWED');
  });

  describe('when no verification document hosts are configured', () => {
    let emptyHostApp: INestApplication;
    let previousHosts: string | undefined;

    beforeAll(async () => {
      previousHosts = process.env.VERIFICATION_DOC_URI_HOSTS;
      process.env.VERIFICATION_DOC_URI_HOSTS = '';
      await prepareTestDatabase();
      emptyHostApp = await createApp({ logger: false });
    });

    afterAll(async () => {
      await emptyHostApp.close();
      if (previousHosts === undefined) {
        delete process.env.VERIFICATION_DOC_URI_HOSTS;
      } else {
        process.env.VERIFICATION_DOC_URI_HOSTS = previousHosts;
      }
    });

    it('rejects a well-formed https document link', async () => {
      const transporter = await register(emptyHostApp, 'transporter');
      const company = await createCompany(
        emptyHostApp,
        transporter.token,
        'transporter',
        'No Hosts Fleet',
      );
      const response = expectContract(
        'uploadVerificationDocument',
        await http(emptyHostApp, 'post', '/verification-documents', {
          token: transporter.token,
          body: {
            documentType: 'other',
            documentUri: docUri(),
            companyId: company.id,
          },
        }),
        400,
      );
      expect(response.body.code).toBe('DOCUMENT_URI_NOT_ALLOWED');
    });
  });
});
