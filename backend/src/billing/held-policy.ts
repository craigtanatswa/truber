import type { CommissionReceivableStatus } from './receivables.service';

/**
 * U7 (decided by the user 11 Nov 2026 16:32 CAT, via Charlie): commission HELD by an open dispute
 * does NOT count as owing. It is excluded from outstandingByCurrency, the COMMISSION_OUTSTANDING
 * gate, collections and credit netting. One switch (HELD_COMMISSION_COUNTS_AS_OWING) changes this
 * if that ever changes.
 */
export const HELD_COMMISSION_COUNTS_AS_OWING = false as const;

export function owingStatuses(): readonly CommissionReceivableStatus[] {
  return HELD_COMMISSION_COUNTS_AS_OWING ? ['open', 'held'] : ['open'];
}
