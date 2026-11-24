import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';

export type BookingPaymentMethod = 'prepay' | 'escrow' | 'deposit_balance' | 'cash' | 'corporate_credit';

export interface ConfirmedArrangement {
  arrangementId: string;
  method: BookingPaymentMethod;
}

/**
 * Billing seam for the payment-arrangement confirmation gate.
 *
 * TODO: bind Jensen's PaymentArrangementService (v0.6.0) here. It mirrors the planned
 * `PaymentArrangementService.assertConfirmed(client, bookingId)` and must only return an
 * arrangement that the server has confirmed (method-specific protection rules included).
 */
export abstract class PaymentArrangementGate {
  abstract assertConfirmed(client: PoolClient, bookingId: string): Promise<ConfirmedArrangement>;
}

@Injectable()
export class NoPaymentArrangementsGate extends PaymentArrangementGate {
  override async assertConfirmed(_client: PoolClient, _bookingId: string): Promise<ConfirmedArrangement> {
    throw new ApiException(
      409,
      'BOOKING_CONFIRM_REQUIRES_ARRANGEMENT',
      'A confirmed payment arrangement is required before the booking can be confirmed.',
      { state: 'none' },
    );
  }
}
