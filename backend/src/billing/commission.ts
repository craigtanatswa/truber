import { ApiException } from '../common/api.exception';
import { assertMoney, assertSameCurrency, Money } from './money';

export const COMMISSION_RATE_BPS = 500;

const BPS_DIVISOR = 10000n;
const ROUNDING_OFFSET = BPS_DIVISOR / 2n;

function validationError(fields: Record<string, string>): ApiException {
  return new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', { fields });
}

function safeMoney(amountMinor: bigint, currency: string): Money {
  const converted = Number(amountMinor);
  if (!Number.isSafeInteger(converted)) {
    throw validationError({ amountMinor: 'must be a safe integer' });
  }
  return { amountMinor: converted, currency };
}

export function commissionFor(trip: Money): Money {
  assertMoney(trip);
  const commission =
    (BigInt(trip.amountMinor) * BigInt(COMMISSION_RATE_BPS) + ROUNDING_OFFSET) / BPS_DIVISOR;
  return safeMoney(commission, trip.currency);
}

export interface ComputeNetPayoutInput {
  trip: Money;
  recordedFees: Money[];
  typedFeesTotal?: Money;
}

export interface NetPayout {
  trip: Money;
  commission: Money;
  feesTotal: Money;
  net: Money;
}

function assertFeeCurrencies(input: ComputeNetPayoutInput): void {
  const { trip, recordedFees, typedFeesTotal } = input;
  for (const fee of recordedFees) {
    assertMoney(fee, { allowZero: true });
  }
  if (typedFeesTotal !== undefined) {
    assertMoney(typedFeesTotal, { allowZero: true });
  }
  assertSameCurrency(trip, ...recordedFees, ...(typedFeesTotal === undefined ? [] : [typedFeesTotal]));
}

function sumRecordedFees(trip: Money, recordedFees: Money[]): Money {
  let total = 0n;
  for (const fee of recordedFees) {
    total += BigInt(fee.amountMinor);
  }
  return safeMoney(total, trip.currency);
}

export function computeNetPayout(input: ComputeNetPayoutInput): NetPayout {
  const { trip, recordedFees, typedFeesTotal } = input;
  assertMoney(trip);
  assertFeeCurrencies(input);

  const feesTotal = sumRecordedFees(trip, recordedFees);
  if (typedFeesTotal !== undefined && typedFeesTotal.amountMinor !== feesTotal.amountMinor) {
    throw new ApiException(
      409,
      'FEE_TOTAL_MISMATCH',
      'processingFeesTotal must equal the recorded processing fees.',
      { recordedFeesTotal: feesTotal },
    );
  }

  const commission = commissionFor(trip);
  const netMinor =
    BigInt(trip.amountMinor) - BigInt(commission.amountMinor) - BigInt(feesTotal.amountMinor);
  if (netMinor < 0n) {
    throw new ApiException(409, 'NET_PAYOUT_NEGATIVE', 'Commission and fees exceed the trip amount.');
  }

  return {
    trip: { amountMinor: trip.amountMinor, currency: trip.currency },
    commission,
    feesTotal,
    net: { amountMinor: Number(netMinor), currency: trip.currency },
  };
}

export type PaymentMethod = 'prepay' | 'escrow' | 'deposit_balance' | 'cash' | 'corporate_credit';

export interface PlanReleaseInput {
  method: PaymentMethod;
  trip: Money;
  recordedFees: Money[];
  typedFeesTotal?: Money;
  shipperFundsReceived: Money[];
}

export type ReleasePlan =
  | {
      kind: 'cash_receivable_only';
      commission: Money;
      farePayoutDue: false;
      commissionSettlement: 'receivable_open';
    }
  | {
      kind: 'payout';
      commission: Money;
      feesTotal: Money;
      net: Money;
      farePayoutDue: true;
      commissionSettlement: 'settled_on_release';
    };

function sumReceived(funds: Money[]): bigint {
  let total = 0n;
  for (const fund of funds) {
    total += BigInt(fund.amountMinor);
  }
  return total;
}

export function planRelease(input: PlanReleaseInput): ReleasePlan {
  const { method, trip, recordedFees, typedFeesTotal, shipperFundsReceived } = input;
  assertMoney(trip);
  assertFeeCurrencies({ trip, recordedFees, typedFeesTotal });
  for (const fund of shipperFundsReceived) {
    assertMoney(fund, { allowZero: true });
  }
  assertSameCurrency(trip, ...shipperFundsReceived);

  if (method === 'cash') {
    return {
      kind: 'cash_receivable_only',
      commission: commissionFor(trip),
      farePayoutDue: false,
      commissionSettlement: 'receivable_open',
    };
  }

  const { commission, feesTotal, net } = computeNetPayout({ trip, recordedFees, typedFeesTotal });
  const received = sumReceived(shipperFundsReceived);
  const tripAmount = BigInt(trip.amountMinor);

  if (received < tripAmount) {
    if (method === 'corporate_credit') {
      throw new ApiException(
        409,
        'CREDIT_PAYMENT_NOT_RECORDED',
        'Corporate credit payout is blocked until the shipper payment is recorded.',
      );
    }
    if (method === 'deposit_balance') {
      throw new ApiException(409, 'BALANCE_NOT_RECEIPTED', 'The unreceipted balance is not payable.', {
        receivedAmount: safeMoney(received, trip.currency),
        tripAmount: { amountMinor: trip.amountMinor, currency: trip.currency },
      });
    }
    throw new ApiException(
      409,
      'FUNDS_NOT_RECEIVED',
      'Shipper funds for this trip have not been recorded.',
    );
  }

  return {
    kind: 'payout',
    commission,
    feesTotal,
    net,
    farePayoutDue: true,
    commissionSettlement: 'settled_on_release',
  };
}

export type ArrangementSnapshot = {
  method: PaymentMethod;
  arrangementStatus: 'proposed' | 'confirmed' | 'rejected' | 'cancelled';
  protectionStatus: 'none' | 'pending_evidence' | 'protected' | 'protection_failed' | 'released_from_protection';
};

export function assertBookingConfirmable(arrangements: ArrangementSnapshot[]): void {
  const confirmed = arrangements.filter((arrangement) => arrangement.arrangementStatus === 'confirmed');

  if (confirmed.length === 0) {
    throw new ApiException(
      409,
      'BOOKING_CONFIRM_REQUIRES_ARRANGEMENT',
      'A confirmed payment arrangement is required before the booking can be confirmed.',
    );
  }

  if (confirmed.length > 1) {
    throw new ApiException(
      409,
      'MULTIPLE_CONFIRMED_ARRANGEMENTS',
      'Only one payment arrangement can be confirmed.',
    );
  }

  const [arrangement] = confirmed;
  if (arrangement.method === 'cash' && arrangement.protectionStatus !== 'none') {
    throw new ApiException(
      409,
      'CASH_NOT_PROTECTED',
      'Cash payments are recorded but never payment-protected.',
    );
  }
}

export function isPaymentProtected(arrangement: ArrangementSnapshot): boolean {
  if (arrangement.method === 'cash') {
    return false;
  }
  return arrangement.protectionStatus === 'protected';
}
