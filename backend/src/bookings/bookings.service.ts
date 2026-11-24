import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { sha256 } from '../common/crypto';
import { pageMeta, pageWindow } from '../common/http';
import {
  assertIdempotencyKey,
  readIdempotency,
  storeIdempotency,
} from '../common/idempotency';
import { DbService } from '../db/db.service';
import { BookingResponse, DbUser, DeliveryConfirmationResponse } from '../domain';
import { OffPlatformBanService } from '../offplatform/offplatform-ban.service';
import { NewWorkCommissionGate } from '../quotations/commission-gate';
import {
  BookingBillingHooks,
  HookCommissionAdjustment,
  Money,
} from './booking-billing-hooks';
import { BookingNotifications } from './booking-notifications';
import {
  BOOKING_RECORD,
  BookingRecord,
  assertBookingParty,
  dbNow,
  effectiveAgreedMinor,
  fetchBooking,
  isLockedCompletion,
  lockBooking,
  recordBookingEvent,
  run,
} from './booking-support';
import { CancelBookingDto, ConfirmBookingDto, ConfirmDeliveryDto, ListBookingsQueryDto, RecordBookingAdjustmentDto, UpdateTripStatusDto } from './bookings.dto';
import { DELIVERY_CONFIRMATION_RETURNING, presentBooking, presentDeliveryConfirmation } from './booking.presenter';
import { PaymentArrangementGate } from './payment-arrangement-gate';
import { ProofOfDeliveryCheck } from './proof-of-delivery-check';

const NEXT_TRIP_STATUS: Record<string, string | null> = {
  not_started: 'truck_dispatched',
  truck_dispatched: 'goods_collected',
  goods_collected: 'in_transit',
  in_transit: 'delivered',
  delivered: null,
};

