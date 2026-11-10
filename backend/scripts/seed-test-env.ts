/*
 * Test-environment seed for hands-on product testing.
 *
 * Creates clearly fake shipper, transporter and admin accounts, companies in
 * several verification states, sample loads and one off-platform ban scenario,
 * all tagged with a seed batch id so `npm run seed:cleanup` can remove exactly
 * this batch later.
 *
 * Everything that has an API endpoint goes through the HTTP API. The few steps
 * with no endpoint (promoting the TEST admin, marking seeded TEST users
 * phone-verified while SMS is off, the ban scenario while bookings don't exist,
 * and password recovery) are emitted as reviewed, idempotent SQL files in
 * backend/.seed-sql/.
 *   - Default mode (local test DB): the seed applies those files itself through
 *     DATABASE_URL and carries on.
 *   - --http-only mode (forced for the user-approved production target): the
 *     seed never reads any database setting. It writes the SQL file, saves its
 *     progress to the output file and exits with code 3. An operator runs the
 *     file (e.g. via the Supabase MCP) and reruns the seed, which continues.
 *
 * Required env: SEED_TEST_ENV=yes, SEED_API_URL=<base URL of the running API>.
 * Default mode also needs the API's usual DATABASE_URL / DB_* settings.
 * Production target: SEED_ALLOW_PRODUCTION=user-approved-2026-11-10, an https
 * SEED_API_URL that is not localhost, and DATABASE_URL/DATABASE_MIGRATION_URL unset.
 * Optional: SEED_BATCH_ID, SEED_OUTPUT_FILE, SEED_SQL_DIR, SEED_SQL_SCHEMA
 * (http-only, default truber), SEED_BOOKING_FIXTURES_FILE (local only).
 */
import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import { hashPassword } from '../src/common/crypto';
import { loadEnv } from '../src/config/env';
import { buildPoolConfig } from '../src/db/pg-config';
import { loadDotEnv } from '../src/load-dotenv';
import {
  assertBatchId,
  assertSchema,
  banScenarioIds,
  batchTag,
  buildAccountsSql,
  buildBanSql,
  buildPasswordResetSql,
  SeedUserRef,
} from './seed-sql';

export const PRODUCTION_PROJECT_REF = 'nvejijeprejhtbsarehz';
/** Exact value the user-approved production override needs (user decision relayed 2026-11-10 12:28 CAT). */
export const PRODUCTION_OVERRIDE = 'user-approved-2026-11-10';
export const EXIT_NEEDS_SQL = 3;

export class SeedTestEnvRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedTestEnvRefusal';
  }
}

export interface SeedMode {
  production: boolean;
  httpOnly: boolean;
  apiUrl: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Pure guard, unit-tested. Throws SeedTestEnvRefusal when seeding is not allowed. */
export function resolveSeedMode(source: NodeJS.ProcessEnv, argv: readonly string[] = []): SeedMode {
  if ((source.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new SeedTestEnvRefusal('Refusing to seed: NODE_ENV=production');
  }
  if (source.SEED_TEST_ENV !== 'yes') {
    throw new SeedTestEnvRefusal('Refusing to seed: set SEED_TEST_ENV=yes to confirm this is test data');
  }
  const apiUrl = source.SEED_API_URL ?? '';
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new SeedTestEnvRefusal('Refusing to seed: SEED_API_URL must be the http(s) base URL of the running API');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SeedTestEnvRefusal('Refusing to seed: SEED_API_URL must be the http(s) base URL of the running API');
  }
  const override = source.SEED_ALLOW_PRODUCTION;
  if (override !== undefined && override !== '') {
    if (override !== PRODUCTION_OVERRIDE) {
      throw new SeedTestEnvRefusal('Refusing to seed: SEED_ALLOW_PRODUCTION has an unexpected value');
    }
    if (parsed.protocol !== 'https:' || LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.hostname.startsWith('127.')) {
      throw new SeedTestEnvRefusal('Refusing to seed: the production target needs an https SEED_API_URL that is not localhost');
    }
    for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
      if ((source[key] ?? '') !== '') {
        throw new SeedTestEnvRefusal(`Refusing to seed: unset ${key}; the production target is HTTP-only and never uses database credentials`);
      }
    }
    return { production: true, httpOnly: true, apiUrl };
  }
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'SEED_API_URL']) {
    if ((source[key] ?? '').toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      throw new SeedTestEnvRefusal(`Refusing to seed: ${key} points at the production Supabase project`);
    }
  }
  return { production: false, httpOnly: argv.includes('--http-only'), apiUrl };
}

