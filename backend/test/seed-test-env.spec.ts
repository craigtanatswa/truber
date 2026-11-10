import { ACCOUNTS, LOADS, SeedTestEnvRefusal, assertSeedTestEnvAllowed } from '../scripts/seed-test-env';

const ok: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  SEED_TEST_ENV: 'yes',
  SEED_API_URL: 'http://127.0.0.1:3108',
  DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:5438/truber_test_env',
};

describe('seed-test-env guard', () => {
  it('allows an explicit non-production test environment', () => {
    expect(() => assertSeedTestEnvAllowed(ok)).not.toThrow();
  });

  it('refuses NODE_ENV=production', () => {
    expect(() => assertSeedTestEnvAllowed({ ...ok, NODE_ENV: 'production' })).toThrow(SeedTestEnvRefusal);
    expect(() => assertSeedTestEnvAllowed({ ...ok, NODE_ENV: ' Production ' })).toThrow(/NODE_ENV=production/);
  });

  it('refuses the production Supabase project in any database or API URL', () => {
    for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'SEED_API_URL']) {
      expect(() =>
        assertSeedTestEnvAllowed({ ...ok, [key]: 'postgres://x:y@db.NVEJIJEPREJHTBSAREHZ.supabase.co:5432/postgres' }),
      ).toThrow(/production Supabase project/);
    }
  });

  it('requires SEED_TEST_ENV=yes exactly', () => {
    expect(() => assertSeedTestEnvAllowed({ ...ok, SEED_TEST_ENV: undefined })).toThrow(/SEED_TEST_ENV=yes/);
    expect(() => assertSeedTestEnvAllowed({ ...ok, SEED_TEST_ENV: 'true' })).toThrow(/SEED_TEST_ENV=yes/);
  });

  it('requires an http(s) SEED_API_URL', () => {
    expect(() => assertSeedTestEnvAllowed({ ...ok, SEED_API_URL: undefined })).toThrow(/SEED_API_URL/);
  });

  it('only seeds clearly fake data', () => {
    for (const account of ACCOUNTS) {
      expect(account.email).toMatch(/@example\.com$/);
      expect(account.fullName).toContain('TEST');
      expect(account.phone).toMatch(/^\+2637\d{8}$/);
      if (account.company) expect(account.company.legalName).toContain('TEST');
    }
    for (const load of LOADS) expect(load.goodsType).toContain('TEST');
    expect(new Set(ACCOUNTS.map((a) => a.role))).toEqual(new Set(['admin', 'shipper', 'transporter']));
  });
});
