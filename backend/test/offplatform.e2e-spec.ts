// These tests spy on the real BookingDirectory and return fixture BookingParties
// for specific ids, so the off-platform flows do not need real booking rows.
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { BookingDirectory, BookingParties } from '../src/offplatform/booking-directory';
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

describe('off-platform safeguards API', () => {
  let app: INestApplication;
  let bookingsById: Map<string, BookingParties>;
  let activeBookingsByLoad: Map<string, BookingParties>;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
    bookingsById = new Map();
    activeBookingsByLoad = new Map();
    const directory = app.get(BookingDirectory);
    jest
      .spyOn(directory, 'findById')
      .mockImplementation(async (_client, bookingId) => bookingsById.get(bookingId) ?? null);
    jest
      .spyOn(directory, 'findActiveForLoad')
      .mockImplementation(async (_client, loadId) => activeBookingsByLoad.get(loadId) ?? null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies exactly 14 days and the database rejects a different duration', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Fourteen Day Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Fourteen Day Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);

    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    expect(report.body.status).toBe('open');
    expect(report.body).not.toHaveProperty('finding');

    const admin = await loginAdmin(app);
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed off-platform deal with documentary evidence',
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );
    expect(finding.body.bans).toHaveLength(1);
    const ban = finding.body.bans[0];
    expect(ban.durationDays).toBe(14);
    expect(ban.status).toBe('active');
    expect(Date.parse(ban.endsAt) - Date.parse(ban.startsAt)).toBe(14 * 24 * 3600 * 1000);
    expect(Math.abs(Date.now() - Date.parse(ban.startsAt))).toBeLessThan(5000);

    const shown = expectContract(
      'getOffPlatformReport',
      await http(app, 'get', `/admin/off-platform-reports/${report.body.id}`, { token: admin.token }),
      200,
    );
    expect(shown.body.status).toBe('confirmed');
    expect(shown.body.finding.bans[0].id).toBe(ban.id);

    const db = app.get(DbService);
    await expect(
      db.query(`UPDATE off_platform_bans SET ends_at = starts_at + interval '30 days' WHERE id = $1`, [ban.id]),
    ).rejects.toMatchObject({ code: '23514' });
    const persisted = await db.query<{ endsAt: Date }>('SELECT ends_at AS "endsAt" FROM off_platform_bans WHERE id = $1', [
      ban.id,
    ]);
    expect(new Date(persisted.rows[0].endsAt).toISOString()).toBe(ban.endsAt);
  });

  it('creates one ban per responsible party covering each user and company without changing account status', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Both Parties Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Both Parties Transporter');
    await verifyOtp(app, shipper.token, shipper.userId);
    await verifyOtp(app, transporter.token, transporter.userId);

    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, transporter.token, booking.bookingId),
      201,
    );

    const admin = await loginAdmin(app);
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Both parties confirmed to have moved the deal off platform',
        responsibleParties: [shipperParty(shipper, shipperCompany), transporterParty(transporter, transporterCompany)],
      }),
      201,
    );
    expect(finding.body.bans).toHaveLength(2);
    const shipperBan = finding.body.bans.find((row: { partyRole: string }) => row.partyRole === 'shipper');
    const transporterBan = finding.body.bans.find((row: { partyRole: string }) => row.partyRole === 'transporter');
    expect(shipperBan).toMatchObject({ userId: shipper.userId, companyId: shipperCompany.id });
    expect(transporterBan).toMatchObject({ userId: transporter.userId, companyId: transporterCompany.id });

    const byCompany = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', `/admin/off-platform-bans?companyId=${shipperCompany.id}`, { token: admin.token }),
      200,
    );
    expect(byCompany.body.data).toHaveLength(1);
    expect(byCompany.body.data[0]).toMatchObject({
      id: shipperBan.id,
      userId: shipper.userId,
      companyId: shipperCompany.id,
      partyRole: 'shipper',
    });

    const byUser = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', `/admin/off-platform-bans?userId=${transporter.userId}`, { token: admin.token }),
      200,
    );
    expect(byUser.body.data).toHaveLength(1);
    expect(byUser.body.data[0]).toMatchObject({ id: transporterBan.id, companyId: transporterCompany.id });

    const all = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', '/admin/off-platform-bans', { token: admin.token }),
      200,
    );
    expect(all.body.data).toHaveLength(2);

    const me = expectContract('getCurrentUser', await http(app, 'get', '/auth/me', { token: shipper.token }), 200);
    expect(me.body.accountStatus).toBe('active');
  });

  it('never bans from a report alone, and a not_confirmed finding creates no bans', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Report Only Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Report Only Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);

    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    expect(report.body.status).toBe('open');
    expect(report.body).not.toHaveProperty('finding');

    const emptyBans = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', '/admin/off-platform-bans', { token: (await loginAdmin(app)).token }),
      200,
    );
    expect(emptyBans.body.data).toEqual([]);

    const stillAllowed = expectContract(
      'createLoad',
      await createDraft(app, shipper.token, shipperCompany.id),
      201,
    );
    expect(stillAllowed.body.status).toBe('draft');

    const admin = await loginAdmin(app);
    const notConfirmed = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'not_confirmed',
        reason: 'Evidence did not support the circumvention report',
      }),
      201,
    );
    expect(notConfirmed.body.outcome).toBe('not_confirmed');
    expect(notConfirmed.body.bans).toEqual([]);

    const shown = expectContract(
      'getOffPlatformReport',
      await http(app, 'get', `/admin/off-platform-reports/${report.body.id}`, { token: admin.token }),
      200,
    );
    expect(shown.body.status).toBe('not_confirmed');
    expect(shown.body.finding.bans).toEqual([]);

    const listed = expectContract(
      'listOffPlatformReports',
      await http(app, 'get', '/admin/off-platform-reports', { token: admin.token }),
      200,
    );
    expect(listed.body.data.map((row: { id: string }) => row.id)).toContain(report.body.id);

    const second = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'not_confirmed',
        reason: 'Trying to record a second finding on the same report',
      }),
      409,
    );
    expect(second.body.code).toBe('FINDING_ALREADY_RECORDED');
  });

  it('rejects extra or invalid finding fields without creating any ban', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const outsider = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Validation Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Validation Transporter');
    const unrelatedCompany = await createCompany(app, outsider, 'shipper', 'Unrelated Validation Company');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    const party = shipperParty(shipper, shipperCompany);
    const base = { outcome: 'confirmed', reason: 'A valid reason for the finding attempt' };

    const invalidBodies: Record<string, unknown>[] = [
      { ...base, responsibleParties: [party], durationDays: 30 },
      { ...base, responsibleParties: [party], endsAt: new Date().toISOString() },
      { ...base, responsibleParties: [{ ...party, extra: 'not allowed' }] },
      { outcome: 'confirmed', reason: 'A valid reason but no responsible parties' },
      { outcome: 'not_confirmed', reason: 'A valid reason but parties are not allowed', responsibleParties: [party] },
      { ...base, responsibleParties: [party, { ...party }] },
    ];
    for (const body of invalidBodies) {
      const response = expectContract(
        'recordOffPlatformFinding',
        await http(app, 'post', `/admin/off-platform-reports/${report.body.id}/finding`, {
          token: admin.token,
          body,
        }),
        400,
      );
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }

    const mismatch = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        ...base,
        responsibleParties: [{ role: 'shipper', userId: shipper.userId, companyId: transporterCompany.id }],
      }),
      409,
    );
    expect(mismatch.body.code).toBe('RESPONSIBLE_PARTY_MISMATCH');

    const alsoMismatch = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        ...base,
        responsibleParties: [{ role: 'shipper', userId: shipper.userId, companyId: unrelatedCompany.id }],
      }),
      409,
    );
    expect(alsoMismatch.body.code).toBe('RESPONSIBLE_PARTY_MISMATCH');

    const bans = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', '/admin/off-platform-bans', { token: admin.token }),
      200,
    );
    expect(bans.body.data).toEqual([]);
    const shown = expectContract(
      'getOffPlatformReport',
      await http(app, 'get', `/admin/off-platform-reports/${report.body.id}`, { token: admin.token }),
      200,
    );
    expect(shown.body.status).toBe('open');
    expect(shown.body.finding).toBeNull();
  });

  it('checks the ban gate first, reports exact details, and ignores admin overrides', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const secondMember = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Gate Order Shipper');
    const secondCompany = await createCompany(app, shipper, 'shipper', 'Gate Unverified Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Gate Order Transporter');
    await verifyOtp(app, shipper.token, shipper.userId);
    const admin = await loginAdmin(app);
    const verified = await http(app, 'patch', `/companies/${shipperCompany.id}`, {
      token: admin.token,
      body: { verificationStatus: 'verified' },
    });
    expect(verified.status).toBe(200);

    const postedLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${postedLoad.body.id}/post`, { token: shipper.token }),
      200,
    );
    const unverifiedDraft = expectContract(
      'createLoad',
      await createDraft(app, shipper.token, secondCompany.id),
      201,
    );
    const bannedCompanyDraft = expectContract(
      'createLoad',
      await createDraft(app, shipper.token, shipperCompany.id),
      201,
    );

    const db = app.get(DbService);
    await db.query(
      `INSERT INTO company_members (company_id, user_id, member_role, created_at)
       VALUES ($1, $2, 'owner', clock_timestamp())`,
      [shipperCompany.id, secondMember.userId],
    );

    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const reason = 'Confirmed circumvention used for the gate ordering test';
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason,
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );
    const ban = finding.body.bans[0];

    const callerBlocked = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 409);
    expect(callerBlocked.body.details).toEqual({ bannedUntil: ban.endsAt, bannedParty: 'caller' });
    expect(JSON.stringify(callerBlocked.body)).not.toContain(reason);

    const companyBlocked = expectContract('createLoad', await createDraft(app, secondMember.token, shipperCompany.id), 409);
    expect(companyBlocked.body.details).toEqual({ bannedUntil: ban.endsAt, bannedParty: 'caller_company' });

    const unverifiedBlocked = expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${unverifiedDraft.body.id}/post`, { token: shipper.token }),
      409,
    );
    expect(unverifiedBlocked.body.details).toEqual({ bannedUntil: ban.endsAt, bannedParty: 'caller' });

    const postedBlocked = expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${postedLoad.body.id}/post`, { token: shipper.token }),
      409,
    );
    expect(postedBlocked.body.details).toEqual({ bannedUntil: ban.endsAt, bannedParty: 'caller' });

    const adminBlocked = expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${bannedCompanyDraft.body.id}/post`, { token: admin.token }),
      409,
    );
    expect(adminBlocked.body.details).toEqual({ bannedUntil: ban.endsAt, bannedParty: 'caller_company' });

    const override = expectContract(
      'createLoad',
      await http(app, 'post', '/loads', {
        token: shipper.token,
        body: { ...draftInput(shipperCompany.id), auditOverride: true },
      }),
      400,
    );
    expect(override.body.code).toBe('VALIDATION_ERROR');

    for (const response of [callerBlocked, companyBlocked, unverifiedBlocked, postedBlocked, adminBlocked]) {
      expect(response.body).not.toHaveProperty('reason');
      expect(JSON.stringify(response.body)).not.toContain(reason);
    }
  });

  it('keeps login and existing records visible while banned', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Visible Records Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Visible Records Transporter');
    const load = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed finding while records remain visible',
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );

    const login = expectContract(
      'login',
      await http(app, 'post', '/auth/login', {
        body: { email: shipper.email, password: shipper.password },
      }),
      200,
    );
    const token = login.body.accessToken as string;

    const list = expectContract('listLoads', await http(app, 'get', '/loads', { token }), 200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toContain(load.body.id);
    const detail = expectContract('getLoad', await http(app, 'get', `/loads/${load.body.id}`, { token }), 200);
    expect(detail.body.id).toBe(load.body.id);
  });

  it('lifts active bans with audit fields and restores access', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Lift Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Lift Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed finding that will be lifted early',
        responsibleParties: [shipperParty(shipper, shipperCompany), transporterParty(transporter, transporterCompany)],
      }),
      201,
    );
    const shipperBan = finding.body.bans.find((row: { partyRole: string }) => row.partyRole === 'shipper');
    const transporterBan = finding.body.bans.find((row: { partyRole: string }) => row.partyRole === 'transporter');
    const originalEndsAt = shipperBan.endsAt;

    expectContract(
      'liftOffPlatformBan',
      await liftBan(app, shipper.token, shipperBan.id, 'A non-admin should not be able to lift'),
      403,
    );
    expectContract(
      'liftOffPlatformBan',
      await http(app, 'post', `/admin/off-platform-bans/${shipperBan.id}/lift`, { token: admin.token, body: {} }),
      400,
    );
    expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, shipperBan.id, 'short'),
      400,
    );

    const liftReason = 'Finding was based on mistaken identity';
    const lifted = expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, shipperBan.id, liftReason),
      200,
    );
    expect(lifted.body.status).toBe('lifted');
    expect(lifted.body.liftedAt).not.toBeNull();
    expect(lifted.body.liftedByUserId).toBe(admin.userId);
    expect(lifted.body.liftReason).toBe(liftReason);
    expect(lifted.body.endsAt).toBe(originalEndsAt);

    expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, transporterBan.id, 'Lifting the related transporter ban as well'),
      200,
    );

    const created = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expect(created.body.status).toBe('draft');

    const again = expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, shipperBan.id, 'Trying to lift the same ban twice'),
      409,
    );
    expect(again.body.code).toBe('BAN_NOT_ACTIVE');

    const unknown = expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, randomUUID(), 'Ban id that does not exist'),
      404,
    );
    expect(unknown.body.code).toBe('NOT_FOUND');
  });

  it('expires bans automatically and refuses to lift an expired ban', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Expiry Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Expiry Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed finding that will be moved into the past',
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );
    const ban = finding.body.bans[0];

    const db = app.get(DbService);
    await db.query(
      `UPDATE off_platform_bans
       SET starts_at = starts_at - interval '15 days',
           ends_at = ends_at - interval '15 days'
       WHERE id = $1`,
      [ban.id],
    );

    const listed = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', `/admin/off-platform-bans?userId=${shipper.userId}`, { token: admin.token }),
      200,
    );
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ id: ban.id, status: 'expired' });
    const expiredOnly = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', '/admin/off-platform-bans?status=expired', { token: admin.token }),
      200,
    );
    expect(expiredOnly.body.data.map((row: { id: string }) => row.id)).toContain(ban.id);

    const created = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    expect(created.body.status).toBe('draft');

    const lift = expectContract(
      'liftOffPlatformBan',
      await liftBan(app, admin.token, ban.id, 'Trying to lift an already expired ban'),
      409,
    );
    expect(lift.body.code).toBe('BAN_NOT_ACTIVE');
  });

  it('restricts every admin endpoint to admins and requires authentication', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Admin Guard Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Admin Guard Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    const finding = expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed finding for the admin guard test',
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );
    const banId = finding.body.bans[0].id;

    const endpoints: { operationId: string; method: 'get' | 'post'; url: string; body?: unknown }[] = [
      { operationId: 'listOffPlatformReports', method: 'get', url: '/admin/off-platform-reports' },
      { operationId: 'getOffPlatformReport', method: 'get', url: `/admin/off-platform-reports/${report.body.id}` },
      {
        operationId: 'recordOffPlatformFinding',
        method: 'post',
        url: `/admin/off-platform-reports/${report.body.id}/finding`,
        body: { outcome: 'not_confirmed', reason: 'An otherwise valid finding body from a non-admin' },
      },
      { operationId: 'listOffPlatformBans', method: 'get', url: '/admin/off-platform-bans' },
      {
        operationId: 'liftOffPlatformBan',
        method: 'post',
        url: `/admin/off-platform-bans/${banId}/lift`,
        body: { liftReason: 'An otherwise valid lift body from a non-admin' },
      },
    ];

    for (const session of [shipper, transporter]) {
      for (const endpoint of endpoints) {
        const response = await http(app, endpoint.method, endpoint.url, {
          token: session.token,
          body: endpoint.body,
        });
        expectContract(endpoint.operationId, response, 403);
      }
    }
    for (const endpoint of endpoints) {
      const response = await http(app, endpoint.method, endpoint.url, { body: endpoint.body });
      expectContract(endpoint.operationId, response, 401);
    }
  });

  it('does not leak bans across tenants and hides bookings from non-parties', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const outsider = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Tenant Isolation Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Tenant Isolation Transporter');
    const outsiderCompany = await createCompany(app, outsider, 'shipper', 'Tenant Isolation Outsider');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    expectContract(
      'recordOffPlatformFinding',
      await recordFinding(app, admin.token, report.body.id, {
        outcome: 'confirmed',
        reason: 'Confirmed finding used for tenant isolation',
        responsibleParties: [shipperParty(shipper, shipperCompany)],
      }),
      201,
    );

    const allowed = expectContract('createLoad', await createDraft(app, outsider.token, outsiderCompany.id), 201);
    expect(allowed.body.status).toBe('draft');

    const nonParty = expectContract(
      'createOffPlatformReport',
      await fileReport(app, outsider.token, booking.bookingId),
      404,
    );
    expect(nonParty.body.code).toBe('NOT_FOUND');

    const unknownBooking = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, randomUUID()),
      404,
    );
    expect(unknownBooking.body.code).toBe('NOT_FOUND');
  });

  it('blocks self-cancel when a booking exists and keeps ordinary posted cancels working', async () => {
    const shipper = await register(app, 'shipper');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Cancel Shipper');
    const bookingLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    const booking = {
      bookingId: randomUUID(),
      loadId: bookingLoad.body.id as string,
      status: 'pending_payment_arrangement' as const,
      shipperCompanyId: shipperCompany.id,
      transporterCompanyId: randomUUID(),
    };
    activeBookingsByLoad.set(booking.loadId, booking);
    const admin = await loginAdmin(app);

    const selfCancel = expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${bookingLoad.body.id}/cancel`, {
        token: shipper.token,
        body: { reason: 'Trying to walk away from the booking' },
      }),
      409,
    );
    expect(selfCancel.body.code).toBe('SELF_CANCEL_NOT_ALLOWED');
    expect(selfCancel.body.details).toEqual({
      bookingId: booking.bookingId,
      bookingStatus: 'pending_payment_arrangement',
    });
    const db = app.get(DbService);
    const unchanged = await db.query<{ status: string }>('SELECT status FROM loads WHERE id = $1', [bookingLoad.body.id]);
    expect(unchanged.rows[0].status).toBe('draft');

    const adminCancel = expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${bookingLoad.body.id}/cancel`, {
        token: admin.token,
        body: { reason: 'Admin trying the self-cancel endpoint' },
      }),
      409,
    );
    expect(adminCancel.body.code).toBe('ADMIN_CANCEL_VIA_BOOKING');

    const bookingPendingLoad = expectContract(
      'createLoad',
      await createDraft(app, shipper.token, shipperCompany.id),
      201,
    );
    await db.query(`UPDATE loads SET status = 'booking_pending' WHERE id = $1`, [bookingPendingLoad.body.id]);
    const blocked = expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${bookingPendingLoad.body.id}/cancel`, {
        token: shipper.token,
        body: { reason: 'No booking fixture is active for this load' },
      }),
      409,
    );
    expect(blocked.body.code).toBe('LOAD_CANCEL_BLOCKED');

    const postedLoad = expectContract('createLoad', await createDraft(app, shipper.token, shipperCompany.id), 201);
    await db.query(`UPDATE loads SET status = 'posted' WHERE id = $1`, [postedLoad.body.id]);
    const cancelled = expectContract(
      'cancelLoad',
      await http(app, 'post', `/loads/${postedLoad.body.id}/cancel`, {
        token: shipper.token,
        body: { reason: 'Ordinary posted cancel with no booking' },
      }),
      200,
    );
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('replays an idempotent finding without creating extra bans', async () => {
    const shipper = await register(app, 'shipper');
    const transporter = await register(app, 'transporter');
    const shipperCompany = await createCompany(app, shipper, 'shipper', 'Idempotent Shipper');
    const transporterCompany = await createCompany(app, transporter, 'transporter', 'Idempotent Transporter');
    const booking = bookingFixture(shipperCompany.id, transporterCompany.id);
    bookingsById.set(booking.bookingId, booking);
    const report = expectContract(
      'createOffPlatformReport',
      await fileReport(app, shipper.token, booking.bookingId),
      201,
    );
    const admin = await loginAdmin(app);
    const key = `finding-${randomUUID()}`;
    const body = {
      outcome: 'confirmed',
      reason: 'Confirmed finding replayed with the same idempotency key',
      responsibleParties: [shipperParty(shipper, shipperCompany)],
    };

    const first = expectContract(
      'recordOffPlatformFinding',
      await http(app, 'post', `/admin/off-platform-reports/${report.body.id}/finding`, {
        token: admin.token,
        body,
        idempotencyKey: key,
      }),
      201,
    );
    const second = expectContract(
      'recordOffPlatformFinding',
      await http(app, 'post', `/admin/off-platform-reports/${report.body.id}/finding`, {
        token: admin.token,
        body,
        idempotencyKey: key,
      }),
      201,
    );
    expect(second.body).toEqual(first.body);
    expect(first.body.bans).toHaveLength(1);

    const bans = expectContract(
      'listOffPlatformBans',
      await http(app, 'get', `/admin/off-platform-bans?userId=${shipper.userId}`, { token: admin.token }),
      200,
    );
    expect(bans.body.data).toHaveLength(1);

    const db = app.get(DbService);
    const findings = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM off_platform_findings');
    expect(findings.rows[0].count).toBe(1);
    const banCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM off_platform_bans');
    expect(banCount.rows[0].count).toBe(1);
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

function bookingFixture(shipperCompanyId: string, transporterCompanyId: string): BookingParties {
  return {
    bookingId: randomUUID(),
    loadId: randomUUID(),
    status: 'confirmed',
    shipperCompanyId,
    transporterCompanyId,
  };
}

function shipperParty(session: Session, company: { id: string }): { role: 'shipper'; userId: string; companyId: string } {
  return { role: 'shipper', userId: session.userId, companyId: company.id };
}

function transporterParty(session: Session, company: { id: string }): { role: 'transporter'; userId: string; companyId: string } {
  return { role: 'transporter', userId: session.userId, companyId: company.id };
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

async function fileReport(app: INestApplication, token: string, bookingId: string) {
  return http(app, 'post', `/bookings/${bookingId}/off-platform-reports`, {
    token,
    body: { suspectedParty: 'both', description: 'Suspected off-platform dealing on this booking' },
  });
}

async function recordFinding(
  app: INestApplication,
  token: string,
  reportId: string,
  body: Record<string, unknown>,
) {
  return http(app, 'post', `/admin/off-platform-reports/${reportId}/finding`, { token, body });
}

async function liftBan(app: INestApplication, token: string, banId: string, liftReason: string) {
  return http(app, 'post', `/admin/off-platform-bans/${banId}/lift`, {
    token,
    body: { liftReason },
  });
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
