import { loadEnv } from '../src/config/env';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  DELIVERY_ADAPTER: 'dev',
};

describe('environment configuration', () => {
  it('defaults access and reset token TTLs to 1800', () => {
    const env = loadEnv(base);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(1800);
    expect(env.RESET_TOKEN_TTL_SECONDS).toBe(1800);
  });

  it('rejects a non-1800 access token TTL', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_TTL_SECONDS: '900' })).toThrow(/JWT_ACCESS_TTL_SECONDS must be 1800/);
  });

  it('accepts an access token TTL of 1800', () => {
    expect(loadEnv({ ...base, JWT_ACCESS_TTL_SECONDS: '1800' }).JWT_ACCESS_TTL_SECONDS).toBe(1800);
  });

  it('rejects a non-1800 reset token TTL', () => {
    expect(() => loadEnv({ ...base, RESET_TOKEN_TTL_SECONDS: '900' })).toThrow(/RESET_TOKEN_TTL_SECONDS must be 1800/);
  });
});