export function resolveBatchId(fromEnv: string | undefined, fromOutput: string | undefined, now = new Date()): string {
  if (fromEnv && fromOutput && fromEnv !== fromOutput) {
    throw new SeedTestEnvRefusal(
      `Refusing to seed: SEED_BATCH_ID=${fromEnv} differs from the batch ${fromOutput} in the output file; use another SEED_OUTPUT_FILE for a new batch`,
    );
  }
  const chosen = fromEnv || fromOutput || `t${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;
  return assertBatchId(chosen);
}

type Role = 'shipper' | 'transporter' | 'admin';
type Verification = 'unverified' | 'pending' | 'verified' | 'rejected';

interface AccountSpec {
  key: string;
  email: string;
  fullName: string;
  phone: string;
  city: string;
  role: Role;
  activate: boolean;
  company?: { legalName: string; tradingName: string; registrationSuffix: string; city: string; verification: Verification };
  purpose: string;
}

export const ACCOUNTS: AccountSpec[] = [
  {
    key: 'admin',
    email: 'test.admin@example.com',
    fullName: 'TEST Admin Tendai',
    phone: '+263771000001',
    city: 'Harare',
    role: 'admin',
    activate: true,
    purpose: 'Admin: verify companies, review off-platform reports, lift bans',
  },
  {
    key: 'shipper',
    email: 'test.shipper@example.com',
    fullName: 'TEST Shipper Rudo Moyo',
    phone: '+263771000002',
    city: 'Harare',
    role: 'shipper',
    activate: true,
    company: {
      legalName: 'TEST Mhofu Agri Supplies (Pvt) Ltd',
      tradingName: 'TEST Mhofu Agri',
      registrationSuffix: '0001',
      city: 'Harare',
      verification: 'verified',
    },
    purpose: 'Verified shipper with sample loads; can post loads',
  },
  {
    key: 'shipper_unverified',
    email: 'test.shipper.new@example.com',
    fullName: 'TEST Shipper Farai Ncube',
    phone: '+263771000003',
    city: 'Bulawayo',
    role: 'shipper',
    activate: false,
    company: {
      legalName: 'TEST Kudzi Wholesalers (Pvt) Ltd',
      tradingName: 'TEST Kudzi Wholesale',
      registrationSuffix: '0002',
      city: 'Bulawayo',
      verification: 'unverified',
    },
    purpose: 'Phone not yet verified, company unverified: posting a load is refused until both are verified',
  },
  {
    key: 'transporter',
    email: 'test.transporter@example.com',
    fullName: 'TEST Transporter Tafadzwa Dube',
    phone: '+263771000004',
    city: 'Harare',
    role: 'transporter',
    activate: true,
    company: {
      legalName: 'TEST Zambezi Haulage (Pvt) Ltd',
      tradingName: 'TEST Zambezi Haulage',
      registrationSuffix: '0003',
      city: 'Harare',
      verification: 'verified',
    },
    purpose: 'Verified transporter / fleet owner; can search posted loads',
  },
  {
    key: 'transporter_pending',
    email: 'test.transporter.pending@example.com',
    fullName: 'TEST Transporter Chipo Sibanda',
    phone: '+263771000005',
    city: 'Mutare',
    role: 'transporter',
    activate: true,
    company: {
      legalName: 'TEST Eastern Highlands Logistics',
      tradingName: 'TEST EH Logistics',
      registrationSuffix: '0004',
      city: 'Mutare',
      verification: 'pending',
    },
    purpose: 'Transporter whose company verification is pending (admin can approve it)',
  },
  {
    key: 'shipper_banned',
    email: 'test.shipper.banned@example.com',
    fullName: 'TEST Shipper Banned Gift Mpofu',
    phone: '+263771000006',
    city: 'Gweru',
    role: 'shipper',
    activate: true,
    company: {
      legalName: 'TEST Midlands Banned Traders',
      tradingName: 'TEST Banned Traders',
      registrationSuffix: '0005',
      city: 'Gweru',
      verification: 'verified',
    },
    purpose: 'Shipper with an active 14-day off-platform ban: creating or posting loads is refused',
  },
];

interface LoadSpec {
  key: string;
  goodsType: string;
  weightKg: number;
  truckTypeRequired: string;
  pickupAddress: string;
  pickupPoint: { latitude: number; longitude: number };
  destinationAddress: string;
  destinationPoint: { latitude: number; longitude: number };
  loadingInDays: number;
  deadlineInDays: number;
  specialRequirements: string;
  rateType: 'fixed' | 'negotiable';
  offeredRateMinor?: number;
  target: 'draft' | 'posted' | 'cancelled';
}

const HARARE = { latitude: -17.8292, longitude: 31.0522 };
const BULAWAYO = { latitude: -20.1325, longitude: 28.6265 };
const MUTARE = { latitude: -18.9707, longitude: 32.6709 };
const BEITBRIDGE = { latitude: -22.2167, longitude: 30.0 };
const GWERU = { latitude: -19.4614, longitude: 29.8022 };
const MASVINGO = { latitude: -20.0744, longitude: 30.8328 };

export const LOADS: LoadSpec[] = [
  {
    key: 'hre-byo-fertiliser',
    goodsType: 'TEST Fertiliser (Compound D, 50kg bags)',
    weightKg: 30000,
    truckTypeRequired: 'flatbed',
    pickupAddress: 'TEST depot, Msasa Industrial, Harare',
    pickupPoint: HARARE,
    destinationAddress: 'TEST warehouse, Belmont Industrial, Bulawayo',
    destinationPoint: BULAWAYO,
    loadingInDays: 3,
    deadlineInDays: 5,
    specialRequirements: 'Tarpaulin cover required.',
    rateType: 'fixed',
    offeredRateMinor: 100000,
    target: 'posted',
  },
  {
    key: 'hre-mutare-maize',
    goodsType: 'TEST Maize meal (10kg bags)',
    weightKg: 20000,
    truckTypeRequired: 'box',
    pickupAddress: 'TEST mill, Workington, Harare',
    pickupPoint: HARARE,
    destinationAddress: 'TEST distributor, Sakubva, Mutare',
    destinationPoint: MUTARE,
    loadingInDays: 4,
    deadlineInDays: 6,
    specialRequirements: 'Keep dry.',
    rateType: 'negotiable',
    offeredRateMinor: 60000,
    target: 'posted',
  },
  {
    key: 'byo-beitbridge-cement',
    goodsType: 'TEST Cement (pallets)',
    weightKg: 34000,
    truckTypeRequired: 'side_loader',
    pickupAddress: 'TEST plant, Kelvin, Bulawayo',
    pickupPoint: BULAWAYO,
    destinationAddress: 'TEST yard, Beitbridge border post',
    destinationPoint: BEITBRIDGE,
    loadingInDays: 6,
    deadlineInDays: 8,
    specialRequirements: 'Forklift at both ends.',
    rateType: 'negotiable',
    target: 'posted',
  },
  {
    key: 'mutare-hre-return',
    goodsType: 'TEST Timber (return load)',
    weightKg: 25000,
    truckTypeRequired: 'flatbed',
    pickupAddress: 'TEST sawmill, Mutare',
    pickupPoint: MUTARE,
    destinationAddress: 'TEST hardware, Southerton, Harare',
    destinationPoint: HARARE,
    loadingInDays: 7,
    deadlineInDays: 9,
    specialRequirements: 'Return-load example (Mutare to Harare).',
    rateType: 'fixed',
    offeredRateMinor: 55000,
    target: 'posted',
  },
  {
    key: 'hre-gweru-draft',
    goodsType: 'TEST Cooking oil (cartons)',
    weightKg: 12000,
    truckTypeRequired: 'box',
    pickupAddress: 'TEST factory, Graniteside, Harare',
    pickupPoint: HARARE,
    destinationAddress: 'TEST supermarket DC, Gweru',
    destinationPoint: GWERU,
    loadingInDays: 10,
    deadlineInDays: 12,
    specialRequirements: 'Draft only, not yet posted.',
    rateType: 'negotiable',
    target: 'draft',
  },
  {
    key: 'masvingo-hre-cancelled',
    goodsType: 'TEST Sugar (50kg bags)',
    weightKg: 28000,
    truckTypeRequired: 'tipper',
    pickupAddress: 'TEST estate, Masvingo',
    pickupPoint: MASVINGO,
    destinationAddress: 'TEST depot, Harare',
    destinationPoint: HARARE,
    loadingInDays: 5,
    deadlineInDays: 7,
    specialRequirements: 'Cancelled example.',
    rateType: 'fixed',
    offeredRateMinor: 70000,
    target: 'cancelled',
  },
];


interface SeedOutputAccount {
  email: string;
  role: Role;
  password: string | null;
  pendingPassword?: string;
  userId: string;
  companyId: string | null;
  companyName: string | null;
  companyVerification: Verification | null;
  accountStatus: string;
  purpose: string;
}

export interface SeedOutput {
  batchId: string;
  schema: string;
  apiUrl: string;
  mode: 'default' | 'http-only' | 'production-http-only';
  generatedAt: string;
  accounts: Record<string, SeedOutputAccount>;
  loads: Record<string, { id: string; status: string; route: string }>;
  banScenario: { bookingId: string; reportId: string | null; findingId: string | null; banIds: string[]; via: string } | null;
  createdIds: {
    users: string[];
    companies: string[];
    loads: string[];
    offPlatformReports: string[];
    offPlatformFindings: string[];
    offPlatformBans: string[];
  };
  /** Rows without their own API id, removed by cleanup through the batch user ids. */
  cleanedByUserId: string[];
  pendingSql: string[];
}

class Api {
  constructor(private readonly base: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON in a test-only script
  async call<T = any>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; idempotencyKey?: string; expect?: number[] } = {},
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    const response = await fetch(new URL(path.replace(/^\//, ''), this.base.endsWith('/') ? this.base : `${this.base}/`), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as T) : (undefined as T);
    if (options.expect && !options.expect.includes(response.status)) {
      const code = (body as { code?: string } | undefined)?.code ?? '';
      throw new Error(`${method} ${path} -> ${response.status} ${code}`.trim());
    }
    return { status: response.status, body };
  }
}

class NeedsSql extends Error {
  constructor(readonly file: string) {
    super(`SQL step needed: ${file}`);
  }
}

function strongPassword(): string {
  return `${randomBytes(18).toString('base64url')}-Tt9`;
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function marker(key: string): string {
  return `[TEST-SEED:${key}]`;
}

function seededName(spec: AccountSpec, batchId: string): string {
  return `${spec.fullName} (${batchTag(batchId)})`;
}

function addId(list: string[], id: string | null | undefined): void {
  if (id && !list.includes(id)) list.push(id);
}

async function main(): Promise<void> {
  const overrideRequested = (process.env.SEED_ALLOW_PRODUCTION ?? '') !== '';
  if (!overrideRequested && !process.argv.includes('--http-only')) {
    loadDotEnv(); // never for the production target: a local .env could carry DB credentials
  }
  const mode = resolveSeedMode(process.env, process.argv.slice(2));
  const api = new Api(mode.apiUrl);
  const outFile = resolve(process.env.SEED_OUTPUT_FILE ?? resolve(__dirname, '..', '.seed-output.json'));
  const sqlDir = resolve(process.env.SEED_SQL_DIR ?? resolve(__dirname, '..', '.seed-sql'));
  const previous: SeedOutput | null = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')) as SeedOutput) : null;
  if (previous && previous.apiUrl !== mode.apiUrl) {
    throw new SeedTestEnvRefusal(`Refusing to seed: ${outFile} belongs to ${previous.apiUrl}; use another SEED_OUTPUT_FILE`);
  }
  const batchId = resolveBatchId(process.env.SEED_BATCH_ID?.trim() || undefined, previous?.batchId);
  const tag = batchTag(batchId);

  let pool: Pool | null = null;
  let schema: string;
  if (mode.httpOnly) {
    schema = assertSchema(process.env.SEED_SQL_SCHEMA?.trim() || previous?.schema || 'truber');
  } else {
    const env = loadEnv(process.env, { purpose: 'api' });
    schema = assertSchema(env.db.DB_SCHEMA);
    pool = new Pool(buildPoolConfig(env.db, 'runtime'));
  }

  const output: SeedOutput = {
    batchId,
    schema,
    apiUrl: mode.apiUrl,
    mode: mode.production ? 'production-http-only' : mode.httpOnly ? 'http-only' : 'default',
    generatedAt: new Date().toISOString(),
    accounts: previous?.accounts ?? {},
    loads: previous?.loads ?? {},
    banScenario: previous?.banScenario ?? null,
    createdIds: previous?.createdIds ?? {
      users: [],
      companies: [],
      loads: [],
      offPlatformReports: [],
      offPlatformFindings: [],
      offPlatformBans: [],
    },
    cleanedByUserId: [
      'company_members',
      'refresh_sessions',
      'password_reset_tokens',
      'otp_challenges',
      'idempotency_records',
      'delivery_outbox',
      'rate_limit_buckets (otp-user:/otp-verify: keys)',
    ],
    pendingSql: [],
  };
  const save = () => writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  const newPasswords: Array<{ email: string; password: string }> = [];

  /** Write the SQL file; apply it locally in default mode, otherwise stop and ask the operator. */
  const sqlStep = async (step: string, sql: string): Promise<void> => {
    mkdirSync(sqlDir, { recursive: true, mode: 0o700 });
    const file = resolve(sqlDir, `${batchId}-${step}.sql`);
    writeFileSync(file, sql, { mode: 0o600 });
    if (pool) {
      await pool.query(sql);
      log(`applied ${file} with the local test connection`);
      return;
    }
    output.pendingSql = [file];
    throw new NeedsSql(file);
  };

  log(`batch ${batchId}, mode ${output.mode}, API ${mode.apiUrl}`);
  try {
    // ---- Phase 1: accounts (HTTP register + login) -------------------------------------------
    const tokens: Record<string, string> = {};
    const loginAll = async (): Promise<{
      resets: Array<SeedUserRef & { passwordHash: string }>;
      promote: SeedUserRef | null;
      activate: SeedUserRef[];
    }> => {
      const resets: Array<SeedUserRef & { passwordHash: string }> = [];
      let promote: SeedUserRef | null = null;
      const activate: SeedUserRef[] = [];
      for (const spec of ACCOUNTS) {
        const known = output.accounts[spec.key];
        let password = known?.password ?? null;
        if (!known) {
          password = strongPassword();
          const registered = await api.call('POST', '/auth/register', {
            body: {
              email: spec.email,
              password,
              fullName: seededName(spec, batchId),
              phone: spec.phone,
              city: spec.city,
              // The API has no admin sign-up; the TEST admin registers as a shipper and is promoted by SQL.
              role: spec.role === 'admin' ? 'shipper' : spec.role,
            },
            expect: [201, 409],
          });
          if (registered.status === 201) {
            newPasswords.push({ email: spec.email, password });
            log(`${spec.email} registered via POST /auth/register`);
          } else {
            password = null; // exists from an earlier run whose output file is gone
          }
        }
        let login = password ? await api.call('POST', '/auth/login', { body: { email: spec.email, password } }) : null;
        if (login && login.status !== 200 && login.status !== 401) {
          throw new Error(`POST /auth/login for ${spec.email} -> ${login.status}`);
        }
        if ((!login || login.status === 401) && known?.pendingPassword) {
          login = await api.call('POST', '/auth/login', { body: { email: spec.email, password: known.pendingPassword } });
          if (login.status === 200) {
            password = known.pendingPassword;
            delete known.pendingPassword;
          }
        }
        if (!login || login.status !== 200) {
          if (!known?.userId) {
            throw new SeedTestEnvRefusal(
              `${spec.email} already exists but this output file has no record of it. Use the output file from the run that created it, or run seed:cleanup for that batch first.`,
            );
          }
          const pending = known.pendingPassword ?? strongPassword();
          known.pendingPassword = pending;
          if (!newPasswords.some((p) => p.email === spec.email)) newPasswords.push({ email: spec.email, password: pending });
          resets.push({ userId: known.userId, email: spec.email, passwordHash: await hashPassword(pending) });
          continue;
        }
        const user = login.body.user as { id: string; fullName: string; role: string; accountStatus: string };
        if (!user.fullName.endsWith(`(${tag})`)) {
          throw new SeedTestEnvRefusal(`${spec.email} belongs to another seed batch ("${user.fullName}"); clean that batch up first`);
        }
        tokens[spec.key] = login.body.accessToken as string;
        addId(output.createdIds.users, user.id);
        output.accounts[spec.key] = {
          email: spec.email,
          role: spec.role,
          password,
          ...(known?.pendingPassword ? { pendingPassword: known.pendingPassword } : {}),
          userId: user.id,
          companyId: known?.companyId ?? null,
          companyName: spec.company?.legalName ?? null,
          companyVerification: known?.companyVerification ?? null,
          accountStatus: user.accountStatus,
          purpose: spec.purpose,
        };
        if (spec.role === 'admin' && user.role !== 'admin') promote = { userId: user.id, email: spec.email };
        if (spec.activate && user.accountStatus === 'pending_verification') activate.push({ userId: user.id, email: spec.email });
      }
      return { resets, promote, activate };
    };

    let pass = await loginAll();
    save();
    if (pass.resets.length > 0) {
      await sqlStep('00-password-reset', buildPasswordResetSql({ schema, batchId, resets: pass.resets }));
      pass = await loginAll();
    }
    if (pass.promote || pass.activate.length > 0) {
      await sqlStep('01-accounts', buildAccountsSql({ schema, batchId, promoteAdmin: pass.promote, activate: pass.activate }));
      pass = await loginAll(); // fresh tokens carry the promoted role
      if (pass.promote || pass.activate.length > 0 || pass.resets.length > 0) {
        throw new Error('accounts SQL was applied but the accounts are still not ready');
      }
    }
    save();

    // ---- Phase 2: companies (owner creates over HTTP; TEST admin sets verification) ----------
    const adminToken = tokens.admin;
    for (const spec of ACCOUNTS) {
      if (!spec.company) continue;
      const account = output.accounts[spec.key];
      const registrationNumber = `TEST-${batchId}-${spec.company.registrationSuffix}`;
      const mine = await api.call<{ data: Array<{ id: string; registrationNumber: string | null; verificationStatus: Verification }> }>(
        'GET',
        `/companies?type=${spec.role}&pageSize=100`,
        { token: tokens[spec.key], expect: [200] },
      );
      let company = mine.body.data.find((c) => c.registrationNumber === registrationNumber);
      if (!company) {
        const created = await api.call('POST', '/companies', {
          token: tokens[spec.key],
          body: {
            type: spec.role,
            legalName: spec.company.legalName,
            tradingName: `${spec.company.tradingName} (${tag})`,
            registrationNumber,
            countryCode: 'ZW',
            city: spec.company.city,
          },
          expect: [201],
        });
        company = created.body;
        log(`company "${spec.company.legalName}" created via POST /companies`);
      }
      addId(output.createdIds.companies, company!.id);
      if (company!.verificationStatus !== spec.company.verification) {
        const patched = await api.call('PATCH', `/companies/${company!.id}`, {
          token: adminToken,
          body: { verificationStatus: spec.company.verification },
          expect: [200],
        });
        company = patched.body;
        log(`company "${spec.company.legalName}" set to ${spec.company.verification} by the TEST admin via PATCH /companies/{id}`);
      }
      account.companyId = company!.id;
      account.companyVerification = company!.verificationStatus;
    }
    save();

    // ---- Phase 3: sample loads (verified TEST shipper, HTTP) ----------------------------------
    const shipperToken = tokens.shipper;
    const shipperCompanyId = output.accounts.shipper.companyId as string;
    const existingLoads = await api.call<{ data: Array<{ id: string; status: string; specialRequirements: string | null }> }>(
      'GET',
      `/loads?companyId=${shipperCompanyId}&pageSize=100`,
      { token: shipperToken, expect: [200] },
    );
    for (const spec of LOADS) {
      let load = existingLoads.body.data.find((l) => (l.specialRequirements ?? '').startsWith(marker(spec.key)));
      if (!load) {
        const created = await api.call('POST', '/loads', {
          token: shipperToken,
          body: {
            companyId: shipperCompanyId,
            goodsType: spec.goodsType,
            weightKg: spec.weightKg,
            truckTypeRequired: spec.truckTypeRequired,
            pickupAddress: spec.pickupAddress,
            pickupPoint: spec.pickupPoint,
            destinationAddress: spec.destinationAddress,
            destinationPoint: spec.destinationPoint,
            loadingDate: addDays(spec.loadingInDays),
            deliveryDeadline: addDays(spec.deadlineInDays),
            specialRequirements: `${marker(spec.key)} TEST ${tag}. ${spec.specialRequirements}`,
            rateType: spec.rateType,
            ...(spec.offeredRateMinor ? { offeredRate: { amountMinor: spec.offeredRateMinor, currency: 'USD' } } : {}),
            currency: 'USD',
          },
          expect: [201],
        });
        load = created.body;
        log(`load ${spec.key} created via POST /loads`);
      }
      addId(output.createdIds.loads, load!.id);
      if (load!.status === 'draft' && (spec.target === 'posted' || spec.target === 'cancelled')) {
        load = (await api.call('POST', `/loads/${load!.id}/post`, { token: shipperToken, idempotencyKey: `seed-post-${load!.id}`, expect: [200] })).body;
      }
      if (spec.target === 'cancelled' && load!.status !== 'cancelled') {
        load = (
          await api.call('POST', `/loads/${load!.id}/cancel`, {
            token: shipperToken,
            idempotencyKey: `seed-cancel-${load!.id}`,
            body: { reason: `TEST ${tag}: cancelled example` },
            expect: [200],
          })
        ).body;
      }
      output.loads[spec.key] = { id: load!.id, status: load!.status, route: `${spec.pickupAddress} -> ${spec.destinationAddress}` };
    }
    save();

    // ---- Phase 4: off-platform ban scenario --------------------------------------------------
    const ids = banScenarioIds(batchId);
    const banned = output.accounts.shipper_banned;
    const reporter = output.accounts.transporter;
    const admin = output.accounts.admin;
    const recordBan = async (via: string): Promise<boolean> => {
      const reports = await api.call<{ data: Array<{ id: string; finding?: { id: string; bans: Array<{ id: string }> } | null }> }>(
        'GET',
        `/admin/off-platform-reports?bookingId=${ids.bookingId}`,
        { token: adminToken, expect: [200] },
      );
      const report = reports.body.data[0];
      if (!report?.finding || report.finding.bans.length === 0) return false;
      addId(output.createdIds.offPlatformReports, report.id);
      addId(output.createdIds.offPlatformFindings, report.finding.id);
      for (const ban of report.finding.bans) addId(output.createdIds.offPlatformBans, ban.id);
      output.banScenario = {
        bookingId: ids.bookingId,
        reportId: report.id,
        findingId: report.finding.id,
        banIds: report.finding.bans.map((b) => b.id),
        via: output.banScenario?.via ?? via,
      };
      return true;
    };
    const viaBefore = previous?.pendingSql?.some((f) => f.endsWith('-02-ban.sql')) ? 'sql' : 'existing';
    if (await recordBan(viaBefore)) {
      log('ban scenario already present');
    } else {
      const fixtureFile = mode.production ? undefined : process.env.SEED_BOOKING_FIXTURES_FILE?.trim();
      let viaHttp = false;
      if (fixtureFile) {
        const current = existsSync(fixtureFile) ? (JSON.parse(readFileSync(fixtureFile, 'utf8')) as Array<Record<string, unknown>>) : [];
        if (!current.some((b) => b.bookingId === ids.bookingId)) {
          current.push({
            bookingId: ids.bookingId,
            loadId: output.loads['hre-byo-fertiliser'].id,
            status: 'confirmed',
            shipperCompanyId: banned.companyId,
            transporterCompanyId: reporter.companyId,
          });
          writeFileSync(fixtureFile, `${JSON.stringify(current, null, 2)}\n`);
        }
        const report = await api.call('POST', `/bookings/${ids.bookingId}/off-platform-reports`, {
          token: tokens.transporter,
          idempotencyKey: `seed-report-${ids.bookingId}`,
          body: { suspectedParty: 'shipper', description: `TEST ${tag}: shipper asked to settle in cash outside Truber after the booking was confirmed.` },
        });
        if (report.status === 201) {
          await api.call('POST', `/admin/off-platform-reports/${report.body.id}/finding`, {
            token: adminToken,
            idempotencyKey: `seed-finding-${report.body.id}`,
            body: {
              outcome: 'confirmed',
              reason: `TEST ${tag}: confirmed for testing the 14-day ban.`,
              responsibleParties: [{ role: 'shipper', userId: banned.userId, companyId: banned.companyId }],
            },
            expect: [201, 200],
          });
          viaHttp = await recordBan('http');
          log('ban scenario created via HTTP (report by TEST transporter, confirmed finding by TEST admin)');
        } else {
          log(`booking fixture not visible to the API (report -> ${report.status}); using SQL`);
        }
      }
      if (!viaHttp) {
        await sqlStep(
          '02-ban',
          buildBanSql({
            schema,
            batchId,
            ids,
            reporter: { userId: reporter.userId, email: reporter.email },
            admin: { userId: admin.userId, email: admin.email },
            banned: { userId: banned.userId, email: banned.email, companyId: banned.companyId as string },
          }),
        );
        if (!(await recordBan('sql'))) throw new Error('ban SQL was applied but the API does not show the ban');
      }
    }

    output.pendingSql = [];
    save();
    log(`done; wrote ${outFile} (gitignored; contains test passwords)`);
    printSummary(output, newPasswords);
  } catch (error) {
    if (error instanceof NeedsSql) {
      save();
      printSummary(output, newPasswords);
      process.stdout.write(
        [
          '',
          'ACTION NEEDED (nothing is wrong): this step has no API endpoint.',
          `  1. Review and run this SQL file against the target database (e.g. Supabase MCP execute_sql):`,
          `       ${error.file}`,
          '  2. Rerun the same seed command. It continues from where it stopped.',
          `Progress and passwords so far are saved in ${outFile}.`,
          '',
        ].join('\n'),
      );
      process.exitCode = EXIT_NEEDS_SQL;
      return;
    }
    save();
    throw error;
  } finally {
    await pool?.end();
  }
}

function printSummary(output: SeedOutput, newPasswords: Array<{ email: string; password: string }>): void {
  process.stdout.write(`\nTEST ACCOUNTS (batch ${output.batchId})\n`);
  for (const a of Object.values(output.accounts)) {
    process.stdout.write(`  ${a.role.padEnd(11)} ${a.email.padEnd(40)} status=${a.accountStatus} company=${a.companyVerification ?? '-'}\n`);
  }
  if (newPasswords.length > 0) {
    process.stdout.write('\nNEW PASSWORDS (shown once; also in the output file)\n');
    for (const p of newPasswords) process.stdout.write(`  ${p.email}  ${p.password}\n`);
  } else {
    process.stdout.write('\nNo passwords changed on this run; existing ones are in the output file.\n');
  }
}

function log(message: string): void {
  process.stdout.write(`[seed:test] ${message}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[seed:test] ${message}\n`);
    process.exit(1);
  });
}
