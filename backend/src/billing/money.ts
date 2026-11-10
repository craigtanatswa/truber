import { ApiException } from '../common/api.exception';

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface AssertMoneyOptions {
  allowZero?: boolean;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function validationError(fields: Record<string, string>): ApiException {
  return new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', { fields });
}

export function assertMoney(money: Money, options: AssertMoneyOptions = {}): Money {
  const allowZero = options.allowZero === true;
  const fields: Record<string, string> = {};
  const amountMinor = money?.amountMinor;
  const currency = money?.currency;

  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)) {
    fields.amountMinor = 'must be a safe integer';
  } else if (allowZero ? amountMinor < 0 : amountMinor < 1) {
    fields.amountMinor = allowZero ? 'must be at least 0' : 'must be at least 1';
  }

  if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    fields.currency = 'must be a three-letter ISO 4217 currency code';
  }

  if (Object.keys(fields).length > 0) {
    throw validationError(fields);
  }

  return { amountMinor: amountMinor as number, currency: currency as string };
}

export function assertSameCurrency(...items: Money[]): void {
  if (items.length < 2) {
    return;
  }
  const [first] = items;
  if (items.some((item) => item.currency !== first.currency)) {
    throw new ApiException(409, 'CURRENCY_MISMATCH', 'All amounts must use the same currency.');
  }
}

function checkedResult(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw validationError({ amountMinor: 'must be a safe integer' });
  }
  return { amountMinor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return checkedResult(a.amountMinor + b.amountMinor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return checkedResult(a.amountMinor - b.amountMinor, a.currency);
}

export function minorFromDb(value: string | number | bigint): number {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted) || BigInt(converted) !== value) {
      throw new Error(`Database amount ${value.toString()} is not a safe integer`);
    }
    return converted;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Database amount ${String(value)} is not a safe integer`);
    }
    return value;
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const converted = Number(value);
    if (Number.isSafeInteger(converted) && BigInt(converted) === BigInt(value)) {
      return converted;
    }
  }

  throw new Error(`Database amount ${String(value)} is not a safe integer`);
}
