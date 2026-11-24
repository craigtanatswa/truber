import { randomUUID } from 'crypto';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiException } from '../common/api.exception';
import { DbService } from '../db/db.service';
import { BookingStatus, CompletionStatus, DbUser, TripStatus } from '../domain';
import { BOOKING_RETURNING, DISPUTE_RETURNING } from './booking.presenter';
import { BookingPaymentMethod } from './payment-arrangement-gate';

export interface BookingRecord extends QueryResultRow {
  id: string;
  loadId: string;
  quotationId: string;
  shipperCompanyId: string;
  transporterCompanyId: string;
  truckId: string | null;
  status: BookingStatus;
  tripStatus: TripStatus;
  completionStatus: CompletionStatus;
  storedCompletionStatus: CompletionStatus;
  agreedAmountMinor: number;
  adjustedAgreedAmountMinor: number | null;
  currency: string;
  commissionRateBps: number;
  deliveryConfirmedAt: Date | string | null;
  disputeWindowEndsAt: Date | string | null;
  lockedAt: Date | string | null;
  confirmedPaymentArrangementId: string | null;
  confirmedAt: Date | string | null;
  paymentMethod: BookingPaymentMethod | null;
  commissionRecognisedAt: Date | string | null;
  cancelledAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface DisputeRecord extends QueryResultRow {
  id: string;
  bookingId: string;
  stage: 'at_delivery_confirmation' | 'dispute_window';
  raisedByUserId: string;
  reason: string;
  evidence: unknown;
  proposedAmountMinor: number | null;
  currency: string;
  status: 'awaiting_transporter_response' | 'transporter_responded' | 'settled' | 'resolved';
  openedAt: Date | string;
  responseDueAt: Date | string;
  responseByUserId: string | null;
  respondedAt: Date | string | null;
  responseStatement: string | null;
  responseEvidence: unknown;
  counterOfferAmountMinor: number | null;
  settlementAmountMinor: number | null;
  settlementAcceptedByUserId: string | null;
  settlementAcceptedAt: Date | string | null;
  settlementAdjustmentId: string | null;
  resolutionOutcome: 'complete_trip' | 'adjust_amount' | 'cancel_trip' | null;
  resolutionReason: string | null;
  resolutionAdjustedAmountMinor: number | null;
  resolutionAdjustmentId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | string | null;
  closedAt: Date | string | null;
}

export const BOOKING_RECORD = `
  ${BOOKING_RETURNING},
  b.completion_status AS "storedCompletionStatus",
  b.payment_method AS "paymentMethod",
  b.commission_recognised_at AS "commissionRecognisedAt",
  b.cancelled_at AS "cancelledAt"
`;

export interface PartySides {
  shipper: boolean;
  transporter: boolean;
}

export function isAdmin(actor: DbUser): boolean {
  return actor.role === 'admin';
}

export function effectiveAgreedMinor(booking: BookingRecord): number {
  return booking.adjustedAgreedAmountMinor ?? booking.agreedAmountMinor;
}

export function isOpenDisputeStatus(status: DisputeRecord['status']): boolean {
  return status === 'awaiting_transporter_response' || status === 'transporter_responded';
}

export function isLockedCompletion(booking: BookingRecord): boolean {
  return booking.completionStatus === 'locked';
}

export async function run<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | DbService,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return (client as DbService).query<T>(text, params);
}

export async function isMember(
  client: PoolClient | DbService,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const member = await run(
    client,
    'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
    [companyId, userId],
  );
  return Boolean(member.rowCount);
}

export async function bookingSides(
  client: PoolClient | DbService,
  actor: DbUser,
  booking: BookingRecord,
): Promise<PartySides> {
  if (actor.role === 'admin') {
    return { shipper: false, transporter: false };
  }
  return {
    shipper: await isMember(client, booking.shipperCompanyId, actor.id),
    transporter: await isMember(client, booking.transporterCompanyId, actor.id),
  };
}

export async function assertBookingParty(
  client: PoolClient | DbService,
  actor: DbUser,
  booking: BookingRecord,
): Promise<PartySides> {
  const sides = await bookingSides(client, actor, booking);
  if (actor.role !== 'admin' && !sides.shipper && !sides.transporter) {
    throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
  }
  return sides;
}

export async function fetchBooking(
  client: PoolClient | DbService,
  bookingId: string,
): Promise<BookingRecord | null> {
  const result = await run<BookingRecord>(
    client,
    `SELECT ${BOOKING_RECORD} FROM bookings b WHERE b.id = $1`,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

/**
 * Same lock order as acceptQuotation: the load row first, then the booking row.
 * The unlocked locate exists only to discover the load id; no booking state is trusted
 * until the FOR UPDATE select below.
 */
export async function lockBooking(
  client: PoolClient,
  bookingId: string,
): Promise<BookingRecord | null> {
  const located = await run<{ loadId: string }>(
    client,
    'SELECT load_id AS "loadId" FROM bookings WHERE id = $1',
    [bookingId],
  );
  if (!located.rows[0]) return null;
  await client.query('SELECT id FROM loads WHERE id = $1 FOR UPDATE', [located.rows[0].loadId]);
  const result = await run<BookingRecord>(
    client,
    `SELECT ${BOOKING_RECORD} FROM bookings b WHERE b.id = $1 FOR UPDATE`,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

export async function fetchDispute(
  client: PoolClient | DbService,
  disputeId: string,
): Promise<DisputeRecord | null> {
  const result = await run<DisputeRecord>(
    client,
    `SELECT ${DISPUTE_RETURNING} FROM booking_disputes d WHERE d.id = $1`,
    [disputeId],
  );
  return result.rows[0] ?? null;
}

export async function lockDispute(client: PoolClient, disputeId: string): Promise<DisputeRecord | null> {
  const result = await run<DisputeRecord>(
    client,
    `SELECT ${DISPUTE_RETURNING} FROM booking_disputes d WHERE d.id = $1 FOR UPDATE`,
    [disputeId],
  );
  return result.rows[0] ?? null;
}

export async function findOpenDisputeForBooking(
  client: PoolClient,
  bookingId: string,
): Promise<DisputeRecord | null> {
  const result = await run<DisputeRecord>(
    client,
    `SELECT ${DISPUTE_RETURNING}
     FROM booking_disputes d
     WHERE d.booking_id = $1
       AND d.status IN ('awaiting_transporter_response', 'transporter_responded')
     ORDER BY d.opened_at DESC
     LIMIT 1
     FOR UPDATE`,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

export async function dbNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0].now;
}

export async function recordBookingEvent(
  client: PoolClient,
  input: {
    bookingId: string;
    action:
      | 'trip_status'
      | 'confirmed'
      | 'admin_confirm_override'
      | 'cancelled'
      | 'delivery_accepted'
      | 'delivery_disputed'
      | 'dispute_opened'
      | 'dispute_responded'
      | 'dispute_settled'
      | 'dispute_resolved'
      | 'adjustment_recorded';
    actorUserId: string;
    reason?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO booking_events (
       id, booking_id, action, actor_user_id, reason, detail, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, clock_timestamp())`,
    [
      randomUUID(),
      input.bookingId,
      input.action,
      input.actorUserId,
      input.reason ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
