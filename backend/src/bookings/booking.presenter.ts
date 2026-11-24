import { QueryResultRow } from 'pg';
import { iso } from '../common/crypto';
import {
  BookingDisputeResponse,
  BookingResponse,
  DeliveryConfirmationResponse,
  DisputeEvidenceResponse,
  MoneyResponse,
} from '../domain';

export const BOOKING_RETURNING = `
  b.id,
  b.load_id AS "loadId",
  b.quotation_id AS "quotationId",
  b.shipper_company_id AS "shipperCompanyId",
  b.transporter_company_id AS "transporterCompanyId",
  b.truck_id AS "truckId",
  b.status,
  b.trip_status AS "tripStatus",
  CASE
    WHEN b.completion_status = 'completed' AND b.dispute_window_ends_at <= clock_timestamp() THEN 'locked'
    ELSE b.completion_status
  END AS "completionStatus",
  b.agreed_amount_minor AS "agreedAmountMinor",
  b.adjusted_agreed_amount_minor AS "adjustedAgreedAmountMinor",
  b.currency,
  b.commission_rate_bps AS "commissionRateBps",
  b.delivery_confirmed_at AS "deliveryConfirmedAt",
  b.dispute_window_ends_at AS "disputeWindowEndsAt",
  CASE
    WHEN (b.completion_status = 'completed' AND b.dispute_window_ends_at <= clock_timestamp())
      OR b.completion_status = 'locked'
      THEN COALESCE(b.locked_at, b.dispute_window_ends_at)
    ELSE b.locked_at
  END AS "lockedAt",
  b.confirmed_payment_arrangement_id AS "confirmedPaymentArrangementId",
  b.confirmed_at AS "confirmedAt",
  b.created_at AS "createdAt",
  b.updated_at AS "updatedAt"
`;

export function presentBooking(row: QueryResultRow): BookingResponse {
  return {
    id: String(row.id),
    loadId: String(row.loadId),
    quotationId: String(row.quotationId),
    shipperCompanyId: String(row.shipperCompanyId),
    transporterCompanyId: String(row.transporterCompanyId),
    truckId: row.truckId == null ? null : String(row.truckId),
    status: row.status as BookingResponse['status'],
    tripStatus: row.tripStatus as BookingResponse['tripStatus'],
    completionStatus: row.completionStatus as BookingResponse['completionStatus'],
    agreedAmount: {
      amountMinor: Number(row.agreedAmountMinor),
      currency: String(row.currency),
    },
    adjustedAgreedAmount:
      row.adjustedAgreedAmountMinor == null
        ? null
        : {
            amountMinor: Number(row.adjustedAgreedAmountMinor),
            currency: String(row.currency),
          },
    commissionRateBps: 500,
    deliveryConfirmedAt:
      row.deliveryConfirmedAt == null ? null : iso(asTimestamp(row.deliveryConfirmedAt)),
    disputeWindowEndsAt:
      row.disputeWindowEndsAt == null ? null : iso(asTimestamp(row.disputeWindowEndsAt)),
    lockedAt: row.lockedAt == null ? null : iso(asTimestamp(row.lockedAt)),
    confirmedPaymentArrangementId:
      row.confirmedPaymentArrangementId == null ? null : String(row.confirmedPaymentArrangementId),
    confirmedAt: row.confirmedAt == null ? null : iso(asTimestamp(row.confirmedAt)),
    createdAt: iso(asTimestamp(row.createdAt)),
    updatedAt: iso(asTimestamp(row.updatedAt)),
  };
}

export const DELIVERY_CONFIRMATION_RETURNING = `
  dc.booking_id AS "bookingId",
  dc.decision,
  dc.notes,
  dc.confirmed_by_user_id AS "confirmedByUserId",
  dc.confirmed_at AS "confirmedAt"
`;

export function presentDeliveryConfirmation(row: QueryResultRow): DeliveryConfirmationResponse {
  return {
    bookingId: String(row.bookingId),
    decision: row.decision as DeliveryConfirmationResponse['decision'],
    notes: row.notes == null ? null : String(row.notes),
    confirmedByUserId: String(row.confirmedByUserId),
    confirmedAt: iso(asTimestamp(row.confirmedAt)),
  };
}

