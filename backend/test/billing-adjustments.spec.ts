import { planAdjustment } from '../src/billing/adjustments';
import { commissionForMinor } from '../src/billing/commission';
import { HELD_COMMISSION_COUNTS_AS_OWING, owingStatuses } from '../src/billing/held-policy';
import { ApiException } from '../src/common/api.exception';

function money(amountMinor: number, currency = 'USD') {
  return { amountMinor, currency };
}

function capture(fn: () => unknown): ApiException {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ApiException');
}

describe('commissionForMinor', () => {
  const cases: Array<[number, number]> = [
    [333, 17],
    [330, 17],
    [10, 1],
    [9, 0],
    [100000, 5000],
    [50000, 2500],
    [60000, 3000],
    [0, 0],
  ];

  it.each(cases)('rounds half up with zero allowed: %i -> %i', (tripMinor, expected) => {
    expect(commissionForMinor(tripMinor, 'USD')).toEqual(money(expected));
  });

  it('preserves the currency', () => {
    expect(commissionForMinor(333, 'ZWG')).toEqual(money(17, 'ZWG'));
  });

  it('rejects negative and unsafe amounts', () => {
    expect(capture(() => commissionForMinor(-1, 'USD')).getStatus()).toBe(400);
    expect(capture(() => commissionForMinor(Number.MAX_SAFE_INTEGER + 1, 'USD')).getStatus()).toBe(
      400,
    );
  });
});

describe('planAdjustment', () => {
  const baseline = {
    previousTripMinor: 100000,
    previousCommissionMinor: 5000,
    currency: 'USD',
  };

  it('splits the delta between the open remainder and a credit', () => {
    expect(planAdjustment({ ...baseline, newTripMinor: 50000, remainingMinor: 5000 })).toEqual({
      newCommissionMinor: 2500,
      deltaMinor: 2500,
      reducedOpenMinor: 2500,
      creditedMinor: 0,
    });
  });

  it('credits the whole delta when nothing remains open', () => {
    expect(planAdjustment({ ...baseline, newTripMinor: 50000, remainingMinor: 0 })).toEqual({
      newCommissionMinor: 2500,
      deltaMinor: 2500,
      reducedOpenMinor: 0,
      creditedMinor: 2500,
    });
  });

  it('reduces only against the open remainder and credits nothing when the delta fits', () => {
    expect(planAdjustment({ ...baseline, newTripMinor: 50000, remainingMinor: 4000 })).toEqual({
      newCommissionMinor: 2500,
      deltaMinor: 2500,
      reducedOpenMinor: 2500,
      creditedMinor: 0,
    });
  });

  it('reverses the whole commission for a zero trip', () => {
    expect(planAdjustment({ ...baseline, newTripMinor: 0, remainingMinor: 5000 })).toEqual({
      newCommissionMinor: 0,
      deltaMinor: 5000,
      reducedOpenMinor: 5000,
      creditedMinor: 0,
    });
    expect(planAdjustment({ ...baseline, newTripMinor: 0, remainingMinor: 0 })).toEqual({
      newCommissionMinor: 0,
      deltaMinor: 5000,
      reducedOpenMinor: 0,
      creditedMinor: 5000,
    });
  });

  it('uses the previous adjustment commission as the baseline for a chain', () => {
    expect(
      planAdjustment({
        previousTripMinor: 60000,
        previousCommissionMinor: 3000,
        newTripMinor: 50000,
        remainingMinor: 3000,
        currency: 'USD',
      }),
    ).toEqual({
      newCommissionMinor: 2500,
      deltaMinor: 500,
      reducedOpenMinor: 500,
      creditedMinor: 0,
    });
  });

  it('rejects an increase', () => {
    const error = capture(() =>
      planAdjustment({ ...baseline, newTripMinor: 100001, remainingMinor: 5000 }),
    );
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('ADJUSTMENT_INCREASE_NOT_ALLOWED');
  });

  it('rejects a no-op and points at finaliseAfterDispute', () => {
    const error = capture(() =>
      planAdjustment({ ...baseline, newTripMinor: 100000, remainingMinor: 5000 }),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual({
      fields: { newTripAmount: 'must differ; use finaliseAfterDispute' },
    });
  });
});

describe('held policy', () => {
  it('keeps held commission out of owing until the user decides otherwise', () => {
    expect(HELD_COMMISSION_COUNTS_AS_OWING).toBe(false);
    expect(owingStatuses()).toEqual(['open']);
  });
});
