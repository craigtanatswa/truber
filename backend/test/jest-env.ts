import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://truber:truber@127.0.0.1:5432/truber_test';
process.env.JWT_ACCESS_SECRET ??= 'test-only-jwt-secret-must-be-at-least-32';
process.env.DELIVERY_ADAPTER ??= 'dev';
process.env.JWT_ACCESS_TTL_SECONDS ??= '900';
process.env.RESET_TOKEN_TTL_SECONDS ??= '1800';
process.env.RESET_SOURCE_MAX ??= '1000';
process.env.CONFIRM_SOURCE_MAX ??= '1000';
process.env.OTP_SOURCE_MAX ??= '1000';
process.env.OTP_VERIFY_MAX ??= '1000';
process.env.BIND_HOST ??= '127.0.0.1';
