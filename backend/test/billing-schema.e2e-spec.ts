import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { qualifyAppSql } from '../src/db/identifiers';
import { buildPoolConfig } from '../src/db/pg-config';
import { truncate } from './helpers';
import { prepareTestDatabase } from './prepare-db';

describe('billing schema constraints', () => {
  const env = loadEnv();
  let pool: Pool;
  let userId: string;
  let companyId: string;

  const sql = (text: string): string =>
    qualifyAppSql(text, { appSchema: env.db.DB_SCHEMA, postgisSchema: env.db.POSTGIS_SCHEMA });

  async function insertUser(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      sql(
        `INSERT INTO users (id, email, password_hash, full_name, role, account_status, created_at, updated_at)
         VALUES ($1, $2, 'test-hash', 'Billing Test', 'admin', 'active', now(), now())`,
      ),
      [id, `${id}@example.com`],
    );
    return id;
  }

  async function insertCompany(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      sql(
        `INSERT INTO companies (id, type, legal_name, verification_status, created_at, updated_at)
         VALUES ($1, 'transporter', 'Billing Carrier', 'verified', now(), now())`,
      ),
      [id],
    );
    return id;
  }

  async function insertReceivable(input: {
    bookingId: string;
    amountMinor: number;
    collectedMinor: number;
    remainingMinor: number;
    status: string;
    voidedAt?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      sql(
        `INSERT INTO commission_receivables (
           id, booking_id, transporter_company_id, currency, amount_minor, collected_minor,
           remaining_minor, status, payment_method, recognised_at, voided_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'USD', $4, $5, $6, $7, 'prepay', now(), $8, now(), now())`,
      ),
      [
        id,
        input.bookingId,
        companyId,
        input.amountMinor,
        input.collectedMinor,
        input.remainingMinor,
        input.status,
        input.voidedAt ?? null,
      ],
    );
    return id;
  }

  beforeAll(async () => {
    await prepareTestDatabase();
    pool = new Pool(buildPoolConfig(env.db, 'migration'));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate();
    userId = await insertUser();
    companyId = await insertCompany();
  });

  it('rejects an open receivable whose collected plus remaining does not equal the amount', async () => {
    await expect(
      insertReceivable({
        bookingId: randomUUID(),
        amountMinor: 1000,
        collectedMinor: 0,
        remainingMinor: 900,
        status: 'open',
      }),
    ).rejects.toThrow(/commission_receivables_open_balance_check/);
  });

  it('rejects changing the immutable financial terms of a receivable', async () => {
    const receivableId = await insertReceivable({
      bookingId: randomUUID(),
      amountMinor: 1000,
      collectedMinor: 0,
      remainingMinor: 1000,
      status: 'open',
    });

    await expect(
      pool.query(
        sql(
          `UPDATE commission_receivables
           SET amount_minor = 2000, remaining_minor = 2000
           WHERE id = $1`,
        ),
        [receivableId],
      ),
    ).rejects.toThrow(/commission receivable financial terms are immutable/);
  });

  it('defaults commission_rate_bps to 500 when omitted', async () => {
    const receivableId = await insertReceivable({
      bookingId: randomUUID(),
      amountMinor: 1000,
      collectedMinor: 0,
      remainingMinor: 1000,
      status: 'open',
    });

    const result = await pool.query<{ commission_rate_bps: number }>(
      sql(`SELECT commission_rate_bps FROM commission_receivables WHERE id = $1`),
      [receivableId],
    );
    expect(result.rows[0].commission_rate_bps).toBe(500);
  });

  it('rejects a commission rate other than the fixed MVP rate', async () => {
    await expect(
      pool.query(
        sql(
          `INSERT INTO commission_receivables (
             id, booking_id, transporter_company_id, currency, amount_minor, collected_minor,
             remaining_minor, status, payment_method, commission_rate_bps, recognised_at,
             created_at, updated_at
           ) VALUES ($1, $2, $3, 'USD', 1000, 0, 1000, 'open', 'prepay', 400, now(), now(), now())`,
        ),
        [randomUUID(), randomUUID(), companyId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'commission_receivables_rate_bps_check',
    });
  });

  it('rejects changing commission_rate_bps on a receivable', async () => {
    const receivableId = await insertReceivable({
      bookingId: randomUUID(),
      amountMinor: 1000,
      collectedMinor: 0,
      remainingMinor: 1000,
      status: 'open',
    });

    await expect(
      pool.query(
        sql(
          `UPDATE commission_receivables
           SET commission_rate_bps = 400
           WHERE id = $1`,
        ),
        [receivableId],
      ),
    ).rejects.toThrow(/commission receivable financial terms are immutable/);
  });

  it('rejects a commission receivable without a payment method', async () => {
    await expect(
      pool.query(
        sql(
          `INSERT INTO commission_receivables (
             id, booking_id, transporter_company_id, currency, amount_minor, collected_minor,
             remaining_minor, status, payment_method, recognised_at, created_at, updated_at
           ) VALUES ($1, $2, $3, 'USD', 1000, 0, 1000, 'open', NULL, now(), now(), now())`,
        ),
        [randomUUID(), randomUUID(), companyId],
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('hardens the receivable immutability trigger function', async () => {
    const result = await pool.query<{
      proconfig: string[] | null;
      can_execute: boolean;
    }>(
      `SELECT p.proconfig,
              has_function_privilege('public', format('%I.%I()', n.nspname, p.proname), 'EXECUTE') AS can_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
          AND p.proname = 'billing_receivable_immutable'`,
      [env.db.DB_SCHEMA],
    );
    const row = result.rows[0];
    expect(row).toBeDefined();
    expect(row.proconfig ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/^search_path=(?:""|'')$/)]),
    );
    expect(row.can_execute).toBe(false);
  });

  it('allows only one non-voided receivable per booking', async () => {
    const bookingId = randomUUID();
    await insertReceivable({
      bookingId,
      amountMinor: 1000,
      collectedMinor: 0,
      remainingMinor: 1000,
      status: 'open',
    });

    await expect(
      insertReceivable({
        bookingId,
        amountMinor: 1000,
        collectedMinor: 1000,
        remainingMinor: 0,
        status: 'collected',
      }),
    ).rejects.toThrow(/commission_receivables_booking_uidx/);

    await expect(
      insertReceivable({
        bookingId,
        amountMinor: 1000,
        collectedMinor: 0,
        remainingMinor: 0,
        status: 'voided',
        voidedAt: new Date().toISOString(),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a payout that claims Truber moved the funds', async () => {
    const arrangementId = randomUUID();
    const bookingId = randomUUID();
    await pool.query(
      sql(
        `INSERT INTO payment_arrangements (
           id, booking_id, method, arrangement_status, protection_status, release_status,
           currency, total_minor, confirmed_at, confirmed_by, created_at, updated_at
         ) VALUES ($1, $2, 'prepay', 'confirmed', 'none', 'not_applicable', 'USD', 1000, now(), $3, now(), now())`,
      ),
      [arrangementId, bookingId, userId],
    );

    await expect(
      pool.query(
        sql(
          `INSERT INTO payouts (
             id, arrangement_id, booking_id, currency, trip_minor, commission_minor,
             fees_minor, net_minor, status, funds_movement_claimed_by_truber, created_at, updated_at
           ) VALUES ($1, $2, $3, 'USD', 1000, 50, 0, 950, 'recorded', true, now(), now())`,
        ),
        [randomUUID(), arrangementId, bookingId],
      ),
    ).rejects.toThrow(/payouts_funds_movement_check/);
  });

  it('rejects a cash arrangement that claims payment protection', async () => {
    await expect(
      pool.query(
        sql(
          `INSERT INTO payment_arrangements (
             id, booking_id, method, arrangement_status, protection_status, release_status,
             currency, total_minor, created_at, updated_at
           ) VALUES ($1, $2, 'cash', 'proposed', 'protected', 'not_applicable', 'USD', 1000, now(), now())`,
        ),
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/payment_arrangements_cash_protection_check/);
  });
});
