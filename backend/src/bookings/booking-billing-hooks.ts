import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { BookingPaymentMethod } from './payment-arrangement-gate';

/**
 * Structural mirror of Jensen's ReceivablesService (PR #4, jensen/billing-core 0b70e5c).
 * Local types only: this branch has no billing module to import from.
 *
 * TODO: when #4 merges, bind BookingBillingHooks with a thin adapter over
 * ReceivablesService; the method names and argument shapes already match.
 *
 * TODO: Jensen's voidForBooking currently refuses a `held` receivable, while the contract's
 * `cancel_trip` resolution voids a held one. The adapter must reconcile that before binding.
 */
export interface Money {
  amountMinor: number;
  currency: string;
}

export type DisputeSource = 'party_settlement' | 'admin_decision';

export interface RecogniseReceivableInput {
  bookingId: string;
  transporterCompanyId: string;
  tripAmount: Money;
  paymentMethod: BookingPaymentMethod;
  completedAt?: Date;
}

export interface HoldForDisputeInput {
  bookingId: string;
  disputeRef: string;
  disputedAt: Date;
  responseDeadlineAt?: Date;
}

export interface RecordDisputeResponseInput {
  bookingId: string;
  disputeRef: string;
  respondedAt: Date;
}

export interface FinaliseAfterDisputeInput {
  bookingId: string;
  disputeRef: string;
  source: DisputeSource;
  outcomeReason: string;
  actorUserId: string;
  idempotencyKey: string;
  at?: Date;
}

export interface AdjustForResolvedDisputeInput {
  bookingId: string;
  disputeRef?: string;
  source: DisputeSource;
  newTripAmount: Money;
  reason: string;
  actorUserId: string;
  shipperCompanyId?: string;
  shipperAgreedBy?: string;
  transporterAgreedBy?: string;
  decidedAt: Date;
  idempotencyKey: string;
  disputedAt?: Date;
  transporterRespondedAt?: Date;
}

export interface HookCommissionAdjustment {
  id: string;
  bookingId: string;
  receivableId: string;
  transporterCompanyId: string;
  disputeRef: string | null;
  source: DisputeSource;
  shipperAgreedByUserId: string | null;
  transporterAgreedByUserId: string | null;
  decidedAt: string;
  previousTripAmount: Money;
  newTripAmount: Money;
  previousCommission: Money;
  newCommission: Money;
  reducedOpenAmount: Money;
  creditedAmount: Money;
  reason: string;
  recordedByUserId: string;
  recordedAt: string;
  fundsMovementClaimedByTruber: false;
}

export abstract class BookingBillingHooks {
  abstract recognise(client: PoolClient, input: RecogniseReceivableInput): Promise<unknown>;
  abstract holdForDispute(client: PoolClient, input: HoldForDisputeInput): Promise<unknown>;
  abstract recordDisputeResponse(client: PoolClient, input: RecordDisputeResponseInput): Promise<unknown>;
  abstract finaliseAfterDispute(client: PoolClient, input: FinaliseAfterDisputeInput): Promise<unknown>;
  abstract adjustForResolvedDispute(
    client: PoolClient,
    input: AdjustForResolvedDisputeInput,
  ): Promise<{ adjustment: HookCommissionAdjustment } | null>;
  abstract voidForBooking(client: PoolClient, bookingId: string, opts?: { at?: Date }): Promise<unknown>;
}

@Injectable()
export class NoBillingHooks extends BookingBillingHooks {
  override async recognise(_client: PoolClient, _input: RecogniseReceivableInput): Promise<unknown> {
    return null;
  }

  override async holdForDispute(_client: PoolClient, _input: HoldForDisputeInput): Promise<unknown> {
    return null;
  }

  override async recordDisputeResponse(_client: PoolClient, _input: RecordDisputeResponseInput): Promise<unknown> {
    return null;
  }

  override async finaliseAfterDispute(_client: PoolClient, _input: FinaliseAfterDisputeInput): Promise<unknown> {
    return null;
  }

  override async adjustForResolvedDispute(
    _client: PoolClient,
    _input: AdjustForResolvedDisputeInput,
  ): Promise<{ adjustment: HookCommissionAdjustment } | null> {
    return null;
  }

  override async voidForBooking(
    _client: PoolClient,
    _bookingId: string,
    _opts?: { at?: Date },
  ): Promise<unknown> {
    return null;
  }
}
