import { QueryResultRow } from 'pg';
import { iso } from '../common/crypto';
import { BookingResponse } from '../domain';

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

function asTimestamp(value: unknown): Date | string {
  if (value instanceof Date || typeof value === 'string') return value;
  throw new Error('Expected a timestamp value');
}
