import { ApiException } from '../common/api.exception';
import { commissionForMinor } from './commission';

export interface AdjustmentPlanInput {
  previousTripMinor: number;
  previousCommissionMinor: number;
  newTripMinor: number;
  remainingMinor: number;
  currency: string;
}

export interface AdjustmentPlan {
  newCommissionMinor: number;
  deltaMinor: number;
  reducedOpenMinor: number;
  creditedMinor: number;
}

export function planAdjustment(input: AdjustmentPlanInput): AdjustmentPlan {
  if (input.newTripMinor > input.previousTripMinor) {
    throw new ApiException(
      409,
      'ADJUSTMENT_INCREASE_NOT_ALLOWED',
      'A commission adjustment may only reduce the trip amount.',
    );
  }
  if (input.newTripMinor === input.previousTripMinor) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { newTripAmount: 'must differ; use finaliseAfterDispute' },
    });
  }

  const newCommissionMinor = commissionForMinor(input.newTripMinor, input.currency).amountMinor;
  const deltaMinor = input.previousCommissionMinor - newCommissionMinor;
  const reducedOpenMinor = Math.min(deltaMinor, input.remainingMinor);
  const creditedMinor = deltaMinor - reducedOpenMinor;

  return { newCommissionMinor, deltaMinor, reducedOpenMinor, creditedMinor };
}
