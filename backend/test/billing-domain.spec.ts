import { ApiException } from '../src/common/api.exception';
import {
  addMoney,
  assertMoney,
  assertSameCurrency,
  minorFromDb,
  Money,
  subMoney,
} from '../src/billing/money';
import {
  ArrangementSnapshot,
  assertBookingConfirmable,
  commissionFor,
  computeNetPayout,
  isPaymentProtected,
  planRelease,
} from '../src/billing/commission';

const VALIDATION_ERROR = {
  status: 400,
  code: 'VALIDATION_ERROR',
  message: 'Request validation failed',
};
const CURRENCY_MISMATCH = {
  status: 409,
  code: 'CURRENCY_MISMATCH',
  message: 'All amounts must use the same currency.',
};
const NET_PAYOUT_NEGATIVE = {
  status: 409,
  code: 'NET_PAYOUT_NEGATIVE',
  message: 'Commission and fees exceed the trip amount.',
};
const FEE_TOTAL_MISMATCH = {
  status: 409,
  code: 'FEE_TOTAL_MISMATCH',
  message: 'processingFeesTotal must equal the recorded processing fees.',
};
const CREDIT_PAYMENT_NOT_RECORDED = {
  status: 409,
  code: 'CREDIT_PAYMENT_NOT_RECORDED',
  message: 'Corporate credit payout is blocked until the shipper payment is recorded.',
};
const BALANCE_NOT_RECEIPTED = {
  status: 409,
  code: 'BALANCE_NOT_RECEIPTED',
  message: 'The unreceipted balance is not payable.',
};
const FUNDS_NOT_RECEIVED = {
  status: 409,
  code: 'FUNDS_NOT_RECEIVED',
  message: 'Shipper funds for this trip have not been recorded.',
};
const BOOKING_CONFIRM_REQUIRES_ARRANGEMENT = {
  status: 409,
  code: 'BOOKING_CONFIRM_REQUIRES_ARRANGEMENT',
  message: 'A confirmed payment arrangement is required before the booking can be confirmed.',
};
const MULTIPLE_CONFIRMED_ARRANGEMENTS = {
  status: 409,
  code: 'MULTIPLE_CONFIRMED_ARRANGEMENTS',
  message: 'Only one payment arrangement can be confirmed.',
};
const CASH_NOT_PROTECTED = {
  status: 409,
  code: 'CASH_NOT_PROTECTED',
  message: 'Cash payments are recorded but never payment-protected.',
};

function money(amountMinor: number, currency = 'USD'): Money {
  return { amountMinor, currency };
}

function expectApiError(
  fn: () => unknown,
  expected: { status: number; code: string; message: string },
): ApiException {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiException);
  const error = caught as ApiException;
  expect(error.getStatus()).toBe(expected.status);
  expect(error.code).toBe(expected.code);
  expect(error.message).toBe(expected.message);
  return error;
}

function arrangement(overrides: Partial<ArrangementSnapshot> = {}): ArrangementSnapshot {
  return { method: 'prepay', arrangementStatus: 'proposed', protectionStatus: 'none', ...overrides };
}

