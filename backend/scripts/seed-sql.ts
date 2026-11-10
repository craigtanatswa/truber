/*
 * Pure SQL builders for the test-environment seed and its cleanup.
 *
 * Every statement is scoped twice: by the exact ids recorded for one seed batch,
 * AND by the test markers every seeded row carries (TEST names, @example.com
 * emails, "seed <batchId>" tags). Nothing here connects to a database; the seed
 * either applies the text with a local test connection or writes it to a file
 * for an operator to run (for example through the Supabase MCP).
 */
import { createHash } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BATCH_RE = /^[a-z0-9][a-z0-9-]{3,39}$/;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const EMAIL_RE = /^[a-z0-9._+-]+@example\.com$/;

export function assertBatchId(batchId: string): string {
  if (!BATCH_RE.test(batchId)) {
    throw new Error('seed batch id must be 4-40 chars of lowercase letters, digits and dashes');
  }
  return batchId;
}

export function assertSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error('SQL schema must be a lowercase identifier');
  }
  return schema;
}

export function uuidLit(id: string): string {
  if (!UUID_RE.test(id)) throw new Error(`not a uuid: ${id}`);
  return `'${id}'::uuid`;
}

export function uuidArray(ids: readonly string[]): string {
  if (ids.length === 0) return `ARRAY[]::uuid[]`;
  return `ARRAY[${ids.map((id) => uuidLit(id)).join(', ')}]`;
}

