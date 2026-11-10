import { cleanupInputFromOutput } from '../scripts/seed-cleanup';
import {
  banScenarioIds,
  batchUuid,
  buildAccountsSql,
  buildBanSql,
  buildCleanupSql,
  buildCleanupVerifySql,
  buildPasswordResetSql,
} from '../scripts/seed-sql';
import {
  ACCOUNTS,
  LOADS,
  PRODUCTION_OVERRIDE,
  SeedOutput,
  SeedTestEnvRefusal,
  resolveBatchId,
  resolveSeedMode,
} from '../scripts/seed-test-env';

const ok: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  SEED_TEST_ENV: 'yes',
  SEED_API_URL: 'http://127.0.0.1:3108',
  DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:5438/truber_test_env',
};
const prod: NodeJS.ProcessEnv = {
  SEED_TEST_ENV: 'yes',
  SEED_API_URL: 'https://truber-api.example.vercel.app',
  SEED_ALLOW_PRODUCTION: PRODUCTION_OVERRIDE,
};

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';
const L1 = '44444444-4444-4444-8444-444444444444';
const BATCH = 't20261110-abc123';

describe('seed-test-env guards', () => {
  it('allows an explicit non-production test environment, default mode unless --http-only', () => {
    expect(resolveSeedMode(ok)).toEqual({ production: false, httpOnly: false, apiUrl: ok.SEED_API_URL });
    expect(resolveSeedMode(ok, ['--http-only']).httpOnly).toBe(true);
  });

  it('refuses NODE_ENV=production, even with the override', () => {
    expect(() => resolveSeedMode({ ...ok, NODE_ENV: ' Production ' })).toThrow(SeedTestEnvRefusal);
    expect(() => resolveSeedMode({ ...prod, NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });

  it('refuses the production project ref by default', () => {
    for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'SEED_API_URL']) {
      expect(() => resolveSeedMode({ ...ok, [key]: 'https://db.NVEJIJEPREJHTBSAREHZ.supabase.co:5432/postgres' })).toThrow(
        /production Supabase project/,
      );
    }
  });

  it('requires SEED_TEST_ENV=yes exactly and an http(s) SEED_API_URL', () => {
    expect(() => resolveSeedMode({ ...ok, SEED_TEST_ENV: 'true' })).toThrow(/SEED_TEST_ENV=yes/);
    expect(() => resolveSeedMode({ ...prod, SEED_TEST_ENV: undefined })).toThrow(/SEED_TEST_ENV=yes/);
    expect(() => resolveSeedMode({ ...ok, SEED_API_URL: undefined })).toThrow(/SEED_API_URL/);
    expect(() => resolveSeedMode({ ...ok, SEED_API_URL: 'ftp://x' })).toThrow(/SEED_API_URL/);
  });

  it('production override: exact value, https, not localhost, HTTP-only, no DB credentials', () => {
    expect(resolveSeedMode(prod)).toEqual({ production: true, httpOnly: true, apiUrl: prod.SEED_API_URL });
    expect(() => resolveSeedMode({ ...prod, SEED_ALLOW_PRODUCTION: 'yes' })).toThrow(/unexpected value/);
    expect(() => resolveSeedMode({ ...prod, SEED_API_URL: 'http://truber-api.example.vercel.app' })).toThrow(/https/);
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '0.0.0.0']) {
      expect(() => resolveSeedMode({ ...prod, SEED_API_URL: `https://${host}:3000` })).toThrow(/not localhost/);
    }
    expect(() => resolveSeedMode({ ...prod, DATABASE_URL: 'postgres://a:b@h/db' })).toThrow(/unset DATABASE_URL/);
    expect(() => resolveSeedMode({ ...prod, DATABASE_MIGRATION_URL: 'postgres://a:b@h/db' })).toThrow(/unset DATABASE_MIGRATION_URL/);
  });

  it('keeps one batch id per output file', () => {
    expect(resolveBatchId(undefined, BATCH)).toBe(BATCH);
    expect(resolveBatchId(BATCH, BATCH)).toBe(BATCH);
    expect(() => resolveBatchId('t-other-1', BATCH)).toThrow(/differs/);
    expect(resolveBatchId(undefined, undefined, new Date('2026-11-10T10:00:00Z'))).toMatch(/^t20261110-[0-9a-f]{6}$/);
    expect(() => resolveBatchId("x'; drop", undefined)).toThrow(/batch id/);
  });

  it('only seeds clearly fake data', () => {
    for (const account of ACCOUNTS) {
      expect(account.email).toMatch(/^test\.[a-z.]+@example\.com$/);
      expect(account.fullName.startsWith('TEST ')).toBe(true);
      expect(account.phone).toMatch(/^\+2637\d{8}$/);
      if (account.company) expect(account.company.legalName.startsWith('TEST ')).toBe(true);
    }
    for (const load of LOADS) expect(load.goodsType).toContain('TEST');
    expect(new Set(ACCOUNTS.map((a) => a.role))).toEqual(new Set(['admin', 'shipper', 'transporter']));
  });
});

