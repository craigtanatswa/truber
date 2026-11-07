import { z, ZodError } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),
  RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().default(1800),
  REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(7_776_000).default(1_209_600),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  DELIVERY_ADAPTER: z.enum(['dev', 'disabled']),
  RESET_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
  RESET_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  CONFIRM_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
  CONFIRM_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  OTP_SOURCE_MAX: z.coerce.number().int().min(1).max(100_000).default(5),
  OTP_SOURCE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  OTP_VERIFY_MAX: z.coerce.number().int().min(1).max(100_000).default(5),
  OTP_VERIFY_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
});

export type Env = z.infer<typeof schema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  let parsed: Env;
  try {
    parsed = schema.parse(source);
  } catch (error) {
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
      throw new Error(`Invalid environment configuration: ${fields}`);
    }
    throw error;
  }

  if (parsed.JWT_ACCESS_TTL_SECONDS !== 900) {
    throw new Error('JWT_ACCESS_TTL_SECONDS must be 900 to match API v0.2.0');
  }
  if (parsed.RESET_TOKEN_TTL_SECONDS !== 1800) {
    throw new Error('RESET_TOKEN_TTL_SECONDS must be 1800 to match API v0.2.0');
  }
  if (parsed.NODE_ENV === 'production' && parsed.DELIVERY_ADAPTER === 'dev') {
    throw new Error('DELIVERY_ADAPTER=dev cannot be used when NODE_ENV=production');
  }
  return parsed;
}
