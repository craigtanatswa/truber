import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { SEED_CONFIRM, runSeed } from '../src/seed/seed-lib';
import { http, seedAdmin, truncate } from './helpers';
import {
  activate,
  createCompany,
  expectContract,
  loginAdmin,
  register,
} from './item5-helpers';
import { prepareTestDatabase } from './prepare-db';

describe('users and account administration API', () => {
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

  async function getUser(token: string, userId: string, status = 200) {
    return expectContract('getUser', await http(app, 'get', `/users/${userId}`, { token }), status);
  }

  async function updateUser(
    token: string,
    userId: string,
    body: Record<string, unknown>,
    status = 200,
  ) {
    return expectContract(
      'updateUser',
      await http(app, 'patch', `/users/${userId}`, { token, body }),
      status,
    );
  }

  async function login(email: string, password: string) {
    return http(app, 'post', '/auth/login', { body: { email, password } });
  }

  it('scopes getUser to self, same-company members and admins', async () => {
    const owner = await register(app, 'transporter');
    const company = await createCompany(app, owner.token, 'transporter', 'Shared Fleet');
    const member = await register(app, 'transporter');
    const unrelated = await register(app, 'transporter');
    const admin = await loginAdmin(app);

    const db = app.get(DbService);
    await db.query(
      `INSERT INTO company_members (company_id, user_id, member_role, created_at)
       VALUES ($1, $2, 'owner', clock_timestamp())`,
      [company.id, member.userId],
    );

    const self = await getUser(owner.token, owner.userId);
    expect(self.body).toMatchObject({ id: owner.userId, bannedUntil: null });

    const sameCompany = await getUser(member.token, owner.userId);
    expect(sameCompany.body.id).toBe(owner.userId);

    const unrelatedAttempt = await getUser(unrelated.token, owner.userId, 403);
    expect(unrelatedAttempt.body.code).toBe('FORBIDDEN');

    const randomAttempt = await getUser(unrelated.token, randomUUID(), 403);
    expect(randomAttempt.body.code).toBe('FORBIDDEN');

    const adminView = await getUser(admin.token, owner.userId);
    expect(adminView.body.id).toBe(owner.userId);

    const adminMissing = await getUser(admin.token, randomUUID(), 404);
    expect(adminMissing.body.code).toBe('NOT_FOUND');
  });

  it('lets users edit their own profile while protecting privileged fields', async () => {
    const user = await register(app, 'shipper');
    const other = await register(app, 'shipper');

    const phoneSet = await updateUser(user.token, user.userId, { phone: '+263771234567' });
    expect(phoneSet.body.phone).toBe('+263771234567');

    const cleared = await updateUser(user.token, user.userId, {
      fullName: '  Updated Shipper  ',
      phone: null,
    });
    expect(cleared.body).toMatchObject({ fullName: 'Updated Shipper', phone: null });

    const statusAttempt = await updateUser(
      user.token,
      user.userId,
      { accountStatus: 'active' },
      403,
    );
    expect(statusAttempt.body.code).toBe('ACCOUNT_STATUS_ADMIN_ONLY');

    const otherAttempt = await updateUser(
      other.token,
      user.userId,
      { fullName: 'Not Allowed' },
      403,
    );
    expect(otherAttempt.body.code).toBe('FORBIDDEN');

    for (const body of [{ role: 'admin' }, { email: 'changed@example.com' }]) {
      const response = await updateUser(user.token, user.userId, body, 400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }

    const blankName = await updateUser(user.token, user.userId, { fullName: '   ' }, 400);
    expect(blankName.body.code).toBe('VALIDATION_ERROR');
  });

  it('lets an admin activate a pending user who never completed OTP, then that shipper can post', async () => {
    const shipper = await register(app, 'shipper');
    const company = await createCompany(app, shipper.token, 'shipper', 'Admin Activated Shipper');
    const admin = await loginAdmin(app);

    const activated = await updateUser(admin.token, shipper.userId, { accountStatus: 'active' });
    expect(activated.body.accountStatus).toBe('active');

    expectContract(
      'updateCompany',
      await http(app, 'patch', `/companies/${company.id}`, {
        token: admin.token,
        body: { verificationStatus: 'verified' },
      }),
      200,
    );

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
    const posted = expectContract(
      'postLoad',
      await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token }),
      200,
    );
    expect(posted.body.status).toBe('posted');
  });

  it('suspends a user, audits the change, revokes sessions and blocks every access path', async () => {
    const transporter = await register(app, 'transporter');
    await activate(app, transporter);
    const session = expectContract('login', await login(transporter.email, transporter.password), 200);
    const accessToken = session.body.accessToken as string;
    const refreshToken = session.body.refreshToken as string;

    const admin = await loginAdmin(app);
    const suspended = await updateUser(admin.token, transporter.userId, {
      accountStatus: 'suspended',
    });
    expect(suspended.body.accountStatus).toBe('suspended');

    for (const url of ['/trucks', '/verification-documents', '/auth/me']) {
      const operationId =
        url === '/trucks'
          ? 'listTrucks'
          : url === '/verification-documents'
            ? 'listVerificationDocuments'
            : 'getCurrentUser';
      const response = expectContract(
        operationId,
        await http(app, 'get', url, { token: accessToken }),
        403,
      );
      expect(response.body.code).toBe('ACCOUNT_NOT_PERMITTED');
    }

    const deniedLogin = expectContract(
      'login',
      await login(transporter.email, transporter.password),
      403,
    );
    expect(deniedLogin.body.code).toBe('ACCOUNT_SUSPENDED');

    const deniedRefresh = expectContract(
      'refreshToken',
      await http(app, 'post', '/auth/refresh', { body: { refreshToken } }),
      401,
    );
    expect(deniedRefresh.body.code).toBe('UNAUTHORIZED');

    const db = app.get(DbService);
    const changes = await db.query<{
      from_status: string;
      to_status: string;
      changed_by_user_id: string;
    }>(
      `SELECT from_status, to_status, changed_by_user_id
       FROM account_status_changes WHERE user_id = $1`,
      [transporter.userId],
    );
    expect(changes.rows).toEqual([
      { from_status: 'active', to_status: 'suspended', changed_by_user_id: admin.userId },
    ]);

    const liveSessions = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM refresh_sessions
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [transporter.userId],
    );
    expect(liveSessions.rows[0].count).toBe(0);
    const allSessions = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM refresh_sessions WHERE user_id = $1',
      [transporter.userId],
    );
    expect(allSessions.rows[0].count).toBeGreaterThan(0);

    const reactivated = await updateUser(admin.token, transporter.userId, {
      accountStatus: 'active',
    });
    expect(reactivated.body.accountStatus).toBe('active');

    expectContract('login', await login(transporter.email, transporter.password), 200);

    const oldRefresh = expectContract(
      'refreshToken',
      await http(app, 'post', '/auth/refresh', { body: { refreshToken } }),
      401,
    );
    expect(oldRefresh.body.code).toBe('UNAUTHORIZED');
  });

  it('disables and re-enables an account', async () => {
    const transporter = await register(app, 'transporter');
    await activate(app, transporter);
    const admin = await loginAdmin(app);

    const disabled = await updateUser(admin.token, transporter.userId, {
      accountStatus: 'disabled',
    });
    expect(disabled.body.accountStatus).toBe('disabled');

    const denied = expectContract(
      'login',
      await login(transporter.email, transporter.password),
      403,
    );
    expect(denied.body.code).toBe('ACCOUNT_DISABLED');

    const enabled = await updateUser(admin.token, transporter.userId, {
      accountStatus: 'active',
    });
    expect(enabled.body.accountStatus).toBe('active');

    expectContract('login', await login(transporter.email, transporter.password), 200);
  });

  it('rejects transitions to pending_verification and makes same-status updates a silent no-op', async () => {
    const target = await register(app, 'transporter');
    await activate(app, target);
    const admin = await loginAdmin(app);

    const invalid = await updateUser(admin.token, target.userId, {
      accountStatus: 'pending_verification',
    }, 400);
    expect(invalid.body.code).toBe('INVALID_ACCOUNT_STATUS_TRANSITION');

    const same = await updateUser(admin.token, target.userId, { accountStatus: 'active' });
    expect(same.body.accountStatus).toBe('active');

    const db = app.get(DbService);
    const changes = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM account_status_changes WHERE user_id = $1',
      [target.userId],
    );
    expect(changes.rows[0].count).toBe(0);
  });

  it('protects admin accounts from status and profile changes by another admin', async () => {
    const admin = await loginAdmin(app);
    const admin2 = await runSeed({
      nodeEnv: 'test',
      confirm: SEED_CONFIRM,
      email: 'admin2@seed.truber.local',
      password: 'seed-admin-password-2',
    });

    const ownStatus = await updateUser(
      admin.token,
      admin.userId,
      { accountStatus: 'suspended' },
      403,
    );
    expect(ownStatus.body.code).toBe('ADMIN_STATUS_CHANGE_FORBIDDEN');

    const otherStatus = await updateUser(
      admin.token,
      admin2.userId,
      { accountStatus: 'suspended' },
      403,
    );
    expect(otherStatus.body.code).toBe('ADMIN_STATUS_CHANGE_FORBIDDEN');

    const otherProfile = await updateUser(
      admin.token,
      admin2.userId,
      { fullName: 'Renamed Admin' },
      403,
    );
    expect(otherProfile.body.code).toBe('ADMIN_STATUS_CHANGE_FORBIDDEN');

    const ownProfile = await updateUser(admin.token, admin.userId, { fullName: 'Lead Admin' });
    expect(ownProfile.body.fullName).toBe('Lead Admin');
  });
});
