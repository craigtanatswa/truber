/*
 * Test-environment seed for hands-on product testing (NOT for production).
 *
 * Creates clearly fake shipper, transporter and admin accounts, companies in
 * several verification states, sample loads, and one off-platform ban scenario.
 * Data goes through the real HTTP API wherever an endpoint exists; SQL is used
 * only where the API has no endpoint (admin provisioning, reading a dev OTP from
 * delivery_outbox, an expired-password reset on rerun, and the ban scenario when
 * no dev booking fixture is available).
 *
 * Idempotent: rerunning finds existing accounts, companies and loads (loads are
 * matched by a [TEST-SEED:<key>] marker) and only fills in what is missing.
 *
 * Required env:
 *   SEED_TEST_ENV=yes        explicit opt-in
 *   SEED_API_URL             base URL of the running API (e.g. http://127.0.0.1:3108)
 *   DATABASE_URL (+ usual DB_* settings, same as the API) for SQL fallbacks
 * Optional env:
 *   SEED_OUTPUT_FILE         defaults to backend/.seed-output.json (gitignored)
 *   TEST_OTP_CODE            if the API runs with the test OTP code, the seed uses it
 *   SEED_BOOKING_FIXTURES_FILE  JSON file the API reads via DEV_BOOKING_FIXTURES_FILE;
 *                            when set, the ban scenario goes through the HTTP API.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Pool, PoolClient } from 'pg';
import { hashPassword } from '../src/common/crypto';
import { Env, loadEnv } from '../src/config/env';
import { qualifyAppSql } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { loadDotEnv } from '../src/load-dotenv';

export const PRODUCTION_PROJECT_REF = 'nvejijeprejhtbsarehz';

export class SeedTestEnvRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedTestEnvRefusal';
  }
}

/** Pure guard, unit-tested. Throws SeedTestEnvRefusal when seeding is not allowed. */
export function assertSeedTestEnvAllowed(source: NodeJS.ProcessEnv): void {
  if ((source.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new SeedTestEnvRefusal('Refusing to seed: NODE_ENV=production');
  }
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'SEED_API_URL']) {
    if ((source[key] ?? '').toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      throw new SeedTestEnvRefusal(`Refusing to seed: ${key} points at the production Supabase project`);
    }
  }
  if (source.SEED_TEST_ENV !== 'yes') {
    throw new SeedTestEnvRefusal('Refusing to seed: set SEED_TEST_ENV=yes to confirm this is a test environment');
  }
  if (!source.SEED_API_URL || !/^https?:\/\/\S+$/.test(source.SEED_API_URL)) {
    throw new SeedTestEnvRefusal('Refusing to seed: SEED_API_URL must be the http(s) base URL of the running test API');
  }
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
  company?: { legalName: string; tradingName: string; registrationNumber: string; city: string; verification: Verification };
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
      registrationNumber: 'TEST-REG-0001',
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
      registrationNumber: 'TEST-REG-0002',
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
      registrationNumber: 'TEST-REG-0003',
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
      registrationNumber: 'TEST-REG-0004',
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
      registrationNumber: 'TEST-REG-0005',
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

/** Fixed id for the fake booking that anchors the ban scenario (no bookings table exists yet). */
export const BAN_SCENARIO_BOOKING_ID = 'b0a1e5ed-7e57-4000-8000-000000000001';
const BAN_SCENARIO_LOAD_ID = 'b0a1e5ed-7e57-4000-8000-000000000002';

interface SeedOutputAccount {
  email: string;
  role: Role;
  password: string;
  userId: string;
  companyId: string | null;
  companyName: string | null;
  companyVerification: Verification | null;
  accountStatus: string;
  purpose: string;
}