const LOAD_STATUS_FOR_TRIP: Record<string, string> = {
  truck_dispatched: 'in_progress',
  goods_collected: 'in_progress',
  in_transit: 'in_progress',
  delivered: 'awaiting_shipper_acceptance',
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly db: DbService,
    private readonly bans: OffPlatformBanService,
    private readonly commissionGate: NewWorkCommissionGate,
    private readonly arrangementGate: PaymentArrangementGate,
    private readonly podCheck: ProofOfDeliveryCheck,
    private readonly billing: BookingBillingHooks,
    private readonly notifications: BookingNotifications,
  ) {}

  async list(
    actor: DbUser,
    query: ListBookingsQueryDto,
  ): Promise<{ data: BookingResponse[]; meta: ReturnType<typeof pageMeta> }> {
    const window = pageWindow(query.page, query.pageSize);
    const params: unknown[] = [];
    const where: string[] = [];
    if (actor.role !== 'admin') {
      params.push(actor.id);
      where.push(`(
        b.shipper_company_id IN (SELECT company_id FROM company_members WHERE user_id = $${params.length})
        OR b.transporter_company_id IN (SELECT company_id FROM company_members WHERE user_id = $${params.length})
      )`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`b.status = $${params.length}`);
    }
    if (query.companyId) {
      params.push(query.companyId);
      where.push(`(b.shipper_company_id = $${params.length} OR b.transporter_company_id = $${params.length})`);
    }
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await run<{ total: number }>(
      this.db,
      `SELECT count(*)::int AS total FROM bookings b WHERE ${clause}`,
      params,
    );
    const rows = await run(
      this.db,
      `SELECT ${BOOKING_RECORD}
       FROM bookings b
       WHERE ${clause}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentBooking(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async get(actor: DbUser, bookingId: string): Promise<BookingResponse> {
    const booking = await fetchBooking(this.db, bookingId);
    if (!booking) {
      throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
    }
    await assertBookingParty(this.db, actor, booking);
    return presentBooking(booking);
  }

  async updateTripStatus(
    actor: DbUser,
    bookingId: string,
    dto: UpdateTripStatusDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const note = dto.note?.trim() ? dto.note.trim() : null;
    const requestHash = sha256(
      JSON.stringify({ op: 'updateBookingTripStatus', bookingId, tripStatus: dto.tripStatus, note }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingResponse>(
        client,
        actor.id,
        idempotencyKey,
        'updateBookingTripStatus',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role === 'admin' || !sides.transporter || actor.role !== 'transporter') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the transporter can update trip status.');
      }
      if (booking.status !== 'confirmed') {
        throw new ApiException(409, 'BOOKING_NOT_CONFIRMED', 'This booking is not confirmed.');
      }
      if (
        booking.completionStatus === 'completed' ||
        booking.completionStatus === 'locked' ||
        booking.completionStatus === 'disputed' ||
        booking.completionStatus === 'cancelled'
      ) {
        throw new ApiException(409, 'INVALID_TRIP_TRANSITION', 'This trip can no longer be advanced.');
      }
      if (NEXT_TRIP_STATUS[booking.tripStatus] !== dto.tripStatus) {
        throw new ApiException(409, 'INVALID_TRIP_TRANSITION', 'Trip status must advance exactly one step.');
      }

      await client.query(
        `UPDATE bookings
         SET trip_status = $2,
             completion_status = CASE WHEN $2 = 'delivered' THEN 'awaiting_shipper_acceptance' ELSE completion_status END,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [bookingId, dto.tripStatus],
      );
      await client.query(
        `UPDATE loads SET status = $2, updated_at = clock_timestamp() WHERE id = $1`,
        [booking.loadId, LOAD_STATUS_FOR_TRIP[dto.tripStatus]],
      );
      await recordBookingEvent(client, {
        bookingId,
        action: 'trip_status',
        actorUserId: actor.id,
        reason: note,
        detail: { tripStatus: dto.tripStatus },
      });

      const body = await this.fetchPresentedBooking(client, bookingId);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'updateBookingTripStatus',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }

  async confirm(
    actor: DbUser,
    bookingId: string,
    dto: ConfirmBookingDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const auditOverrideReason = dto.auditOverrideReason?.trim() || null;
    const requestHash = sha256(
      JSON.stringify({ op: 'confirmBooking', bookingId, auditOverrideReason }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingResponse>(
        client,
        actor.id,
        idempotencyKey,
        'confirmBooking',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      const isAdminCaller = actor.role === 'admin';
      if (!isAdminCaller) {
        if (!sides.shipper || sides.transporter || actor.role !== 'shipper') {
          throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the shipper can confirm this booking.');
        }
        if (auditOverrideReason !== null) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
            fields: { auditOverrideReason: 'only an admin may provide an override reason' },
          });
        }
      } else if (auditOverrideReason === null) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
          fields: { auditOverrideReason: 'is required when an admin confirms a booking' },
        });
      }
      if (booking.status !== 'pending_payment_arrangement') {
        throw new ApiException(409, 'BOOKING_NOT_PENDING', 'This booking is not awaiting confirmation.');
      }

      if (isAdminCaller) {
        await this.bans.assertNotBanned(actor.id, null, {
          client,
          counterpartyCompanyId: booking.shipperCompanyId,
        });
        await this.bans.assertNotBanned(actor.id, null, {
          client,
          counterpartyCompanyId: booking.transporterCompanyId,
        });
      } else {
        await this.bans.assertNotBanned(actor.id, booking.shipperCompanyId, {
          client,
          counterpartyCompanyId: booking.transporterCompanyId,
        });
      }
      await this.commissionGate.assertCanTakeNewWork(client, booking.transporterCompanyId);
      const arrangement = await this.arrangementGate.assertConfirmed(client, bookingId);

      await client.query(
        `UPDATE bookings
         SET status = 'confirmed',
             confirmed_payment_arrangement_id = $2,
             confirmed_at = clock_timestamp(),
             payment_method = $3,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [bookingId, arrangement.arrangementId, arrangement.method],
      );
      await client.query(
        `UPDATE loads SET status = 'booked', updated_at = clock_timestamp() WHERE id = $1`,
        [booking.loadId],
      );
      await recordBookingEvent(client, {
        bookingId,
        action: isAdminCaller ? 'admin_confirm_override' : 'confirmed',
        actorUserId: actor.id,
        reason: auditOverrideReason,
        detail: {
          arrangementId: arrangement.arrangementId,
          paymentMethod: arrangement.method,
        },
      });

      const body = await this.fetchPresentedBooking(client, bookingId);
      await storeIdempotency(client, actor.id, idempotencyKey, 'confirmBooking', requestHash, 200, body);
      return { status: 200, body };
    });
  }

  async cancel(
    actor: DbUser,
    bookingId: string,
    dto: CancelBookingDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { reason: 'must not be blank' },
      });
    }
    const beforeCollection = dto.beforeCollection ?? true;
    const requestHash = sha256(
      JSON.stringify({ op: 'cancelBooking', bookingId, reason, beforeCollection }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingResponse>(
        client,
        actor.id,
        idempotencyKey,
        'cancelBooking',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role !== 'admin') {
        if (sides.shipper || sides.transporter) {
          throw new ApiException(
            409,
            'SELF_CANCEL_NOT_ALLOWED',
            'This booking can only be cancelled by Truber admin. Contact support.',
            { bookingId: booking.id, bookingStatus: booking.status },
          );
        }
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      if (booking.status === 'cancelled') {
        throw new ApiException(409, 'BOOKING_ALREADY_CANCELLED', 'This booking is already cancelled.');
      }
      if (booking.completionStatus === 'disputed') {
        throw new ApiException(409, 'DISPUTE_OPEN', 'Resolve the open dispute before cancelling this booking.');
      }
      if (isLockedCompletion(booking)) {
        throw new ApiException(409, 'COMMISSION_FINAL', 'The trip is locked; record an adjustment instead.');
      }

      const updated = await run<{ cancelledAt: Date | string }>(
        client,
        `UPDATE bookings
         SET status = 'cancelled',
             cancelled_at = clock_timestamp(),
             cancelled_by_user_id = $2,
             cancel_reason = $3,
             before_collection = $4,
             completion_status = 'cancelled',
             updated_at = clock_timestamp()
         WHERE id = $1
         RETURNING cancelled_at AS "cancelledAt"`,
        [bookingId, actor.id, reason, beforeCollection],
      );
      await client.query(
        `UPDATE loads SET status = 'cancelled', updated_at = clock_timestamp() WHERE id = $1`,
        [booking.loadId],
      );
      if (booking.commissionRecognisedAt != null) {
        await this.billing.voidForBooking(client, bookingId, {
          at: new Date(updated.rows[0].cancelledAt),
        });
      }
      await recordBookingEvent(client, {
        bookingId,
        action: 'cancelled',
        actorUserId: actor.id,
        reason,
        detail: { beforeCollection },
      });

      const body = await this.fetchPresentedBooking(client, bookingId);
      await storeIdempotency(client, actor.id, idempotencyKey, 'cancelBooking', requestHash, 200, body);
      return { status: 200, body };
    });
  }

  async getDeliveryConfirmation(
    actor: DbUser,
    bookingId: string,
  ): Promise<DeliveryConfirmationResponse> {
    const booking = await fetchBooking(this.db, bookingId);
    if (!booking) {
      throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
    }
    await assertBookingParty(this.db, actor, booking);
    const result = await run(
      this.db,
      `SELECT ${DELIVERY_CONFIRMATION_RETURNING}
       FROM delivery_confirmations dc
       WHERE dc.booking_id = $1`,
      [bookingId],
    );
    if (!result.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Delivery confirmation not found.');
    }
    return presentDeliveryConfirmation(result.rows[0]);
  }

  async confirmDelivery(
    actor: DbUser,
    bookingId: string,
    dto: ConfirmDeliveryDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: DeliveryConfirmationResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const notes = dto.notes?.trim() ? dto.notes.trim() : null;
    const requestHash = sha256(
      JSON.stringify({ op: 'confirmDelivery', bookingId, decision: dto.decision, notes }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<DeliveryConfirmationResponse>(
        client,
        actor.id,
        idempotencyKey,
        'confirmDelivery',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role === 'admin' || !sides.shipper || actor.role !== 'shipper') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the shipper can confirm delivery.');
      }
      if (booking.status !== 'confirmed') {
        throw new ApiException(409, 'BOOKING_NOT_CONFIRMED', 'This booking is not confirmed.');
      }
      const existing = await run(
        client,
        'SELECT 1 FROM delivery_confirmations WHERE booking_id = $1',
        [bookingId],
      );
      if (existing.rowCount) {
        throw new ApiException(409, 'DELIVERY_ALREADY_CONFIRMED', 'Delivery has already been confirmed.');
      }
      if (
        booking.completionStatus !== 'not_complete' &&
        booking.completionStatus !== 'awaiting_shipper_acceptance'
      ) {
        throw new ApiException(409, 'INVALID_COMPLETION_STATE', 'Delivery cannot be confirmed in this state.');
      }
      if (!(await this.podCheck.hasArtifact(client, bookingId))) {
        throw new ApiException(
          409,
          'POD_REQUIRED',
          'A proof-of-delivery artifact is required before delivery can be confirmed.',
        );
      }

      if (dto.decision === 'disputed') {
        if (notes === null || notes.length < 10) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
            fields: { notes: 'must be at least 10 characters when delivery is disputed' },
          });
        }
        const now = await dbNow(client);
        const dispute = await client.query<{ id: string }>(
          `INSERT INTO booking_disputes (
             id, booking_id, stage, raised_by_user_id, reason, evidence, proposed_amount_minor,
             currency, status, opened_at, response_due_at
           ) VALUES (
             $1, $2, 'at_delivery_confirmation', $3, $4, '[]'::jsonb, NULL,
             $5, 'awaiting_transporter_response', $6, $6::timestamptz + interval '48 hours'
           )
           RETURNING id`,
          [randomUUID(), bookingId, actor.id, notes, booking.currency, now],
        );
        const disputeId = dispute.rows[0].id;
        await client.query(
          `UPDATE bookings
           SET completion_status = 'disputed', updated_at = $2
           WHERE id = $1`,
          [bookingId, now],
        );
        await this.notifications.record(client, {
          type: 'dispute_opened',
          bookingId,
          disputeId,
          recipientCompanyIds: [booking.transporterCompanyId],
        });
        await recordBookingEvent(client, {
          bookingId,
          action: 'delivery_disputed',
          actorUserId: actor.id,
          reason: notes,
          detail: { disputeId },
        });
      } else {
        const now = await dbNow(client);
        const updated = await run<{ deliveryConfirmedAt: Date | string; disputeWindowEndsAt: Date | string }>(
          client,
          `UPDATE bookings
           SET completion_status = 'completed',
               delivery_confirmed_at = $2,
               dispute_window_ends_at = $2::timestamptz + interval '24 hours',
               commission_recognised_at = $2,
               updated_at = $2
           WHERE id = $1
           RETURNING delivery_confirmed_at AS "deliveryConfirmedAt",
                     dispute_window_ends_at AS "disputeWindowEndsAt"`,
          [bookingId, now],
        );
        await client.query(
          `UPDATE loads SET status = 'completed', updated_at = $2 WHERE id = $1`,
          [booking.loadId, now],
        );
        await this.billing.recognise(client, {
          bookingId,
          transporterCompanyId: booking.transporterCompanyId,
          tripAmount: { amountMinor: effectiveAgreedMinor(booking), currency: booking.currency },
          paymentMethod: booking.paymentMethod as NonNullable<BookingRecord['paymentMethod']>,
          completedAt: now,
        });
        await recordBookingEvent(client, {
          bookingId,
          action: 'delivery_accepted',
          actorUserId: actor.id,
          detail: {
            deliveryConfirmedAt: new Date(updated.rows[0].deliveryConfirmedAt).toISOString(),
            disputeWindowEndsAt: new Date(updated.rows[0].disputeWindowEndsAt).toISOString(),
          },
        });
      }

      await client.query(
        `INSERT INTO delivery_confirmations (
           booking_id, decision, notes, confirmed_by_user_id, confirmed_at
         ) VALUES ($1, $2, $3, $4, clock_timestamp())`,
        [bookingId, dto.decision, notes, actor.id],
      );

      const confirmation = await run(
        client,
        `SELECT ${DELIVERY_CONFIRMATION_RETURNING}
         FROM delivery_confirmations dc
         WHERE dc.booking_id = $1`,
        [bookingId],
      );
      const body = presentDeliveryConfirmation(confirmation.rows[0]);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'confirmDelivery',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }

  async recordAdjustment(
    actor: DbUser,
    bookingId: string,
    dto: RecordBookingAdjustmentDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: HookCommissionAdjustment }> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(
      JSON.stringify({
        op: 'recordBookingAdjustment',
        bookingId,
        adjustedAgreedAmount: {
          amountMinor: dto.adjustedAgreedAmount.amountMinor,
          currency: dto.adjustedAgreedAmount.currency,
        },
        reason: dto.reason,
        disputeId: dto.disputeId ?? null,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<HookCommissionAdjustment>(
        client,
        actor.id,
        idempotencyKey,
        'recordBookingAdjustment',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      await assertBookingParty(client, actor, booking);
      if (actor.role !== 'admin') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only an admin can record an adjustment.');
      }
      if (booking.completionStatus === 'disputed') {
        throw new ApiException(409, 'DISPUTE_OPEN', 'Resolve the open dispute before recording an adjustment.');
      }
      if (!isLockedCompletion(booking)) {
        throw new ApiException(409, 'BOOKING_NOT_LOCKED', 'The trip must be locked before it can be adjusted.');
      }

      const amount = dto.adjustedAgreedAmount.amountMinor;
      const effective = effectiveAgreedMinor(booking);
      if (dto.adjustedAgreedAmount.currency !== booking.currency) {
        throw new ApiException(409, 'CURRENCY_MISMATCH', 'The adjusted amount must use the booking currency.');
      }
      if (amount > effective) {
        throw new ApiException(
          409,
          'ADJUSTMENT_INCREASE_NOT_ALLOWED',
          'The adjusted amount cannot be higher than the current effective agreed amount.',
        );
      }
      if (amount === effective) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
          fields: { adjustedAgreedAmount: 'must be lower than the current effective agreed amount' },
        });
      }
      if (dto.disputeId) {
        const dispute = await run(
          client,
          'SELECT 1 FROM booking_disputes WHERE id = $1 AND booking_id = $2',
          [dto.disputeId, bookingId],
        );
        if (!dispute.rowCount) {
          throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
        }
      }

      const now = await dbNow(client);
      const newTripAmount: Money = { amountMinor: amount, currency: booking.currency };
      const result = await this.billing.adjustForResolvedDispute(client, {
        bookingId,
        disputeRef: dto.disputeId,
        source: 'admin_decision',
        newTripAmount,
        reason: dto.reason.trim(),
        actorUserId: actor.id,
        decidedAt: now,
        idempotencyKey: idempotencyKey ?? `adjustment:${randomUUID()}`,
      });
      if (!result) {
        throw new ApiException(
          409,
          'BILLING_NOT_AVAILABLE',
          'Commission records are not available yet; the adjustment was not recorded.',
        );
      }

      await client.query(
        `UPDATE bookings
         SET adjusted_agreed_amount_minor = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [bookingId, amount],
      );
      await recordBookingEvent(client, {
        bookingId,
        action: 'adjustment_recorded',
        actorUserId: actor.id,
        reason: dto.reason.trim(),
        detail: {
          adjustmentId: result.adjustment.id,
          adjustedAgreedAmount: amount,
          disputeId: dto.disputeId ?? null,
        },
      });

      const body = result.adjustment;
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'recordBookingAdjustment',
        requestHash,
        201,
        body,
      );
      return { status: 201, body };
    });
  }

  private async fetchPresentedBooking(client: PoolClient, bookingId: string): Promise<BookingResponse> {
    const result = await run(client, `SELECT ${BOOKING_RECORD} FROM bookings b WHERE b.id = $1`, [bookingId]);
    if (!result.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
    }
    return presentBooking(result.rows[0]);
  }
}