export const DISPUTE_RETURNING = `
  d.id,
  d.booking_id AS "bookingId",
  d.stage,
  d.raised_by_user_id AS "raisedByUserId",
  d.reason,
  d.evidence,
  d.proposed_amount_minor AS "proposedAmountMinor",
  d.currency,
  d.status,
  d.opened_at AS "openedAt",
  d.response_due_at AS "responseDueAt",
  d.response_by_user_id AS "responseByUserId",
  d.responded_at AS "respondedAt",
  d.response_statement AS "responseStatement",
  d.response_evidence AS "responseEvidence",
  d.counter_offer_amount_minor AS "counterOfferAmountMinor",
  d.settlement_amount_minor AS "settlementAmountMinor",
  d.settlement_accepted_by_user_id AS "settlementAcceptedByUserId",
  d.settlement_accepted_at AS "settlementAcceptedAt",
  d.settlement_adjustment_id AS "settlementAdjustmentId",
  d.resolution_outcome AS "resolutionOutcome",
  d.resolution_reason AS "resolutionReason",
  d.resolution_adjusted_amount_minor AS "resolutionAdjustedAmountMinor",
  d.resolution_adjustment_id AS "resolutionAdjustmentId",
  d.resolved_by_user_id AS "resolvedByUserId",
  d.resolved_at AS "resolvedAt",
  d.closed_at AS "closedAt"
`;

export function presentDispute(row: QueryResultRow): BookingDisputeResponse {
  const currency = String(row.currency);
  return {
    id: String(row.id),
    bookingId: String(row.bookingId),
    stage: row.stage as BookingDisputeResponse['stage'],
    raisedByUserId: String(row.raisedByUserId),
    reason: String(row.reason),
    evidence: presentEvidence(row.evidence),
    proposedAmount:
      row.proposedAmountMinor == null
        ? null
        : { amountMinor: Number(row.proposedAmountMinor), currency },
    status: row.status as BookingDisputeResponse['status'],
    openedAt: iso(asTimestamp(row.openedAt)),
    responseDueAt: iso(asTimestamp(row.responseDueAt)),
    response:
      row.responseByUserId == null
        ? null
        : {
            respondedByUserId: String(row.responseByUserId),
            respondedAt: iso(asTimestamp(row.respondedAt)),
            statement: String(row.responseStatement),
            evidence: presentEvidence(row.responseEvidence),
            counterOfferAmount:
              row.counterOfferAmountMinor == null
                ? null
                : { amountMinor: Number(row.counterOfferAmountMinor), currency },
          },
    settlement:
      row.settlementAmountMinor == null
        ? null
        : {
            amount: { amountMinor: Number(row.settlementAmountMinor), currency },
            acceptedByUserId: String(row.settlementAcceptedByUserId),
            acceptedAt: iso(asTimestamp(row.settlementAcceptedAt)),
            adjustmentId: row.settlementAdjustmentId == null ? null : String(row.settlementAdjustmentId),
          },
    resolution:
      row.resolutionOutcome == null
        ? null
        : {
            outcome: row.resolutionOutcome as NonNullable<BookingDisputeResponse['resolution']>['outcome'],
            reason: String(row.resolutionReason),
            adjustedAgreedAmount:
              row.resolutionAdjustedAmountMinor == null
                ? null
                : { amountMinor: Number(row.resolutionAdjustedAmountMinor), currency },
            resolvedAt: iso(asTimestamp(row.resolvedAt)),
          },
    closedAt: row.closedAt == null ? null : iso(asTimestamp(row.closedAt)),
  };
}

function presentEvidence(value: unknown): DisputeEvidenceResponse[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const evidence = item as { kind: DisputeEvidenceResponse['kind']; uri: string; note?: unknown };
    const presented: DisputeEvidenceResponse = { kind: evidence.kind, uri: String(evidence.uri) };
    if (evidence.note != null) presented.note = String(evidence.note);
    return presented;
  });
}

function asTimestamp(value: unknown): Date | string {
  if (value instanceof Date || typeof value === 'string') return value;
  throw new Error('Expected a timestamp value');
}

export function money(amountMinor: number, currency: string): MoneyResponse {
  return { amountMinor, currency };
}