interface SeedOutput {
  generatedAt: string;
  apiUrl: string;
  accounts: Record<string, SeedOutputAccount>;
  loads: Record<string, { id: string; status: string; route: string }>;
  banScenario: { bookingId: string; reportId: string | null; banIds: string[]; via: string } | null;
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

function strongPassword(): string {
  // 24 url-safe chars plus a fixed suffix so every class is present.
  return `${randomBytes(18).toString('base64url')}-Tt9`;
}

function addDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function marker(key: string): string {
  return `[TEST-SEED:${key}]`;
}

async function main(): Promise<void> {
  loadDotEnv();
  assertSeedTestEnvAllowed(process.env);
  const env: Env = loadEnv(process.env, { purpose: 'api' });
  const apiUrl = process.env.SEED_API_URL as string;
  const api = new Api(apiUrl);
  const outFile = resolve(process.env.SEED_OUTPUT_FILE ?? resolve(__dirname, '..', '.seed-output.json'));
  const previous: SeedOutput | null = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')) as SeedOutput) : null;
  const pool = new Pool(buildPoolConfig(env.db, 'runtime'));
  const layout = { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA };
  const q = (client: Pool | PoolClient, sql: string, params: unknown[] = []) => client.query(qualifyAppSql(sql, layout), params);
  const testOtp = process.env.TEST_OTP_CODE?.trim() || null;
  const newPasswords: Array<{ email: string; password: string }> = [];
  const output: SeedOutput = { generatedAt: new Date().toISOString(), apiUrl, accounts: {}, loads: {}, banScenario: null };

  log(`seeding via API ${apiUrl}`);

  try {
    const tokens: Record<string, string> = {};

    // 1. Admin first: there is no public admin sign-up, so provision via SQL (same as the existing dev seed).
    for (const spec of ACCOUNTS) {
      const existing = await q(pool, 'SELECT id, role, account_status FROM users WHERE email = $1', [spec.email]);
      let password = previous?.accounts?.[spec.key]?.password ?? null;
      let row = existing.rows[0] as { id: string; role: Role; account_status: string } | undefined;
      if (row && row.role !== spec.role) {
        throw new Error(`Refusing: ${spec.email} exists with role ${row.role}, expected ${spec.role}`);
      }
      if (!row) {
        password = strongPassword();
        newPasswords.push({ email: spec.email, password });
        if (spec.role === 'admin') {
          const id = randomUUID();
          await q(
            pool,
            `INSERT INTO users (id, email, password_hash, full_name, phone, city, role, account_status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'admin', 'active', clock_timestamp(), clock_timestamp())`,
            [id, spec.email, await hashPassword(password), spec.fullName, spec.phone, spec.city],
          );
          log(`admin ${spec.email} provisioned via SQL (no admin sign-up endpoint)`);
        } else {
          await api.call('POST', '/auth/register', {
            body: { email: spec.email, password, fullName: spec.fullName, phone: spec.phone, city: spec.city, role: spec.role },
            expect: [201],
          });
          log(`${spec.role} ${spec.email} registered via POST /auth/register`);
        }
      }
      // Log in over HTTP; if the stored password no longer works (output file lost), rotate it via SQL once.
      let login = password
        ? await api.call('POST', '/auth/login', { body: { email: spec.email, password } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON in a test-only script
        : { status: 401, body: null as any };
      if (login.status !== 200 && login.status !== 401) {
        throw new Error(`POST /auth/login for ${spec.email} -> ${login.status}`);
      }
      if (login.status === 401) {
        password = strongPassword();
        newPasswords.push({ email: spec.email, password });
        await q(pool, 'UPDATE users SET password_hash = $2, updated_at = clock_timestamp() WHERE email = $1', [
          spec.email,
          await hashPassword(password),
        ]);
        log(`${spec.email}: previous password unknown, set a new test password via SQL`);
        login = await api.call('POST', '/auth/login', { body: { email: spec.email, password }, expect: [200] });
      }
      tokens[spec.key] = login.body.accessToken;
      row = { id: login.body.user.id, role: spec.role, account_status: login.body.user.accountStatus };

      // 2. Phone/OTP verification over HTTP (request + verify). The code comes from TEST_OTP_CODE
      //    if the API has it, otherwise from the dev delivery outbox (DELIVERY_ADAPTER=dev).
      if (spec.activate && row.account_status === 'pending_verification') {
        await api.call('POST', '/auth/otp/request', { token: tokens[spec.key], body: { channel: 'sms' }, expect: [202, 200] });
        let code = testOtp;
        if (!code) {
          const staged = await q(
            pool,
            `SELECT payload FROM delivery_outbox WHERE user_id = $1 AND kind = 'otp' ORDER BY created_at DESC LIMIT 1`,
            [row.id],
          );
          code = (staged.rows[0]?.payload as string | undefined) ?? null;
        }
        if (code) {
          const verified = await api.call('POST', '/auth/otp/verify', { token: tokens[spec.key], body: { code }, expect: [200] });
          row.account_status = verified.body.accountStatus;
          log(`${spec.email} phone verified via POST /auth/otp/verify`);
        } else {
          await q(pool, `UPDATE users SET account_status = 'active', updated_at = clock_timestamp() WHERE id = $1 AND account_status = 'pending_verification'`, [row.id]);
          row.account_status = 'active';
          log(`${spec.email}: no OTP code obtainable (delivery disabled, no TEST_OTP_CODE); activated via SQL`);
        }
      }

      output.accounts[spec.key] = {
        email: spec.email,
        role: spec.role,
        password: password as string,
        userId: row.id,
        companyId: null,
        companyName: spec.company?.legalName ?? null,
        companyVerification: null,
        accountStatus: row.account_status,
        purpose: spec.purpose,
      };
    }

    // 3. Companies over HTTP (owner creates; admin sets verification via PATCH /companies/{id}).
    const adminToken = tokens.admin;
    for (const spec of ACCOUNTS) {
      if (!spec.company) continue;
      const mine = await api.call<{ data: Array<{ id: string; legalName: string; verificationStatus: Verification }> }>(
        'GET',
        `/companies?type=${spec.role}&pageSize=100`,
        { token: tokens[spec.key], expect: [200] },
      );
      let company = mine.body.data.find((c) => c.legalName === spec.company!.legalName);
      if (!company) {
        const created = await api.call('POST', '/companies', {
          token: tokens[spec.key],
          body: {
            type: spec.role,
            legalName: spec.company.legalName,
            tradingName: spec.company.tradingName,
            registrationNumber: spec.company.registrationNumber,
            countryCode: 'ZW',
            city: spec.company.city,
          },
          expect: [201],
        });
        company = created.body;
        log(`company "${spec.company.legalName}" created via POST /companies`);
      }
      if (company!.verificationStatus !== spec.company.verification) {
        const patched = await api.call('PATCH', `/companies/${company!.id}`, {
          token: adminToken,
          body: { verificationStatus: spec.company.verification },
          expect: [200],
        });
        company = patched.body;
        log(`company "${spec.company.legalName}" set to ${spec.company.verification} by admin via PATCH /companies/{id}`);
      }
      output.accounts[spec.key].companyId = company!.id;
      output.accounts[spec.key].companyVerification = company!.verificationStatus;
    }

    // 4. Sample loads for the verified shipper, over HTTP.
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
            specialRequirements: `${marker(spec.key)} ${spec.specialRequirements}`,
            rateType: spec.rateType,
            ...(spec.offeredRateMinor ? { offeredRate: { amountMinor: spec.offeredRateMinor, currency: 'USD' } } : {}),
            currency: 'USD',
          },
          expect: [201],
        });
        load = created.body;
        log(`load ${spec.key} created via POST /loads`);
      }
      if (load!.status === 'draft' && (spec.target === 'posted' || spec.target === 'cancelled')) {
        const posted = await api.call('POST', `/loads/${load!.id}/post`, {
          token: shipperToken,
          idempotencyKey: `seed-post-${load!.id}`,
          expect: [200],
        });
        load = posted.body;
      }
      if (spec.target === 'cancelled' && load!.status !== 'cancelled') {
        const cancelled = await api.call('POST', `/loads/${load!.id}/cancel`, {
          token: shipperToken,
          idempotencyKey: `seed-cancel-${load!.id}`,
          body: { reason: 'TEST seed: cancelled example' },
          expect: [200],
        });
        load = cancelled.body;
      }
      output.loads[spec.key] = {
        id: load!.id,
        status: load!.status,
        route: `${spec.pickupAddress} -> ${spec.destinationAddress}`,
      };
    }

    // 5. Off-platform ban scenario: banned shipper + verified transporter on a fake booking.
    output.banScenario = await seedBanScenario({
      api,
      pool,
      q,
      adminToken,
      transporterToken: tokens.transporter,
      banned: output.accounts.shipper_banned,
      transporter: output.accounts.transporter,
    });

    writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    log(`wrote ${outFile} (gitignored; contains test passwords)`);
    process.stdout.write('\nTEST ACCOUNTS\n');
    for (const account of Object.values(output.accounts)) {
      process.stdout.write(
        `  ${account.role.padEnd(11)} ${account.email.padEnd(40)} status=${account.accountStatus} company=${account.companyVerification ?? '-'}\n`,
      );
    }
    if (newPasswords.length > 0) {
      process.stdout.write('\nNEW PASSWORDS (shown once; also in the output file)\n');
      for (const entry of newPasswords) process.stdout.write(`  ${entry.email}  ${entry.password}\n`);
    } else {
      process.stdout.write('\nNo passwords changed on this run; existing ones are in the output file.\n');
    }
  } finally {
    await pool.end();
  }
}