describe('money', () => {
  it('accepts a positive safe-integer amount and a valid currency', () => {
    expect(assertMoney(money(100))).toEqual({ amountMinor: 100, currency: 'USD' });
  });

  it('rejects zero unless allowZero is set', () => {
    const error = expectApiError(() => assertMoney(money(0)), VALIDATION_ERROR);
    expect(error.details).toEqual({ fields: { amountMinor: 'must be at least 1' } });
    expect(assertMoney(money(0), { allowZero: true })).toEqual({ amountMinor: 0, currency: 'USD' });
  });

  it('rejects negative amounts even when zero is allowed', () => {
    const error = expectApiError(
      () => assertMoney(money(-1), { allowZero: true }),
      VALIDATION_ERROR,
    );
    expect(error.details).toEqual({ fields: { amountMinor: 'must be at least 0' } });
  });

  it('rejects non-integer and unsafe amounts', () => {
    expectApiError(() => assertMoney(money(1.5)), VALIDATION_ERROR);
    expectApiError(() => assertMoney(money(Number.NaN)), VALIDATION_ERROR);
    expectApiError(() => assertMoney(money(Number.MAX_SAFE_INTEGER + 1)), VALIDATION_ERROR);
  });

  it('rejects invalid currency codes', () => {
    for (const currency of ['usd', 'US', 'USDD', 'U$D']) {
      const error = expectApiError(() => assertMoney(money(100, currency)), VALIDATION_ERROR);
      expect(error.details).toEqual({
        fields: { currency: 'must be a three-letter ISO 4217 currency code' },
      });
    }
  });

  it('reports every invalid field at once', () => {
    const error = expectApiError(
      () => assertMoney({ amountMinor: -5, currency: 'usd' }),
      VALIDATION_ERROR,
    );
    expect(error.details).toEqual({
      fields: {
        amountMinor: 'must be at least 1',
        currency: 'must be a three-letter ISO 4217 currency code',
      },
    });
  });

  it('assertSameCurrency accepts matching currencies and rejects mismatches', () => {
    expect(() => assertSameCurrency(money(1, 'USD'), money(2, 'USD'))).not.toThrow();
    expect(() => assertSameCurrency(money(1, 'USD'))).not.toThrow();
    expectApiError(
      () => assertSameCurrency(money(1, 'USD'), money(2, 'ZWG')),
      CURRENCY_MISMATCH,
    );
  });

  it('adds and subtracts money, allowing negative subtraction results', () => {
    expect(addMoney(money(100), money(250))).toEqual(money(350));
    expect(subMoney(money(100), money(250))).toEqual(money(-150));
  });

  it('enforces currency on add and subtract', () => {
    expectApiError(() => addMoney(money(100), money(100, 'ZWG')), CURRENCY_MISMATCH);
    expectApiError(() => subMoney(money(100), money(100, 'ZWG')), CURRENCY_MISMATCH);
  });

  it('throws when add or subtract leaves the safe-integer range', () => {
    expectApiError(
      () => addMoney(money(Number.MAX_SAFE_INTEGER), money(1)),
      VALIDATION_ERROR,
    );
    expectApiError(
      () => subMoney(money(-Number.MAX_SAFE_INTEGER), money(1)),
      VALIDATION_ERROR,
    );
  });

  it('converts pg bigint values to safe numbers', () => {
    expect(minorFromDb('12345')).toBe(12345);
    expect(minorFromDb(12345)).toBe(12345);
    expect(minorFromDb(12345n)).toBe(12345);
    expect(minorFromDb('-12345')).toBe(-12345);
    expect(minorFromDb(9007199254740991n)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws a plain Error for unsafe or malformed database values', () => {
    expect(() => minorFromDb('9007199254740992')).toThrow(/not a safe integer/);
    expect(() => minorFromDb(9007199254740993n)).toThrow(/not a safe integer/);
    expect(() => minorFromDb(Number.MAX_SAFE_INTEGER + 1)).toThrow(/not a safe integer/);
    expect(() => minorFromDb(1.5)).toThrow(/not a safe integer/);
    expect(() => minorFromDb('12.5')).toThrow(/not a safe integer/);
    expect(() => minorFromDb('abc')).toThrow(/not a safe integer/);
  });
});

describe('commissionFor', () => {
  const cases: Array<[number, number]> = [
    [100000, 5000],
    [1, 0],
    [9, 0],
    [10, 1],
    [30, 2],
    [29, 1],
    [50, 3],
    [99999, 5000],
    [12345, 617],
  ];

  it.each(cases)('rounds half up: %i -> %i', (amountMinor, expectedCommission) => {
    expect(commissionFor(money(amountMinor))).toEqual(money(expectedCommission));
  });

  it('computes Number.MAX_SAFE_INTEGER without precision loss', () => {
    const expected = Number(
      (BigInt(Number.MAX_SAFE_INTEGER) * 500n + 5000n) / 10000n,
    );
    const result = commissionFor(money(Number.MAX_SAFE_INTEGER));
    expect(result.amountMinor).toBe(expected);
    expect(Number.isSafeInteger(result.amountMinor)).toBe(true);
  });

  it('preserves the trip currency', () => {
    expect(commissionFor(money(100000, 'ZWG'))).toEqual(money(5000, 'ZWG'));
  });

  it('rejects zero and negative trips', () => {
    expectApiError(() => commissionFor(money(0)), VALIDATION_ERROR);
    expectApiError(() => commissionFor(money(-1)), VALIDATION_ERROR);
  });
});

describe('computeNetPayout', () => {
  it('matches the US$1,000 concept example', () => {
    expect(
      computeNetPayout({ trip: money(100000), recordedFees: [] }),
    ).toEqual({
      trip: money(100000),
      commission: money(5000),
      feesTotal: money(0),
      net: money(95000),
    });
  });

  it('subtracts recorded fees from the transporter payout', () => {
    expect(
      computeNetPayout({
        trip: money(100000),
        recordedFees: [money(100), money(250)],
      }),
    ).toEqual({
      trip: money(100000),
      commission: money(5000),
      feesTotal: money(350),
      net: money(94650),
    });
  });

  it('allows zero fees and a matching typed total', () => {
    const result = computeNetPayout({
      trip: money(100000),
      recordedFees: [money(0), money(250)],
      typedFeesTotal: money(250),
    });
    expect(result.feesTotal).toEqual(money(250));
    expect(result.net).toEqual(money(94750));
  });

  it('rejects a typed fee total that differs from the recorded fees', () => {
    const error = expectApiError(
      () =>
        computeNetPayout({
          trip: money(100000),
          recordedFees: [money(100), money(250)],
          typedFeesTotal: money(400),
        }),
      FEE_TOTAL_MISMATCH,
    );
    expect(error.details).toEqual({ recordedFeesTotal: money(350) });
  });

  it('rejects mixed fee currencies', () => {
    expectApiError(
      () =>
        computeNetPayout({
          trip: money(100000),
          recordedFees: [money(100), money(250, 'ZWG')],
        }),
      CURRENCY_MISMATCH,
    );
  });

  it('rejects a mixed typed fee total currency', () => {
    expectApiError(
      () =>
        computeNetPayout({
          trip: money(100000),
          recordedFees: [money(250)],
          typedFeesTotal: money(250, 'ZWG'),
        }),
      CURRENCY_MISMATCH,
    );
  });

  it('rejects negative fees', () => {
    expectApiError(
      () =>
        computeNetPayout({
          trip: money(100000),
          recordedFees: [money(-1)],
        }),
      VALIDATION_ERROR,
    );
  });

  it('rejects a payout where commission and fees exceed the trip', () => {
    const error = expectApiError(
      () => computeNetPayout({ trip: money(100), recordedFees: [money(96)] }),
      NET_PAYOUT_NEGATIVE,
    );
    expect(error.details).toBeUndefined();
  });

  it('allows a payout that is exactly zero', () => {
    expect(
      computeNetPayout({ trip: money(100), recordedFees: [money(95)] }),
    ).toEqual({
      trip: money(100),
      commission: money(5),
      feesTotal: money(95),
      net: money(0),
    });
  });

  it('allows a small trip whose commission rounds to zero', () => {
    expect(
      computeNetPayout({ trip: money(9), recordedFees: [money(0)] }),
    ).toEqual({
      trip: money(9),
      commission: money(0),
      feesTotal: money(0),
      net: money(9),
    });
  });
});

describe('planRelease', () => {
  it('records only a receivable for cash and never pays out', () => {
    expect(
      planRelease({
        method: 'cash',
        trip: money(100000),
        recordedFees: [],
        shipperFundsReceived: [],
      }),
    ).toEqual({
      kind: 'cash_receivable_only',
      commission: money(5000),
      farePayoutDue: false,
      commissionSettlement: 'receivable_open',
    });
  });

  it('ignores fees for cash but still enforces currency', () => {
    const result = planRelease({
      method: 'cash',
      trip: money(100000),
      recordedFees: [money(250)],
      shipperFundsReceived: [],
    });
    expect(result).toEqual({
      kind: 'cash_receivable_only',
      commission: money(5000),
      farePayoutDue: false,
      commissionSettlement: 'receivable_open',
    });
    expectApiError(
      () =>
        planRelease({
          method: 'cash',
          trip: money(100000),
          recordedFees: [money(250, 'ZWG')],
          shipperFundsReceived: [],
        }),
      CURRENCY_MISMATCH,
    );
  });

  it('blocks corporate credit until the shipper payment is recorded', () => {
    expectApiError(
      () =>
        planRelease({
          method: 'corporate_credit',
          trip: money(50000),
          recordedFees: [],
          shipperFundsReceived: [],
        }),
      CREDIT_PAYMENT_NOT_RECORDED,
    );

    expect(
      planRelease({
        method: 'corporate_credit',
        trip: money(50000),
        recordedFees: [],
        shipperFundsReceived: [money(50000)],
      }),
    ).toEqual({
      kind: 'payout',
      commission: money(2500),
      feesTotal: money(0),
      net: money(47500),
      farePayoutDue: true,
      commissionSettlement: 'settled_on_release',
    });
  });

  it('does not pay an unreceipted deposit balance', () => {
    const error = expectApiError(
      () =>
        planRelease({
          method: 'deposit_balance',
          trip: money(100000),
          recordedFees: [],
          shipperFundsReceived: [money(40000)],
        }),
      BALANCE_NOT_RECEIPTED,
    );
    expect(error.details).toEqual({
      receivedAmount: money(40000),
      tripAmount: money(100000),
    });

    expect(
      planRelease({
        method: 'deposit_balance',
        trip: money(100000),
        recordedFees: [],
        shipperFundsReceived: [money(40000), money(60000)],
      }),
    ).toEqual({
      kind: 'payout',
      commission: money(5000),
      feesTotal: money(0),
      net: money(95000),
      farePayoutDue: true,
      commissionSettlement: 'settled_on_release',
    });
  });

  it('blocks prepay and escrow payouts until shipper funds are recorded', () => {
    expectApiError(
      () =>
        planRelease({
          method: 'prepay',
          trip: money(100000),
          recordedFees: [],
          shipperFundsReceived: [],
        }),
      FUNDS_NOT_RECEIVED,
    );
    expectApiError(
      () =>
        planRelease({
          method: 'escrow',
          trip: money(100000),
          recordedFees: [],
          shipperFundsReceived: [money(99999)],
        }),
      FUNDS_NOT_RECEIVED,
    );
  });

  it('pays out prepay once the full amount is received', () => {
    expect(
      planRelease({
        method: 'prepay',
        trip: money(100000),
        recordedFees: [money(250)],
        typedFeesTotal: money(250),
        shipperFundsReceived: [money(60000), money(40000)],
      }),
    ).toEqual({
      kind: 'payout',
      commission: money(5000),
      feesTotal: money(250),
      net: money(94750),
      farePayoutDue: true,
      commissionSettlement: 'settled_on_release',
    });
  });

  it('rejects mixed currencies in shipper funds', () => {
    expectApiError(
      () =>
        planRelease({
          method: 'prepay',
          trip: money(100000),
          recordedFees: [],
          shipperFundsReceived: [money(100000, 'ZWG')],
        }),
      CURRENCY_MISMATCH,
    );
  });

  it('checks the net payout before the funds-received gate', () => {
    expectApiError(
      () =>
        planRelease({
          method: 'prepay',
          trip: money(100),
          recordedFees: [money(96)],
          shipperFundsReceived: [],
        }),
      NET_PAYOUT_NEGATIVE,
    );
  });
});

describe('assertBookingConfirmable', () => {
  it('requires a confirmed arrangement', () => {
    expectApiError(() => assertBookingConfirmable([]), BOOKING_CONFIRM_REQUIRES_ARRANGEMENT);
    expectApiError(
      () =>
        assertBookingConfirmable([
          arrangement({ arrangementStatus: 'proposed' }),
          arrangement({ method: 'cash', arrangementStatus: 'rejected' }),
        ]),
      BOOKING_CONFIRM_REQUIRES_ARRANGEMENT,
    );
  });

  it('allows exactly one confirmed arrangement', () => {
    expect(() =>
      assertBookingConfirmable([
        arrangement({ arrangementStatus: 'rejected' }),
        arrangement({ arrangementStatus: 'confirmed' }),
        arrangement({ method: 'cash', arrangementStatus: 'cancelled' }),
      ]),
    ).not.toThrow();
  });

  it('rejects more than one confirmed arrangement', () => {
    expectApiError(
      () =>
        assertBookingConfirmable([
          arrangement({ arrangementStatus: 'confirmed' }),
          arrangement({ method: 'escrow', arrangementStatus: 'confirmed' }),
        ]),
      MULTIPLE_CONFIRMED_ARRANGEMENTS,
    );
  });

  it('allows confirmed cash only when it has no protection', () => {
    expect(() =>
      assertBookingConfirmable([
        arrangement({ method: 'cash', arrangementStatus: 'confirmed', protectionStatus: 'none' }),
      ]),
    ).not.toThrow();

    for (const protectionStatus of [
      'pending_evidence',
      'protected',
      'protection_failed',
      'released_from_protection',
    ] as const) {
      expectApiError(
        () =>
          assertBookingConfirmable([
            arrangement({
              method: 'cash',
              arrangementStatus: 'confirmed',
              protectionStatus,
            }),
          ]),
        CASH_NOT_PROTECTED,
      );
    }
  });

  it('ignores protection on unconfirmed cash arrangements', () => {
    expect(() =>
      assertBookingConfirmable([
        arrangement({ method: 'cash', arrangementStatus: 'proposed', protectionStatus: 'protected' }),
        arrangement({ arrangementStatus: 'confirmed' }),
      ]),
    ).not.toThrow();
  });
});

describe('isPaymentProtected', () => {
  it('is true only for non-cash protected arrangements', () => {
    expect(
      isPaymentProtected(arrangement({ method: 'prepay', protectionStatus: 'protected' })),
    ).toBe(true);
    expect(
      isPaymentProtected(arrangement({ method: 'escrow', protectionStatus: 'protected' })),
    ).toBe(true);
    expect(
      isPaymentProtected(arrangement({ method: 'prepay', protectionStatus: 'pending_evidence' })),
    ).toBe(false);
  });

  it('is false for cash even when protection is claimed', () => {
    expect(
      isPaymentProtected(arrangement({ method: 'cash', protectionStatus: 'protected' })),
    ).toBe(false);
    expect(
      isPaymentProtected(arrangement({ method: 'cash', protectionStatus: 'none' })),
    ).toBe(false);
  });
});
