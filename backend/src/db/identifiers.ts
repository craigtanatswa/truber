export const APP_TABLES = [
  'commission_collection_allocations',
  'commission_collections',
  'commission_receivables',
  'company_members',
  'companies',
  'delivery_outbox',
  'idempotency_records',
  'loads',
  'off_platform_bans',
  'off_platform_findings',
  'off_platform_reports',
  'otp_challenges',
  'password_reset_tokens',
  'payment_arrangements',
  'payment_records',
  'payouts',
  'rate_limit_buckets',
  'refresh_sessions',
  'schema_migrations',
  'users',
] as const;

const APP_FUNCTIONS = new Set(['billing_receivable_immutable']);

const POSTGIS_FUNCTIONS = new Set([
  'ST_AsText',
  'ST_Equals',
  'ST_MakePoint',
  'ST_SetSRID',
  'ST_X',
  'ST_Y',
  'PostGIS_Version',
]);

const POSTGIS_TYPES = new Set(['geography', 'geometry']);

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase SQL identifier`);
  }
  return value;
}

export function quoteIdent(value: string): string {
  assertIdentifier(value, 'SQL identifier');
  return `"${value}"`;
}

export interface DbLayout {
  appSchema: string;
  postgisSchema: string;
}

export function qualifyAppSql(sql: string, layout: DbLayout): string {
  const tables = new Set<string>(APP_TABLES);
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (character === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      out += sql.slice(start, index);
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) {
        index += 1;
      }
      const word = sql.slice(start, index);
      const previous = start > 0 ? sql[start - 1] : '';
      const alreadyQualified = previous === '.' || previous === '"';
      if (!alreadyQualified && tables.has(word)) {
        out += `${quoteIdent(layout.appSchema)}.${word}`;
      } else if (!alreadyQualified && APP_FUNCTIONS.has(word)) {
        out += `${quoteIdent(layout.appSchema)}.${word}`;
      } else if (!alreadyQualified && POSTGIS_FUNCTIONS.has(word)) {
        out += `${quoteIdent(layout.postgisSchema)}.${word}`;
      } else if (!alreadyQualified && POSTGIS_TYPES.has(word)) {
        out += `${quoteIdent(layout.postgisSchema)}.${word}`;
      } else {
        out += word;
      }
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}