describe('seed SQL scoping', () => {
  const markers = [`email LIKE '%@example.com'`, `full_name LIKE 'TEST %'`, `full_name LIKE '%(seed ${BATCH})'`];

  it('accounts SQL updates only listed TEST users and promotes only the TEST admin', () => {
    const sql = buildAccountsSql({
      schema: 'truber',
      batchId: BATCH,
      promoteAdmin: { userId: U1, email: 'test.admin@example.com' },
      activate: [{ userId: U2, email: 'test.shipper@example.com' }],
    });
    const updates = sql.split(';').filter((s) => /UPDATE/.test(s));
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u).toMatch(/WHERE u\.id (=|= ANY)/);
      for (const m of markers) expect(u).toContain(m);
    }
    expect(updates[0]).toContain(`'${U1}'::uuid`);
    expect(updates[0]).toContain(`role = 'admin'`);
    expect(updates[1]).not.toContain(`role = 'admin'`);
    expect(updates[1]).toContain(`account_status = 'pending_verification'`);
    expect(sql).toContain('truber.users');
    expect(sql).not.toMatch(/DELETE|INSERT|DROP|TRUNCATE/);
  });

  it('refuses non-example emails, bad ids, bad schemas and odd hashes', () => {
    expect(() => buildAccountsSql({ schema: 'truber', batchId: BATCH, promoteAdmin: { userId: U1, email: 'real@gmail.com' }, activate: [] })).toThrow(
      /example\.com/,
    );
    expect(() => buildAccountsSql({ schema: 'truber', batchId: BATCH, promoteAdmin: { userId: 'x', email: 'test.a@example.com' }, activate: [] })).toThrow(
      /uuid/,
    );
    expect(() => buildAccountsSql({ schema: 'Truber;', batchId: BATCH, promoteAdmin: null, activate: [] })).toThrow(/schema/);
    expect(() =>
      buildPasswordResetSql({ schema: 'truber', batchId: BATCH, resets: [{ userId: U1, email: 'test.a@example.com', passwordHash: "x' OR 1=1" }] }),
    ).toThrow(/hash/);
    const reset = buildPasswordResetSql({
      schema: 'truber',
      batchId: BATCH,
      resets: [{ userId: U1, email: 'test.a@example.com', passwordHash: 'scrypt$16384$8$1$salt$key' }],
    });
    for (const m of markers) expect(reset).toContain(m);
  });

  it('ban SQL is idempotent, deterministic and requires the TEST markers', () => {
    const ids = banScenarioIds(BATCH);
    expect(banScenarioIds(BATCH)).toEqual(ids);
    expect(batchUuid(BATCH, 'x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const sql = buildBanSql({
      schema: 'truber',
      batchId: BATCH,
      ids,
      reporter: { userId: U2, email: 'test.transporter@example.com' },
      admin: { userId: U1, email: 'test.admin@example.com' },
      banned: { userId: U2, email: 'test.shipper.banned@example.com', companyId: C1 },
    });
    expect(sql.match(/ON CONFLICT \(id\) DO NOTHING/g)).toHaveLength(3);
    expect(sql).toContain(`registration_number LIKE 'TEST-${BATCH}-%'`);
    expect(sql).toContain(`interval '336 hours'`);
    expect(sql).not.toMatch(/DELETE|UPDATE|DROP|TRUNCATE/);
  });

  it('cleanup deletes only batch rows, children first, behind a guard', () => {
    const input = {
      schema: 'truber',
      batchId: BATCH,
      userIds: [U1, U2],
      companyIds: [C1],
      loadIds: [L1],
      reportIds: [],
      findingIds: [],
      banIds: [],
    };
    const sql = buildCleanupSql(input);
    const deletes = [...sql.matchAll(/DELETE FROM truber\.(\w+) WHERE ([^\n]+) RETURNING 1/g)];
    const order = deletes.map((d) => d[1]);
    expect(order).toEqual([
      'off_platform_bans',
      'off_platform_findings',
      'off_platform_reports',
      'loads',
      'company_members',
      'refresh_sessions',
      'password_reset_tokens',
      'otp_challenges',
      'idempotency_records',
      'delivery_outbox',
      'rate_limit_buckets',
      'companies',
      'users',
    ]);
    for (const [, , where] of deletes) {
      expect(where).toMatch(/batch_users|batch_companies|del_findings_set|del_reports_set/);
    }
    expect(sql).toContain(`u.id = ANY(ARRAY['${U1}'::uuid, '${U2}'::uuid])`);
    for (const m of [`u.email LIKE '%@example.com'`, `u.full_name LIKE 'TEST %'`, `c.legal_name LIKE 'TEST %'`, `c.registration_number LIKE 'TEST-${BATCH}-%'`]) {
      expect(sql).toContain(m);
    }
    expect(sql).toContain('seed cleanup refused');
    expect(sql).toContain('WHERE guard.ok = 0');
    expect(sql).not.toMatch(/TRUNCATE|DROP|UPDATE /);
    const verify = buildCleanupVerifySql(input);
    expect(verify).not.toMatch(/DELETE|UPDATE|INSERT/);
  });

  it('builds cleanup input from a seed output file', () => {
    const output = {
      batchId: BATCH,
      schema: 'truber',
      createdIds: { users: [U1], companies: [C1], loads: [L1], offPlatformReports: [], offPlatformFindings: [], offPlatformBans: [] },
    } as unknown as SeedOutput;
    expect(cleanupInputFromOutput(output)).toMatchObject({ batchId: BATCH, userIds: [U1], companyIds: [C1], loadIds: [L1] });
    expect(() => cleanupInputFromOutput({} as SeedOutput)).toThrow(/batch id/);
  });
});