export function str(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function emailLit(email: string): string {
  if (!EMAIL_RE.test(email)) throw new Error(`seed emails must be @example.com: ${email}`);
  return str(email);
}

/** Tag placed in every seeded user name, company number/trading name, load and off-platform text. */
export function batchTag(batchId: string): string {
  return `seed ${assertBatchId(batchId)}`;
}

/** Deterministic UUID (v4 layout) for a batch-scoped row, so emitted SQL is idempotent. */
export function batchUuid(batchId: string, label: string): string {
  const hex = createHash('sha256').update(`truber-test-seed:${assertBatchId(batchId)}:${label}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** SQL predicate: the users row carries every TEST marker for this batch. */
function userMarkers(alias: string, batchId: string): string {
  return `${alias}.email LIKE '%@example.com' AND ${alias}.full_name LIKE 'TEST %' AND ${alias}.full_name LIKE ${str(`%(${batchTag(batchId)})`)}`;
}

function companyMarkers(alias: string, batchId: string): string {
  return `${alias}.legal_name LIKE 'TEST %' AND ${alias}.registration_number LIKE ${str(`TEST-${batchId}-%`)}`;
}

function header(title: string, batchId: string, schema: string): string {
  return [
    `-- Truber TEST seed, batch ${batchId}: ${title}`,
    `-- Schema: ${schema}. Generated ${new Date().toISOString()}.`,
    '-- Idempotent: safe to run more than once. Touches only rows listed below by id',
    '-- that ALSO carry the TEST markers (TEST name, @example.com email, batch tag).',
    '',
  ].join('\n');
}

export interface SeedUserRef {
  userId: string;
  email: string;
}

/** Run-1 SQL: promote the TEST admin and mark selected TEST users phone-verified. */
export function buildAccountsSql(input: {
  schema: string;
  batchId: string;
  promoteAdmin: SeedUserRef | null;
  activate: SeedUserRef[];
}): string {
  const s = assertSchema(input.schema);
  const lines = [header('promote TEST admin, mark seeded TEST users phone-verified', input.batchId, s), 'BEGIN;', ''];
  const all: SeedUserRef[] = [];
  if (input.promoteAdmin) {
    const a = input.promoteAdmin;
    all.push(a);
    lines.push(
      `-- The API has no admin sign-up: ${a.email} registered as a shipper and is promoted here.`,
      `UPDATE ${s}.users u SET role = 'admin', account_status = 'active', updated_at = clock_timestamp()`,
      `WHERE u.id = ${uuidLit(a.userId)} AND u.email = ${emailLit(a.email)}`,
      `  AND ${userMarkers('u', input.batchId)}`,
      `  AND u.role IN ('shipper', 'admin')`,
      `  AND NOT EXISTS (SELECT 1 FROM ${s}.company_members m WHERE m.user_id = u.id);`,
      '',
    );
  }
  if (input.activate.length > 0) {
    all.push(...input.activate);
    lines.push(
      '-- SMS codes are switched off, so seeded TEST users are marked phone-verified directly.',
      `UPDATE ${s}.users u SET account_status = 'active', updated_at = clock_timestamp()`,
      `WHERE u.id = ANY(${uuidArray(input.activate.map((u) => u.userId))})`,
      `  AND u.email = ANY(ARRAY[${input.activate.map((u) => emailLit(u.email)).join(', ')}])`,
      `  AND ${userMarkers('u', input.batchId)}`,
      `  AND u.account_status = 'pending_verification';`,
      '',
    );
  }
  lines.push(
    'COMMIT;',
    '',
    '-- Check: expect the admin with role admin, and every listed user active.',
    `SELECT u.email, u.role, u.account_status FROM ${s}.users u WHERE u.id = ANY(${uuidArray([...new Set(all.map((u) => u.userId))])}) ORDER BY u.email;`,
    '',
  );
  return lines.join('\n');
}

/** Recovery SQL when a seeded TEST user's password is unknown (output file lost). Carries a hash, never a password. */
export function buildPasswordResetSql(input: {
  schema: string;
  batchId: string;
  resets: Array<SeedUserRef & { passwordHash: string }>;
}): string {
  const s = assertSchema(input.schema);
  const lines = [header('reset passwords of seeded TEST users (hash only)', input.batchId, s), 'BEGIN;', ''];
  for (const r of input.resets) {
    if (!/^scrypt\$[A-Za-z0-9$_-]+$/.test(r.passwordHash)) throw new Error('unexpected password hash format');
    lines.push(
      `UPDATE ${s}.users u SET password_hash = ${str(r.passwordHash)}, updated_at = clock_timestamp()`,
      `WHERE u.id = ${uuidLit(r.userId)} AND u.email = ${emailLit(r.email)} AND ${userMarkers('u', input.batchId)};`,
      '',
    );
  }
  lines.push(
    'COMMIT;',
    '',
    `SELECT u.email, u.updated_at FROM ${s}.users u WHERE u.id = ANY(${uuidArray(input.resets.map((r) => r.userId))}) ORDER BY u.email;`,
    '',
  );
  return lines.join('\n');
}

export interface BanScenarioIds {
  bookingId: string;
  reportId: string;
  findingId: string;
  banId: string;
}

export function banScenarioIds(batchId: string): BanScenarioIds {
  return {
    bookingId: batchUuid(batchId, 'ban-booking'),
    reportId: batchUuid(batchId, 'ban-report'),
    findingId: batchUuid(batchId, 'ban-finding'),
    banId: batchUuid(batchId, 'ban-ban'),
  };
}

/** Run-2 SQL: one confirmed off-platform report on a fake booking and a 14-day ban (no bookings domain yet). */
export function buildBanSql(input: {
  schema: string;
  batchId: string;
  ids: BanScenarioIds;
  reporter: SeedUserRef;
  admin: SeedUserRef;
  banned: SeedUserRef & { companyId: string };
}): string {
  const s = assertSchema(input.schema);
  const tag = batchTag(input.batchId);
  const { ids, reporter, admin, banned } = input;
  const description = `TEST ${tag}: shipper asked to settle in cash outside Truber after the booking was confirmed.`;
  const reason = `TEST ${tag}: confirmed for testing the 14-day ban.`;
  const parties = JSON.stringify([{ role: 'shipper', userId: banned.userId, companyId: banned.companyId }]);
  const usersOk = `(SELECT count(*) FROM ${s}.users u WHERE u.id = ANY(${uuidArray([reporter.userId, admin.userId, banned.userId])}) AND ${userMarkers('u', input.batchId)}) = 3`;
  const companyOk = `EXISTS (SELECT 1 FROM ${s}.companies c WHERE c.id = ${uuidLit(banned.companyId)} AND ${companyMarkers('c', input.batchId)})`;
  return [
    header('off-platform ban scenario (fake booking, confirmed report, 14-day ban)', input.batchId, s),
    `-- Booking ${ids.bookingId} is fake: bookings are not built yet, so nothing references it.`,
    'BEGIN;',
    '',
    `INSERT INTO ${s}.off_platform_reports (id, booking_id, reported_by_user_id, reporter_role, suspected_party, description, evidence_uris, status, created_at)`,
    `SELECT ${uuidLit(ids.reportId)}, ${uuidLit(ids.bookingId)}, ${uuidLit(reporter.userId)}, 'transporter', 'shipper', ${str(description)}, '[]'::jsonb, 'confirmed', clock_timestamp()`,
    `WHERE ${usersOk} AND ${companyOk}`,
    'ON CONFLICT (id) DO NOTHING;',
    '',
    `INSERT INTO ${s}.off_platform_findings (id, report_id, booking_id, outcome, reason, responsible_parties, reviewed_by_user_id, reviewed_at)`,
    `SELECT ${uuidLit(ids.findingId)}, ${uuidLit(ids.reportId)}, ${uuidLit(ids.bookingId)}, 'confirmed', ${str(reason)}, ${str(parties)}::jsonb, ${uuidLit(admin.userId)}, clock_timestamp()`,
    `WHERE EXISTS (SELECT 1 FROM ${s}.off_platform_reports r WHERE r.id = ${uuidLit(ids.reportId)})`,
    'ON CONFLICT (id) DO NOTHING;',
    '',
    `INSERT INTO ${s}.off_platform_bans (id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at, duration_days, applied_by_user_id, created_at)`,
    `SELECT ${uuidLit(ids.banId)}, ${uuidLit(ids.findingId)}, ${uuidLit(banned.userId)}, ${uuidLit(banned.companyId)}, 'shipper', ${str(reason)},`,
    `       t.now_ms, t.now_ms + interval '336 hours', 14, ${uuidLit(admin.userId)}, clock_timestamp()`,
    `FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS now_ms) t`,
    `WHERE EXISTS (SELECT 1 FROM ${s}.off_platform_findings f WHERE f.id = ${uuidLit(ids.findingId)})`,
    'ON CONFLICT (id) DO NOTHING;',
    '',
    'COMMIT;',
    '',
    '-- Check: expect one row, status active.',
    `SELECT b.id, b.party_role, b.starts_at, b.ends_at FROM ${s}.off_platform_bans b WHERE b.id = ${uuidLit(ids.banId)};`,
    '',
  ].join('\n');
}

export interface CleanupInput {
  schema: string;
  batchId: string;
  userIds: string[];
  companyIds: string[];
  loadIds: string[];
  reportIds: string[];
  findingIds: string[];
  banIds: string[];
}

/**
 * One atomic statement that deletes only this batch's rows, children first, and
 * returns per-table counts. A guard aborts the whole statement (nothing deleted)
 * if non-batch data is entangled with batch rows.
 */
export function buildCleanupSql(input: CleanupInput): string {
  const s = assertSchema(input.schema);
  const b = assertBatchId(input.batchId);
  const tagLike = str(`%${batchTag(b)}%`);
  const guards: Array<[string, string]> = [
    [
      'non-batch user is a member of a batch company',
      `SELECT 1 FROM ${s}.company_members m WHERE m.company_id IN (SELECT id FROM batch_companies) AND m.user_id NOT IN (SELECT id FROM batch_users)`,
    ],
    [
      'batch user is a member of a non-batch company',
      `SELECT 1 FROM ${s}.company_members m WHERE m.user_id IN (SELECT id FROM batch_users) AND m.company_id NOT IN (SELECT id FROM batch_companies)`,
    ],
    [
      'load links batch and non-batch data',
      `SELECT 1 FROM ${s}.loads l WHERE (l.company_id IN (SELECT id FROM batch_companies)) <> (l.created_by IN (SELECT id FROM batch_users))`,
    ],
    [
      'batch user reviewed a non-batch off-platform report',
      `SELECT 1 FROM ${s}.off_platform_findings f WHERE f.reviewed_by_user_id IN (SELECT id FROM batch_users) AND f.report_id NOT IN (SELECT id FROM del_reports_set)`,
    ],
    [
      'batch user applied or lifted a ban on non-batch data',
      `SELECT 1 FROM ${s}.off_platform_bans x WHERE (x.applied_by_user_id IN (SELECT id FROM batch_users) OR x.lifted_by_user_id IN (SELECT id FROM batch_users)) AND x.user_id NOT IN (SELECT id FROM batch_users)`,
    ],
  ];
  const guardSql = guards
    .map(
      ([label, sql]) =>
        `    CASE WHEN EXISTS (${sql})\n         THEN ('seed cleanup refused: ${label} (' || (SELECT count(*) FROM (${sql}) g) || ' rows)')::int ELSE 0 END`,
    )
    .join(' +\n');
  const del = (name: string, table: string, where: string) =>
    `  ${name} AS (DELETE FROM ${s}.${table} WHERE ${where} RETURNING 1)`;
  const byUser = 'user_id IN (SELECT id FROM batch_users)';
  return [
    header('CLEANUP (deletes this batch only)', b, s),
    '-- One atomic statement: it either deletes everything below or nothing.',
    '-- Order is children first. Foreign keys are checked at the end of the statement.',
    '-- Second guard: rows must ALSO carry TEST markers; recorded ids without them are left alone.',
    'WITH',
    `  batch_users AS (SELECT u.id FROM ${s}.users u WHERE u.id = ANY(${uuidArray(input.userIds)}) AND ${userMarkers('u', b)}),`,
    `  batch_companies AS (SELECT c.id FROM ${s}.companies c WHERE c.id = ANY(${uuidArray(input.companyIds)}) AND ${companyMarkers('c', b)}),`,
    `  del_reports_set AS (SELECT r.id FROM ${s}.off_platform_reports r WHERE r.reported_by_user_id IN (SELECT id FROM batch_users) OR (r.id = ANY(${uuidArray(input.reportIds)}) AND r.description LIKE ${tagLike})),`,
    `  del_findings_set AS (SELECT f.id FROM ${s}.off_platform_findings f WHERE f.report_id IN (SELECT id FROM del_reports_set)),`,
    '  guard AS (SELECT',
    guardSql,
    '    AS ok),',
    del(
      'd_bans',
      'off_platform_bans',
      `finding_id IN (SELECT id FROM del_findings_set) OR user_id IN (SELECT id FROM batch_users) OR company_id IN (SELECT id FROM batch_companies) OR (id = ANY(${uuidArray(input.banIds)}) AND reason LIKE ${tagLike})`,
    ) + ',',
    del('d_findings', 'off_platform_findings', 'id IN (SELECT id FROM del_findings_set)') + ',',
    del('d_reports', 'off_platform_reports', 'id IN (SELECT id FROM del_reports_set)') + ',',
    del(
      'd_loads',
      'loads',
      `company_id IN (SELECT id FROM batch_companies) OR created_by IN (SELECT id FROM batch_users)`,
    ) + ',',
    del('d_members', 'company_members', `company_id IN (SELECT id FROM batch_companies) OR ${byUser}`) + ',',
    del('d_sessions', 'refresh_sessions', byUser) + ',',
    del('d_reset_tokens', 'password_reset_tokens', byUser) + ',',
    del('d_otp', 'otp_challenges', byUser) + ',',
    del('d_idempotency', 'idempotency_records', byUser) + ',',
    del('d_outbox', 'delivery_outbox', byUser) + ',',
    del(
      'd_rate_limits',
      'rate_limit_buckets',
      `bucket_key IN (SELECT p || id::text FROM batch_users CROSS JOIN (VALUES ('otp-user:'), ('otp-verify:')) v(p))`,
    ) + ',',
    del('d_companies', 'companies', 'id IN (SELECT id FROM batch_companies)') + ',',
    del('d_users', 'users', 'id IN (SELECT id FROM batch_users)'),
    'SELECT t.table_name, t.deleted FROM guard CROSS JOIN (VALUES',
    "  ('off_platform_bans', (SELECT count(*) FROM d_bans)),",
    "  ('off_platform_findings', (SELECT count(*) FROM d_findings)),",
    "  ('off_platform_reports', (SELECT count(*) FROM d_reports)),",
    "  ('loads', (SELECT count(*) FROM d_loads)),",
    "  ('company_members', (SELECT count(*) FROM d_members)),",
    "  ('refresh_sessions', (SELECT count(*) FROM d_sessions)),",
    "  ('password_reset_tokens', (SELECT count(*) FROM d_reset_tokens)),",
    "  ('otp_challenges', (SELECT count(*) FROM d_otp)),",
    "  ('idempotency_records', (SELECT count(*) FROM d_idempotency)),",
    "  ('delivery_outbox', (SELECT count(*) FROM d_outbox)),",
    "  ('rate_limit_buckets', (SELECT count(*) FROM d_rate_limits)),",
    "  ('companies', (SELECT count(*) FROM d_companies)),",
    "  ('users', (SELECT count(*) FROM d_users))",
    ') AS t(table_name, deleted)',
    'WHERE guard.ok = 0;',
    '',
  ].join('\n');
}

/** Read-only check to run after cleanup: every count should be 0. */
export function buildCleanupVerifySql(input: CleanupInput): string {
  const s = assertSchema(input.schema);
  const b = assertBatchId(input.batchId);
  const tagLike = str(`%${batchTag(b)}%`);
  return [
    header('CLEANUP CHECK (read-only; every count should be 0)', b, s),
    'SELECT * FROM (VALUES',
    `  ('users', (SELECT count(*) FROM ${s}.users WHERE id = ANY(${uuidArray(input.userIds)}) OR full_name LIKE ${str(`%(${batchTag(b)})`)})),`,
    `  ('companies', (SELECT count(*) FROM ${s}.companies WHERE id = ANY(${uuidArray(input.companyIds)}) OR registration_number LIKE ${str(`TEST-${b}-%`)})),`,
    `  ('loads', (SELECT count(*) FROM ${s}.loads WHERE id = ANY(${uuidArray(input.loadIds)}) OR special_requirements LIKE ${tagLike})),`,
    `  ('off_platform_reports', (SELECT count(*) FROM ${s}.off_platform_reports WHERE id = ANY(${uuidArray(input.reportIds)}) OR description LIKE ${tagLike})),`,
    `  ('off_platform_findings', (SELECT count(*) FROM ${s}.off_platform_findings WHERE id = ANY(${uuidArray(input.findingIds)}) OR reason LIKE ${tagLike})),`,
    `  ('off_platform_bans', (SELECT count(*) FROM ${s}.off_platform_bans WHERE id = ANY(${uuidArray(input.banIds)}) OR reason LIKE ${tagLike}))`,
    ') AS t(table_name, remaining);',
    '',
  ].join('\n');
}
