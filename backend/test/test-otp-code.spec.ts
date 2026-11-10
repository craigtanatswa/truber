import { loadEnv } from '../src/config/env';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://runtime_placeholder:placeholder@127.0.0.1:5432/truber_test',
    JWT_ACCESS_SECRET: 'test-only-jwt-secret-must-be-at-least-32',
    DELIVERY_ADAPTER: 'dev',
    DB_TARGET: 'local',
    DB_SCHEMA: 'public',
    POSTGIS_SCHEMA: 'public',
    DB_SSL_MODE: 'disable',
    DB_CONNECTION_MODE: 'direct',
    DB_MIGRATION_CONNECTION_MODE: 'direct',
    ...overrides,
  };
}

describe('test OTP code configuration', () => {
  it('is unset by default and when blank', () => {
    expect(loadEnv(env()).TEST_OTP_CODE).toBeUndefined();
    expect(loadEnv(env({ TEST_OTP_CODE: '   ' })).TEST_OTP_CODE).toBeUndefined();
  });

  it('accepts a six digit code outside production', () => {
    expect(loadEnv(env({ TEST_OTP_CODE: '246810' })).TEST_OTP_CODE).toBe('246810');
  });

  it('refuses a code in production', () => {
    expect(() => loadEnv(env({ NODE_ENV: 'production', TEST_OTP_CODE: '246810' }))).toThrow(
      'TEST_OTP_CODE cannot be used when NODE_ENV=production',
    );
  });

  it('refuses a code that is not exactly six digits', () => {
    expect(() => loadEnv(env({ TEST_OTP_CODE: '24681' }))).toThrow('TEST_OTP_CODE must be exactly 6 digits');
    expect(() => loadEnv(env({ TEST_OTP_CODE: '24681a' }))).toThrow('TEST_OTP_CODE must be exactly 6 digits');
  });

  it('refuses the production Supabase project', () => {
    expect(() =>
      loadEnv(
        env({
          DATABASE_URL: 'postgres://runtime_placeholder:placeholder@DB.NVEJIJEPREJHTBSAREHZ.supabase.co:5432/postgres',
          TEST_OTP_CODE: '246810',
        }),
      ),
    ).toThrow('TEST_OTP_CODE cannot be used against the production Supabase project');
  });
});
