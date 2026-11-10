import { INestApplication } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { SeedRefusal, runSeed } from '../src/seed/seed-lib';
import { assertOperationResponse, assertSchema, contractVersion } from './contract';
import { ADMIN_EMAIL, ADMIN_PASSWORD, capturingLogger, http, latestPayload, seedAdmin, truncate, uniqueEmail } from './helpers';
import { prepareTestDatabase } from './prepare-db';

const RESET_OK = {
  status: 'accepted',
  message: 'If an account exists for this email, password reset instructions will be sent when permitted.',
};
const RESET_401 = {
  code: 'PASSWORD_RESET_TOKEN_INVALID',
  message: 'Password reset token is invalid or no longer usable.',
};

describe('auth API', () => {
  let app: INestApplication;
  const lines: string[] = [];

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: capturingLogger(lines) });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
    lines.length = 0;
  });

  it('publishes contract version 0.4.0', () => {
    expect(contractVersion()).toBe('0.4.0');
  });

  it('registers a shipper or transporter, rejects admin and privilege fields, and persists optional city', async () => {
    const db = app.get(DbService);
    const withCity = await http(app, 'post', '/auth/register', {
      body: {
        email: 'City.User@Example.com',
        password: 'city-password',
        fullName: 'City User',
        phone: '+263770000000',
        city: 'Harare',
        role: 'shipper',
      },
    });
    expect(withCity.status).toBe(201);
    assertOperationResponse('registerUser', 201, withCity.body);
    expect(withCity.body.expiresIn).toBe(1800);
    expect(withCity.body.tokenType).toBe('Bearer');
    expect(withCity.body.user).toMatchObject({
      email: 'city.user@example.com',
      role: 'shipper',
      accountStatus: 'pending_verification',
      phone: '+263770000000',
    });
    expect(withCity.body.user.city).toBeUndefined();
    expect(JSON.stringify(withCity.body)).not.toContain('city-password');
    const decoded = jwt.decode(withCity.body.accessToken as string) as { sub: string; role: string; exp: number; iat: number };
    expect(decoded.role).toBe('shipper');
    expect(decoded.exp - decoded.iat).toBe(1800);
    expect(String(withCity.body.refreshToken)).not.toMatch(/\./);
    const stored = await db.query<{ city: string }>('SELECT city FROM users WHERE email = $1', ['city.user@example.com']);
    expect(stored.rows[0].city).toBe('Harare');

    const noCity = await http(app, 'post', '/auth/register', {
      body: {
        email: uniqueEmail('nocity'),
        password: 'city-password',
        fullName: 'No City',
        role: 'transporter',
      },
    });
    expect(noCity.status).toBe(201);
    assertOperationResponse('registerUser', 201, noCity.body);
    expect(noCity.body.user.role).toBe('transporter');
    const emptyCity = await db.query<{ city: string | null }>('SELECT city FROM users WHERE id = $1', [noCity.body.user.id]);
    expect(emptyCity.rows[0].city).toBeNull();

    const admin = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('admin'), password: 'admin-password', fullName: 'Nope', role: 'admin' },
    });
    expect(admin.status).toBe(400);
    assertOperationResponse('registerUser', 400, admin.body);
    expect(admin.body.code).toBe('VALIDATION_ERROR');

    const escalated = await http(app, 'post', '/auth/register', {
      body: {
        email: uniqueEmail('status'),
        password: 'status-password',
        fullName: 'Status',
        role: 'shipper',
        accountStatus: 'active',
      },
    });
    expect(escalated.status).toBe(400);
    expect(escalated.body.code).toBe('VALIDATION_ERROR');

    const verified = await http(app, 'post', '/auth/register', {
      body: {
        email: uniqueEmail('ver'),
        password: 'status-password',
        fullName: 'Verified',
        role: 'shipper',
        verificationStatus: 'verified',
      },
    });
    expect(verified.status).toBe(400);

    const blankCity = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('blank'), password: 'city-password', fullName: 'Blank', role: 'shipper', city: '' },
    });
    expect(blankCity.status).toBe(400);

    const short = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('short'), password: 'short', fullName: 'Short', role: 'shipper' },
    });
    expect(short.status).toBe(400);
    expect(JSON.stringify(short.body)).not.toContain('short');

    const duplicate = await http(app, 'post', '/auth/register', {
      body: { email: 'city.user@example.com', password: 'city-password', fullName: 'Again', role: 'shipper' },
    });
    expect(duplicate.status).toBe(409);
    assertOperationResponse('registerUser', 409, duplicate.body);
    expect(duplicate.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    const roles = await db.query<{ role: string }>('SELECT role FROM users');
    expect(roles.rows.map((row) => row.role).sort()).toEqual(['shipper', 'transporter']);
  });

  it('logs in without enumerating accounts and rejects bad, expired, and unsigned tokens', async () => {
    const email = uniqueEmail('login');
    const registered = await http(app, 'post', '/auth/register', {
      body: { email, password: 'login-password', fullName: 'Login User', role: 'shipper' },
    });
    const ok = await http(app, 'post', '/auth/login', { body: { email: email.toUpperCase(), password: 'login-password' } });
    expect(ok.status).toBe(200);
    assertOperationResponse('login', 200, ok.body);
    expect(ok.body.expiresIn).toBe(1800);

    const wrong = await http(app, 'post', '/auth/login', { body: { email, password: 'not-the-password' } });
    const missing = await http(app, 'post', '/auth/login', { body: { email: uniqueEmail('missing'), password: 'not-the-password' } });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    assertOperationResponse('login', 401, wrong.body);
    expect(wrong.body.code).toBe(missing.body.code);
    expect(wrong.body.message).toBe(missing.body.message);
    expect(wrong.body.details).toBeUndefined();
    expect(JSON.stringify(wrong.body)).not.toContain(email);
    expect(JSON.stringify(missing.body)).not.toContain('missing');

    const malformed = await http(app, 'post', '/auth/login', { body: { email: 'not-an-email', password: 'x' } });
    expect(malformed.status).toBe(400);
    assertOperationResponse('login', 400, malformed.body);

    const me = await http(app, 'get', '/auth/me', { token: ok.body.accessToken as string });
    expect(me.status).toBe(200);
    assertOperationResponse('getCurrentUser', 200, me.body);
    expect(me.body.id).toBe(registered.body.user.id);

    const anonymous = await http(app, 'get', '/auth/me');
    expect(anonymous.status).toBe(401);
    assertOperationResponse('getCurrentUser', 401, anonymous.body);

    const garbage = await http(app, 'get', '/auth/me', { token: 'not-a-jwt' });
    expect(garbage.status).toBe(401);
    const otherSecret = jwt.sign({ sub: registered.body.user.id, role: 'shipper' }, 'another-secret-that-is-long-enough-32', {
      algorithm: 'HS256',
      expiresIn: 1800,
    });
    expect((await http(app, 'get', '/auth/me', { token: otherSecret })).status).toBe(401);
    const expired = jwt.sign(
      { sub: registered.body.user.id, role: 'shipper', exp: Math.floor(Date.now() / 1000) - 30 },
      process.env.JWT_ACCESS_SECRET as string,
      { algorithm: 'HS256' },
    );
    expect((await http(app, 'get', '/auth/me', { token: expired })).status).toBe(401);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: registered.body.user.id, role: 'shipper' })).toString('base64url');
    expect((await http(app, 'get', '/auth/me', { token: `${header}.${payload}.` })).status).toBe(401);

    const escalatedRole = jwt.sign({ sub: registered.body.user.id, role: 'admin' }, process.env.JWT_ACCESS_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: 1800,
    });
    expect((await http(app, 'get', '/auth/me', { token: escalatedRole })).status).toBe(401);
  });

  it('rotates refresh tokens, rejects replay, and allows only one concurrent rotation', async () => {
    const registered = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('refresh'), password: 'refresh-password', fullName: 'Refresh User', role: 'shipper' },
    });
    const first = registered.body.refreshToken as string;
    const rotated = await http(app, 'post', '/auth/refresh', { body: { refreshToken: first } });
    expect(rotated.status).toBe(200);
    assertOperationResponse('refreshToken', 200, rotated.body);
    expect(rotated.body.expiresIn).toBe(1800);
    const rotatedDecoded = jwt.decode(rotated.body.accessToken as string) as { exp: number; iat: number };
    expect(rotatedDecoded.exp - rotatedDecoded.iat).toBe(1800);
    expect(rotated.body.refreshToken).not.toBe(first);
    const replay = await http(app, 'post', '/auth/refresh', { body: { refreshToken: first } });
    expect(replay.status).toBe(401);
    assertOperationResponse('refreshToken', 401, replay.body);
    const successor = await http(app, 'post', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken as string } });
    expect(successor.status).toBe(200);

    const current = successor.body.refreshToken as string;
    const [left, right] = await Promise.all([
      http(app, 'post', '/auth/refresh', { body: { refreshToken: current } }),
      http(app, 'post', '/auth/refresh', { body: { refreshToken: current } }),
    ]);
    const won = [left, right].filter((result) => result.status === 200);
    const lost = [left, right].filter((result) => result.status === 401);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    assertOperationResponse('refreshToken', 200, won[0].body);
    assertOperationResponse('refreshToken', 401, lost[0].body);
    const afterRace = await http(app, 'post', '/auth/refresh', { body: { refreshToken: won[0].body.refreshToken as string } });
    expect(afterRace.status).toBe(200);
    expect((await http(app, 'post', '/auth/refresh', { body: { refreshToken: current } })).status).toBe(401);

    const db = app.get(DbService);
    await db.query(`UPDATE refresh_sessions SET expires_at = clock_timestamp() - interval '1 minute' WHERE user_id = $1`, [
      registered.body.user.id,
    ]);
    expect((await http(app, 'post', '/auth/refresh', { body: { refreshToken: afterRace.body.refreshToken as string } })).status).toBe(401);
  });

  it('accepts an issued access token just before 30 minutes and rejects it just after (clock-controlled)', async () => {
    const email = uniqueEmail('ttl');
    const password = 'ttl-password';
    await http(app, 'post', '/auth/register', {
      body: { email, password, fullName: 'TTL User', role: 'shipper' },
    });
    const login = await http(app, 'post', '/auth/login', { body: { email, password } });
    expect(login.status).toBe(200);
    const accessToken = login.body.accessToken as string;
    const decoded = jwt.decode(accessToken) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(1800);
    const spy = jest.spyOn(Date, 'now');
    try {
      spy.mockReturnValue((decoded.iat + 1799) * 1000);
      const before = await http(app, 'get', '/auth/me', { token: accessToken });
      expect(before.status).toBe(200);
      spy.mockReturnValue((decoded.iat + 1801) * 1000);
      const after = await http(app, 'get', '/auth/me', { token: accessToken });
      expect(after.status).toBe(401);
      assertOperationResponse('getCurrentUser', 401, after.body);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps password-reset token TTL at 30 minutes', async () => {
    const email = uniqueEmail('reset-ttl');
    const registered = await http(app, 'post', '/auth/register', {
      body: { email, password: 'reset-ttl-password', fullName: 'Reset TTL', role: 'shipper' },
    });
    const requested = await http(app, 'post', '/auth/password-reset/request', { body: { email } });
    expect(requested.status).toBe(202);
    const db = app.get(DbService);
    const rows = await db.query<{ ttl: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::float AS ttl FROM password_reset_tokens WHERE user_id = $1`,
      [registered.body.user.id],
    );
    expect(rows.rows[0].ttl).toBeGreaterThan(1795);
    expect(rows.rows[0].ttl).toBeLessThan(1805);
  });

  it('answers password reset requests without enumeration and consumes tokens once', async () => {
    const email = uniqueEmail('reset');
    const password = 'reset-password';
    const registered = await http(app, 'post', '/auth/register', {
      body: { email, password, fullName: 'Reset User', role: 'shipper' },
    });
    const access = registered.body.accessToken as string;
    const refresh = registered.body.refreshToken as string;
    const known = await http(app, 'post', '/auth/password-reset/request', { body: { email } });
    const unknown = await http(app, 'post', '/auth/password-reset/request', { body: { email: uniqueEmail('nobody') } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(RESET_OK);
    expect(unknown.body).toEqual(RESET_OK);
    assertOperationResponse('requestPasswordReset', 202, known.body);
    expect(JSON.stringify(known.body)).not.toMatch(/token|userId/i);
    const db = app.get(DbService);
    const knownCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM delivery_outbox WHERE user_id = $1 AND kind = 'password_reset'`,
      [registered.body.user.id],
    );
    expect(knownCount.rows[0].count).toBe('1');
    const again = await http(app, 'post', '/auth/password-reset/request', { body: { email: email.toUpperCase() } });
    expect(again.body).toEqual(RESET_OK);
    const afterThrottle = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM delivery_outbox WHERE user_id = $1 AND kind = 'password_reset'`,
      [registered.body.user.id],
    );
    expect(afterThrottle.rows[0].count).toBe('1');
    const unknownRows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM delivery_outbox WHERE recipient LIKE $1`,
      ['%nobody%'],
    );
    expect(unknownRows.rows[0].count).toBe('0');

    const badEmail = await http(app, 'post', '/auth/password-reset/request', { body: { email: 'not-an-email' } });
    expect(badEmail.status).toBe(400);
    assertOperationResponse('requestPasswordReset', 400, badEmail.body);

    const token = await latestPayload(app, registered.body.user.id as string, 'password_reset');
    expect(lines.join('\n')).not.toContain(token);
    expect(lines.join('\n')).not.toContain(password);

    const shortPassword = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token, newPassword: 'short' },
    });
    expect(shortPassword.status).toBe(400);
    assertOperationResponse('confirmPasswordReset', 400, shortPassword.body);

    const malformed = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token: 'too-short', newPassword: 'replacement-password' },
    });
    expect(malformed.status).toBe(401);
    expect(malformed.body).toEqual(RESET_401);
    assertOperationResponse('confirmPasswordReset', 401, malformed.body);

    const spaced = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token: `${'a'.repeat(40)} b`, newPassword: 'replacement-password' },
    });
    expect(spaced.body).toEqual(RESET_401);

    const confirmed = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token, newPassword: 'replacement-password' },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ status: 'password_changed', refreshSessionsInvalidated: true });
    assertOperationResponse('confirmPasswordReset', 200, confirmed.body);
    expect(Object.keys(confirmed.body).sort()).toEqual(['refreshSessionsInvalidated', 'status']);

    const reused = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token, newPassword: 'replacement-password-2' },
    });
    expect(reused.body).toEqual(RESET_401);

    expect((await http(app, 'get', '/auth/me', { token: access })).status).toBe(200);
    expect((await http(app, 'post', '/auth/refresh', { body: { refreshToken: refresh } })).status).toBe(401);
    expect((await http(app, 'post', '/auth/login', { body: { email, password } })).status).toBe(401);
    const relogin = await http(app, 'post', '/auth/login', { body: { email, password: 'replacement-password' } });
    expect(relogin.status).toBe(200);

    const second = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('expired'), password: 'expired-password', fullName: 'Expired', role: 'transporter' },
    });
    await http(app, 'post', '/auth/password-reset/request', { body: { email: second.body.user.email } });
    await db.query(`UPDATE password_reset_tokens SET expires_at = clock_timestamp() - interval '1 second' WHERE user_id = $1`, [
      second.body.user.id,
    ]);
    const expiredToken = await latestPayload(app, second.body.user.id as string, 'password_reset');
    const expired = await http(app, 'post', '/auth/password-reset/confirm', {
      body: { token: expiredToken, newPassword: 'replacement-password' },
    });
    expect(expired.body).toEqual(RESET_401);
    expect((await http(app, 'post', '/auth/login', { body: { email: second.body.user.email, password: 'expired-password' } })).status).toBe(200);
  });

  it('lets only one concurrent reset confirm succeed and revokes refresh sessions', async () => {
    const email = uniqueEmail('race-reset');
    const registered = await http(app, 'post', '/auth/register', {
      body: { email, password: 'race-password', fullName: 'Race Reset', role: 'shipper' },
    });
    const refresh = registered.body.refreshToken as string;
    await http(app, 'post', '/auth/password-reset/request', { body: { email } });
    const token = await latestPayload(app, registered.body.user.id as string, 'password_reset');
    const [left, right] = await Promise.all([
      http(app, 'post', '/auth/password-reset/confirm', { body: { token, newPassword: 'winner-password-a' } }),
      http(app, 'post', '/auth/password-reset/confirm', { body: { token, newPassword: 'winner-password-b' } }),
    ]);
    const won = [left, right].filter((result) => result.status === 200);
    const lost = [left, right].filter((result) => result.status === 401);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(won[0].body).toEqual({ status: 'password_changed', refreshSessionsInvalidated: true });
    expect(lost[0].body).toEqual(RESET_401);
    const logins = await Promise.all([
      http(app, 'post', '/auth/login', { body: { email, password: 'winner-password-a' } }),
      http(app, 'post', '/auth/login', { body: { email, password: 'winner-password-b' } }),
    ]);
    expect(logins.filter((result) => result.status === 200)).toHaveLength(1);
    expect((await http(app, 'post', '/auth/refresh', { body: { refreshToken: refresh } })).status).toBe(401);
  });

  it('returns a generic 429 for password-reset abuse without revealing accounts', async () => {
    const previous = process.env.RESET_SOURCE_MAX;
    process.env.RESET_SOURCE_MAX = '3';
    const limited = await createApp({ logger: false });
    process.env.RESET_SOURCE_MAX = previous;
    try {
      const email = uniqueEmail('limited');
      await http(app, 'post', '/auth/register', {
        body: { email, password: 'limited-password', fullName: 'Limited', role: 'shipper' },
      });
      const unknown = uniqueEmail('unknown-limited');
      const first = await http(limited, 'post', '/auth/password-reset/request', { body: { email } });
      const second = await http(limited, 'post', '/auth/password-reset/request', { body: { email: unknown } });
      expect(first.body).toEqual(RESET_OK);
      expect(second.body).toEqual(RESET_OK);
      await http(limited, 'post', '/auth/password-reset/request', { body: { email } });
      const blockedKnown = await http(limited, 'post', '/auth/password-reset/request', { body: { email } });
      const blockedUnknown = await http(limited, 'post', '/auth/password-reset/request', { body: { email: unknown } });
      expect(blockedKnown.status).toBe(429);
      expect(blockedUnknown.status).toBe(429);
      assertOperationResponse('requestPasswordReset', 429, blockedKnown.body);
      expect(blockedKnown.body.code).toBe(blockedUnknown.body.code);
      expect(blockedKnown.body.message).toBe(blockedUnknown.body.message);
      expect(JSON.stringify(blockedKnown.body)).not.toContain(email);
      expect(JSON.stringify(blockedUnknown.body)).not.toContain(unknown);
      expect(blockedKnown.body.details).toBeUndefined();
    } finally {
      await limited.close();
    }
  });

  it('verifies OTP without issuing a session and does not verify the company', async () => {
    const registered = await http(app, 'post', '/auth/register', {
      body: { email: uniqueEmail('otp'), password: 'otp-password', fullName: 'OTP User', role: 'shipper', city: 'Bulawayo' },
    });
    const token = registered.body.accessToken as string;
    const requested = await http(app, 'post', '/auth/otp/request', { token, body: { channel: 'email' } });
    expect(requested.status).toBe(202);
    assertOperationResponse('requestRegistrationOtp', 202, requested.body);
    expect(requested.body).toEqual({ status: 'stubbed', expiresInSeconds: 600 });
    expect(JSON.stringify(requested.body)).not.toMatch(/\d{6}/);
    const code = await latestPayload(app, registered.body.user.id as string, 'otp');
    expect(lines.join('\n')).not.toContain(code);
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = await http(app, 'post', '/auth/otp/verify', { token, body: { code: wrongCode } });
    expect(wrong.status).toBe(401);
    assertOperationResponse('verifyRegistrationOtp', 401, wrong.body);
    const verified = await http(app, 'post', '/auth/otp/verify', { token, body: { code } });
    expect(verified.status).toBe(200);
    assertOperationResponse('verifyRegistrationOtp', 200, verified.body);
    expect(verified.body.accountStatus).toBe('active');
    expect(verified.body.accessToken).toBeUndefined();
    expect(verified.body.refreshToken).toBeUndefined();
    const me = await http(app, 'get', '/auth/me', { token });
    expect(me.body.accountStatus).toBe('active');
  });

  it('accepts the fixed TEST_OTP_CODE only after an OTP request', async () => {
    const previous = process.env.TEST_OTP_CODE;
    process.env.TEST_OTP_CODE = '246810';
    const testOtp = await createApp({ logger: false });
    if (previous === undefined) {
      delete process.env.TEST_OTP_CODE;
    } else {
      process.env.TEST_OTP_CODE = previous;
    }
    try {
      const registered = await http(testOtp, 'post', '/auth/register', {
        body: { email: uniqueEmail('test-otp'), password: 'test-otp-password', fullName: 'Test OTP', role: 'shipper' },
      });
      const token = registered.body.accessToken as string;
      const requested = await http(testOtp, 'post', '/auth/otp/request', { token, body: { channel: 'email' } });
      expect(requested.status).toBe(202);
      const verified = await http(testOtp, 'post', '/auth/otp/verify', { token, body: { code: '246810' } });
      expect(verified.status).toBe(200);
      assertOperationResponse('verifyRegistrationOtp', 200, verified.body);
      expect(verified.body.accountStatus).toBe('active');

      const withoutRequest = await http(testOtp, 'post', '/auth/register', {
        body: { email: uniqueEmail('test-otp-missing'), password: 'test-otp-password', fullName: 'No Request', role: 'shipper' },
      });
      const missing = await http(testOtp, 'post', '/auth/otp/verify', {
        token: withoutRequest.body.accessToken as string,
        body: { code: '246810' },
      });
      expect(missing.status).toBe(401);
      assertOperationResponse('verifyRegistrationOtp', 401, missing.body);
      expect(missing.body.code).toBe('OTP_INVALID');
    } finally {
      await testOtp.close();
    }
  });

  it('suppresses dev delivery when the adapter is disabled and still returns the generic reset body', async () => {
    const previous = process.env.DELIVERY_ADAPTER;
    process.env.DELIVERY_ADAPTER = 'disabled';
    const quiet = await createApp({ logger: false });
    process.env.DELIVERY_ADAPTER = previous;
    try {
      const email = uniqueEmail('quiet');
      const registered = await http(quiet, 'post', '/auth/register', {
        body: { email, password: 'quiet-password', fullName: 'Quiet', role: 'shipper' },
      });
      const response = await http(quiet, 'post', '/auth/password-reset/request', { body: { email } });
      expect(response.body).toEqual(RESET_OK);
      const db = quiet.get(DbService);
      const rows = await db.query(`SELECT 1 FROM delivery_outbox WHERE user_id = $1`, [registered.body.user.id]);
      expect(rows.rowCount).toBe(0);
    } finally {
      await quiet.close();
    }
  });

  it('refuses production and non-confirming seeds and will not escalate a public user', async () => {
    await expect(
      runSeed({
        nodeEnv: 'production',
        confirm: 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(SeedRefusal);

    await expect(
      runSeed({
        nodeEnv: 'test',
        confirm: 'yes',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    ).rejects.toThrow(/SEED_CONFIRM/);

    const email = uniqueEmail('shipper-seed');
    await http(app, 'post', '/auth/register', {
      body: { email, password: 'shipper-password', fullName: 'Public', role: 'shipper' },
    });
    await expect(
      runSeed({
        nodeEnv: 'test',
        confirm: 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION',
        email,
        password: ADMIN_PASSWORD,
      }),
    ).rejects.toThrow(/escalate/);
    const db = app.get(DbService);
    const role = await db.query<{ role: string }>('SELECT role FROM users WHERE email = $1', [email]);
    expect(role.rows[0].role).toBe('shipper');

    const created = await runSeed({
      nodeEnv: 'test',
      confirm: 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(created.created).toBe(true);
    const hash = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [created.userId]);
    const again = await runSeed({
      nodeEnv: 'test',
      confirm: 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION',
      email: ADMIN_EMAIL,
      password: 'different-password',
    });
    expect(again.created).toBe(false);
    const after = await db.query<{ password_hash: string; role: string }>('SELECT password_hash, role FROM users WHERE id = $1', [
      created.userId,
    ]);
    expect(after.rows[0].role).toBe('admin');
    expect(after.rows[0].password_hash).toBe(hash.rows[0].password_hash);

    const missingAdminRoute = await http(app, 'post', '/admin/users', {
      token: (await http(app, 'post', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).body.accessToken as string,
      body: { email: uniqueEmail('other-admin'), password: 'other-admin-password', fullName: 'Other' },
    });
    expect(missingAdminRoute.status).toBe(404);
    assertSchema('Error', missingAdminRoute.body);
    expect(missingAdminRoute.body.code).toBe('NOT_FOUND');
  });

  it('keeps the dev seed helper usable for the admin company path', async () => {
    await seedAdmin();
    const login = await http(app, 'post', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('admin');
    expect(login.body.user.accountStatus).toBe('active');
  });
});