async function seedBanScenario(input: {
  api: Api;
  pool: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON in a test-only script
  q: (client: Pool | PoolClient, sql: string, params?: unknown[]) => Promise<any>;
  adminToken: string;
  transporterToken: string;
  banned: SeedOutputAccount;
  transporter: SeedOutputAccount;
}): Promise<SeedOutput['banScenario']> {
  const { api, pool, q, banned, transporter } = input;
  const fixtureFile = process.env.SEED_BOOKING_FIXTURES_FILE?.trim();
  if (fixtureFile) {
    const current: Array<Record<string, unknown>> = existsSync(fixtureFile)
      ? (JSON.parse(readFileSync(fixtureFile, 'utf8')) as Array<Record<string, unknown>>)
      : [];
    if (!current.some((b) => b.bookingId === BAN_SCENARIO_BOOKING_ID)) {
      current.push({
        bookingId: BAN_SCENARIO_BOOKING_ID,
        loadId: BAN_SCENARIO_LOAD_ID,
        status: 'confirmed',
        shipperCompanyId: banned.companyId,
        transporterCompanyId: transporter.companyId,
      });
      writeFileSync(fixtureFile, `${JSON.stringify(current, null, 2)}\n`);
    }
  }

  const existing = await q(pool, 'SELECT id, status FROM off_platform_reports WHERE booking_id = $1 ORDER BY created_at LIMIT 1', [
    BAN_SCENARIO_BOOKING_ID,
  ]);
  if (existing.rows[0]) {
    const bans = await q(pool, 'SELECT b.id FROM off_platform_bans b JOIN off_platform_findings f ON f.id = b.finding_id WHERE f.report_id = $1', [
      existing.rows[0].id,
    ]);
    log('ban scenario already present');
    return { bookingId: BAN_SCENARIO_BOOKING_ID, reportId: existing.rows[0].id, banIds: bans.rows.map((r: { id: string }) => r.id), via: 'existing' };
  }

  const reportBody = {
    suspectedParty: 'shipper',
    description: 'TEST seed: shipper asked to settle in cash outside Truber after the booking was confirmed.',
  };
  if (fixtureFile) {
    const report = await api.call('POST', `/bookings/${BAN_SCENARIO_BOOKING_ID}/off-platform-reports`, {
      token: input.transporterToken,
      idempotencyKey: `seed-report-${BAN_SCENARIO_BOOKING_ID}`,
      body: reportBody,
    });
    if (report.status === 201) {
      const finding = await api.call('POST', `/admin/off-platform-reports/${report.body.id}/finding`, {
        token: input.adminToken,
        idempotencyKey: `seed-finding-${report.body.id}`,
        body: {
          outcome: 'confirmed',
          reason: 'TEST seed: confirmed for testing the 14-day ban.',
          responsibleParties: [{ role: 'shipper', userId: banned.userId, companyId: banned.companyId }],
        },
        expect: [201, 200],
      });
      const bans = (finding.body?.bans ?? []) as Array<{ id: string }>;
      log('ban scenario created via HTTP (report by transporter, confirmed finding by admin)');
      return { bookingId: BAN_SCENARIO_BOOKING_ID, reportId: report.body.id, banIds: bans.map((b) => b.id), via: 'http' };
    }
    log(`booking fixture not visible to the API (report -> ${report.status}); falling back to SQL`);
  }

  // SQL fallback: no bookings domain exists, so mirror what the report + finding + ban services write.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reportId = randomUUID();
    const findingId = randomUUID();
    const banId = randomUUID();
    await q(
      client,
      `INSERT INTO off_platform_reports (id, booking_id, reported_by_user_id, reporter_role, suspected_party, description, evidence_uris, status, created_at)
       VALUES ($1, $2, $3, 'transporter', 'shipper', $4, '[]'::jsonb, 'confirmed', clock_timestamp())`,
      [reportId, BAN_SCENARIO_BOOKING_ID, transporter.userId, reportBody.description],
    );
    const adminRow = await q(client, `SELECT id FROM users WHERE email = 'test.admin@example.com'`);
    const adminId = adminRow.rows[0].id as string;
    await q(
      client,
      `INSERT INTO off_platform_findings (id, report_id, booking_id, outcome, reason, responsible_parties, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, $3, 'confirmed', $4, $5::jsonb, $6, clock_timestamp())`,
      [
        findingId,
        reportId,
        BAN_SCENARIO_BOOKING_ID,
        'TEST seed: confirmed for testing the 14-day ban.',
        JSON.stringify([{ role: 'shipper', userId: banned.userId, companyId: banned.companyId }]),
        adminId,
      ],
    );
    await q(
      client,
      `INSERT INTO off_platform_bans (id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at, duration_days, applied_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, 'shipper', $5, date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', clock_timestamp()) + interval '336 hours', 14, $6, clock_timestamp())`,
      [banId, findingId, banned.userId, banned.companyId, 'TEST seed: confirmed for testing the 14-day ban.', adminId],
    );
    await client.query('COMMIT');
    log('ban scenario created via SQL fallback (no bookings endpoint/fixture available)');
    return { bookingId: BAN_SCENARIO_BOOKING_ID, reportId, banIds: [banId], via: 'sql' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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
