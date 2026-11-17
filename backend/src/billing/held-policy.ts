import type { CommissionReceivableStatus } from './receivables.service';

/**
 * PENDING USER DECISION (open question U7, plan billing-launch-item-3 §0).
 * Recommendation (Jensen) and Mark agree: commission HELD by an open dispute does NOT count as owing.
 * It is excluded from outstandingByCurrency, the COMMISSION_OUTSTANDING gate, collections and credit netting.
 * If the user decides otherwise, flip HELD_COMMISSION_COUNTS_AS_OWING; every read below goes through owingStatuses().
 */
export const HELD_COMMISSION_COUNTS_AS_OWING = false as const;

export function owingStatuses(): readonly CommissionReceivableStatus[] {
  return HELD_COMMISSION_COUNTS_AS_OWING ? ['open', 'held'] : ['open'];
}
