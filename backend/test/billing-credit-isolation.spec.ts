import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
const CREDIT_REFERENCES = [
  'commission_credits',
  'commission_credit_allocations',
  'creditByCurrency',
];
const CREDIT_PATTERN = /credit_?(applied|remaining)|commission_credits/i;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

describe('commission credit isolation', () => {
  const files = sourceFiles(SRC);

  it('only reads commission credit state in the receivables service and table list', () => {
    const offenders = files
      .filter((file) => {
        const source = readSource(file);
        return CREDIT_REFERENCES.some((reference) => source.includes(reference));
      })
      .map(relative)
      .sort();

    expect(offenders).toEqual(['billing/receivables.service.ts', 'db/identifiers.ts']);
  });

  it('keeps payout and refund code free of commission credit', () => {
    expect(readSource(path.join(SRC, 'billing/commission.ts'))).not.toMatch(CREDIT_PATTERN);
    expect(readSource(path.join(SRC, 'billing/payment-provider.ts'))).not.toMatch(CREDIT_PATTERN);
  });

  it('does not read commission credit in settleOnRelease', () => {
    const source = readSource(path.join(SRC, 'billing/receivables.service.ts'));
    const start = source.indexOf('async settleOnRelease');
    const end = source.indexOf('async outstandingByCurrency', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/commission_credits/);
  });
});
