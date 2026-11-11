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
  b.completion_status AS "completionStatus",
  b.agreed_amount_minor AS "agreedAmountMinor",
  b.currency,
  b.commission_rate_bps AS "commissionRateBps",
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
    commissionRateBps: 500,
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
