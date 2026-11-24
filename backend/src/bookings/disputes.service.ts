import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { sha256 } from '../common/crypto';
import {
  assertIdempotencyKey,
  readIdempotency,
  storeIdempotency,
} from '../common/idempotency';
import { DbService } from '../db/db.service';
import { BookingDisputeResponse, DbUser, DisputeResolutionResponse } from '../domain';
import { BookingBillingHooks, DisputeSource } from './booking-billing-hooks';
import { BookingNotifications } from './booking-notifications';
import { DISPUTE_RETURNING, presentDispute } from './booking.presenter';
import {
  BookingRecord,
  assertBookingParty,
  dbNow,
  effectiveAgreedMinor,
  fetchBooking,
  fetchDispute,
  findOpenDisputeForBooking,
  isOpenDisputeStatus,
  lockBooking,
  lockDispute,
  recordBookingEvent,
  run,
} from './booking-support';
import {
  AcceptDisputeSettlementDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
  RespondToDisputeDto,
} from './bookings.dto';

@Injectable()
export class DisputesService {
  constructor(
    private readonly db: DbService,
    private readonly billing: BookingBillingHooks,
    private readonly notifications: BookingNotifications,
  ) {}

  async raise(
    actor: DbUser,
    bookingId: string,
    dto: RaiseDisputeDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingDisputeResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const reason = dto.reason.trim();
    const evidence = dto.evidence ?? [];
    const requestHash = sha256(
      JSON.stringify({
        op: 'raiseBookingDispute',
        bookingId,
        reason,
        evidence,
        proposedAmount: dto.proposedAmount ?? null,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingDisputeResponse>(
        client,
        actor.id,
        idempotencyKey,
        'raiseBookingDispute',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role === 'admin' || !sides.shipper || actor.role !== 'shipper') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the shipper can open a dispute.');
      }
      if (booking.completionStatus === 'disputed') {
        throw new ApiException(409, 'DISPUTE_ALREADY_OPEN', 'A dispute is already open on this booking.');
      }
      if (booking.completionStatus === 'locked') {
        throw new ApiException(409, 'DISPUTE_WINDOW_CLOSED', 'The dispute window is closed.');
      }
      if (booking.completionStatus !== 'completed') {
        throw new ApiException(409, 'TRIP_NOT_COMPLETED', 'The trip is not completed.');
      }
      const now = await dbNow(client);
      if (
        booking.disputeWindowEndsAt == null ||
        new Date(booking.disputeWindowEndsAt).getTime() <= now.getTime()
      ) {
        throw new ApiException(409, 'DISPUTE_WINDOW_CLOSED', 'The dispute window is closed.');
      }

      if (dto.proposedAmount) {
        if (dto.proposedAmount.currency !== booking.currency) {
          throw new ApiException(409, 'CURRENCY_MISMATCH', 'The proposed amount must use the booking currency.');
        }
        if (dto.proposedAmount.amountMinor > effectiveAgreedMinor(booking)) {
          throw new ApiException(
            409,
            'ADJUSTMENT_INCREASE_NOT_ALLOWED',
            'The proposed amount cannot be higher than the effective agreed amount.',
          );
        }
      }

      const disputeId = randomUUID();
      const inserted = await client.query<{ responseDueAt: Date | string }>(
        `INSERT INTO booking_disputes (
           id, booking_id, stage, raised_by_user_id, reason, evidence, proposed_amount_minor,
           currency, status, opened_at, response_due_at
         ) VALUES (
           $1, $2, 'dispute_window', $3, $4, $5::jsonb, $6,
           $7, 'awaiting_transporter_response', $8, $8::timestamptz + interval '48 hours'
         )
         RETURNING response_due_at AS "responseDueAt"`,
        [
          disputeId,
          bookingId,
          actor.id,
          reason,
          JSON.stringify(evidence),
          dto.proposedAmount?.amountMinor ?? null,
          booking.currency,
          now,
        ],
      );
      await client.query(
        `UPDATE bookings SET completion_status = 'disputed', updated_at = $2 WHERE id = $1`,
        [bookingId, now],
      );
      await this.billing.holdForDispute(client, {
        bookingId,
        disputeRef: disputeId,
        disputedAt: now,
        responseDeadlineAt: new Date(inserted.rows[0].responseDueAt),
      });
      await this.notifications.record(client, {
        type: 'dispute_opened',
        bookingId,
        disputeId,
        recipientCompanyIds: [booking.transporterCompanyId],
      });
      await recordBookingEvent(client, {
        bookingId,
        action: 'dispute_opened',
        actorUserId: actor.id,
        reason,
        detail: { disputeId, stage: 'dispute_window' },
      });

      const body = await this.fetchPresentedDispute(client, disputeId);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'raiseBookingDispute',
        requestHash,
        201,
        body,
      );
      return { status: 201, body };
    });
  }

  async list(actor: DbUser, bookingId: string): Promise<{ data: BookingDisputeResponse[] }> {
    const booking = await fetchBooking(this.db, bookingId);
    if (!booking) {
      throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
    }
    await assertBookingParty(this.db, actor, booking);
    const rows = await run(
      this.db,
      `SELECT ${DISPUTE_RETURNING}
       FROM booking_disputes d
       WHERE d.booking_id = $1
       ORDER BY d.opened_at ASC, d.id ASC`,
      [bookingId],
    );
    return { data: rows.rows.map((row) => presentDispute(row)) };
  }

  async respond(
    actor: DbUser,
    disputeId: string,
    dto: RespondToDisputeDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingDisputeResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const statement = dto.statement.trim();
    const evidence = dto.evidence ?? [];
    const requestHash = sha256(
      JSON.stringify({
        op: 'respondToDispute',
        disputeId,
        statement,
        evidence,
        counterOfferAmount: dto.counterOfferAmount ?? null,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingDisputeResponse>(
        client,
        actor.id,
        idempotencyKey,
        'respondToDispute',
        requestHash,
      );
      if (replay) return replay;

      const located = await fetchDispute(client, disputeId);
      if (!located) {
        throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
      }
      const booking = await lockBooking(client, located.bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role === 'admin' || !sides.transporter || actor.role !== 'transporter') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only the transporter can respond to a dispute.');
      }
      const dispute = await lockDispute(client, disputeId);
      if (!dispute) {
        throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
      }
      if (dispute.status !== 'awaiting_transporter_response') {
        throw new ApiException(
          409,
          'DISPUTE_NOT_AWAITING_RESPONSE',
          'This dispute is not awaiting a transporter response.',
        );
      }
      const now = await dbNow(client);
      if (new Date(dispute.responseDueAt).getTime() <= now.getTime()) {
        throw new ApiException(409, 'DISPUTE_RESPONSE_WINDOW_CLOSED', 'The response window is closed.');
      }
      if (dto.counterOfferAmount) {
        if (dto.counterOfferAmount.currency !== booking.currency) {
          throw new ApiException(409, 'CURRENCY_MISMATCH', 'The counter-offer must use the booking currency.');
        }
        if (dto.counterOfferAmount.amountMinor > effectiveAgreedMinor(booking)) {
          throw new ApiException(
            409,
            'ADJUSTMENT_INCREASE_NOT_ALLOWED',
            'The counter-offer cannot be higher than the effective agreed amount.',
          );
        }
      }

      await client.query(
        `UPDATE booking_disputes
         SET status = 'transporter_responded',
             response_by_user_id = $2,
             responded_at = $3,
             response_statement = $4,
             response_evidence = $5::jsonb,
             counter_offer_amount_minor = $6
         WHERE id = $1`,
        [
          disputeId,
          actor.id,
          now,
          statement,
          JSON.stringify(evidence),
          dto.counterOfferAmount?.amountMinor ?? null,
        ],
      );
      if (booking.commissionRecognisedAt != null) {
        await this.billing.recordDisputeResponse(client, {
          bookingId: booking.id,
          disputeRef: disputeId,
          respondedAt: now,
        });
      }
      await this.notifications.record(client, {
        type: 'dispute_responded',
        bookingId: booking.id,
        disputeId,
        recipientCompanyIds: [booking.shipperCompanyId],
      });
      await recordBookingEvent(client, {
        bookingId: booking.id,
        action: 'dispute_responded',
        actorUserId: actor.id,
        detail: { disputeId },
      });

      const body = await this.fetchPresentedDispute(client, disputeId);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'respondToDispute',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }

  async settle(
    actor: DbUser,
    disputeId: string,
    dto: AcceptDisputeSettlementDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: BookingDisputeResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(
      JSON.stringify({ op: 'acceptDisputeSettlement', disputeId, amount: dto.amount }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<BookingDisputeResponse>(
        client,
        actor.id,
        idempotencyKey,
        'acceptDisputeSettlement',
        requestHash,
      );
      if (replay) return replay;

      const located = await fetchDispute(client, disputeId);
      if (!located) {
        throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
      }
      const booking = await lockBooking(client, located.bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      const sides = await assertBookingParty(client, actor, booking);
      if (actor.role === 'admin') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a booking party can accept a settlement.');
      }
      const side = this.callerSide(actor, sides);
      const dispute = await lockDispute(client, disputeId);
      if (!dispute) {
        throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
      }
      if (!isOpenDisputeStatus(dispute.status)) {
        throw new ApiException(409, 'DISPUTE_NOT_OPEN', 'This dispute is not open.');
      }

      const amount = dto.amount.amountMinor;
      const otherOffer =
        side === 'shipper' ? dispute.counterOfferAmountMinor : dispute.proposedAmountMinor;
      const ownOffer =
        side === 'shipper' ? dispute.proposedAmountMinor : dispute.counterOfferAmountMinor;
      if (otherOffer == null) {
        if (ownOffer != null && ownOffer === amount) {
          throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'A party cannot accept its own offer.');
        }
        throw new ApiException(409, 'NO_OFFER_TO_ACCEPT', 'The other side has not made an offer.');
      }
      if (dto.amount.currency !== booking.currency) {
        throw new ApiException(409, 'CURRENCY_MISMATCH', 'The settlement amount must use the booking currency.');
      }
      const effective = effectiveAgreedMinor(booking);
      if (amount > effective) {
        throw new ApiException(
          409,
          'ADJUSTMENT_INCREASE_NOT_ALLOWED',
          'The settlement amount cannot be higher than the effective agreed amount.',
        );
      }
      if (amount !== otherOffer) {
        throw new ApiException(409, 'SETTLEMENT_AMOUNT_MISMATCH', 'The amount must equal the offer being accepted.');
      }

      const now = await dbNow(client);
      const shipperAgreedBy = side === 'shipper' ? actor.id : dispute.raisedByUserId;
      const transporterAgreedBy = side === 'transporter' ? actor.id : dispute.responseByUserId;
      let adjustmentId: string | null = null;
      let newCommissionAt: Date | null = null;
      let adjustedAmount: number | null = null;

      if (booking.commissionRecognisedAt == null) {
        if (amount < effective) adjustedAmount = amount;
        await this.billing.recognise(client, {
          bookingId: booking.id,
          transporterCompanyId: booking.transporterCompanyId,
          tripAmount: { amountMinor: amount, currency: booking.currency },
          paymentMethod: booking.paymentMethod as NonNullable<BookingRecord['paymentMethod']>,
          completedAt: now,
        });
        newCommissionAt = now;
      } else if (amount < effective) {
        adjustedAmount = amount;
        const adjusted = await this.billing.adjustForResolvedDispute(client, {
          bookingId: booking.id,
          disputeRef: disputeId,
          source: 'party_settlement',
          newTripAmount: { amountMinor: amount, currency: booking.currency },
          reason: 'Settled by the parties',
          actorUserId: actor.id,
          shipperCompanyId: booking.shipperCompanyId,
          shipperAgreedBy,
          transporterAgreedBy: transporterAgreedBy ?? undefined,
          decidedAt: now,
          idempotencyKey: `dispute:${disputeId}:settlement`,
        });
        adjustmentId = adjusted?.adjustment.id ?? null;
      } else {
        await this.billing.finaliseAfterDispute(client, {
          bookingId: booking.id,
          disputeRef: disputeId,
          source: 'party_settlement',
          outcomeReason: 'Settled by the parties',
          actorUserId: actor.id,
          idempotencyKey: `dispute:${disputeId}:settlement`,
          at: now,
        });
      }

      await client.query(
        `UPDATE booking_disputes
         SET status = 'settled',
             settlement_amount_minor = $2,
             settlement_accepted_by_user_id = $3,
             settlement_accepted_at = $4,
             settlement_adjustment_id = $5,
             closed_at = $4
         WHERE id = $1`,
        [disputeId, amount, actor.id, now, adjustmentId],
      );
      await client.query(
        `UPDATE bookings
         SET completion_status = 'locked',
             locked_at = $2,
             adjusted_agreed_amount_minor = COALESCE($3, adjusted_agreed_amount_minor),
             commission_recognised_at = COALESCE(commission_recognised_at, $4),
             updated_at = $2
         WHERE id = $1`,
        [booking.id, now, adjustedAmount, newCommissionAt],
      );
      await client.query(
        `UPDATE loads SET status = 'completed', updated_at = $2 WHERE id = $1`,
        [booking.loadId, now],
      );
      await this.notifications.record(client, {
        type: 'dispute_settled',
        bookingId: booking.id,
        disputeId,
        recipientCompanyIds: [booking.shipperCompanyId, booking.transporterCompanyId],
      });
      await recordBookingEvent(client, {
        bookingId: booking.id,
        action: 'dispute_settled',
        actorUserId: actor.id,
        detail: { disputeId, amount },
      });

      const body = await this.fetchPresentedDispute(client, disputeId);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'acceptDisputeSettlement',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }

  async resolve(
    actor: DbUser,
    bookingId: string,
    dto: ResolveDisputeDto,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; body: DisputeResolutionResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(
      JSON.stringify({
        op: 'resolveBookingDispute',
        bookingId,
        resolution: dto.resolution,
        reason: dto.reason,
        adjustedAgreedAmount: dto.adjustedAgreedAmount ?? null,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<DisputeResolutionResponse>(
        client,
        actor.id,
        idempotencyKey,
        'resolveBookingDispute',
        requestHash,
      );
      if (replay) return replay;

      const booking = await lockBooking(client, bookingId);
      if (!booking) {
        throw new ApiException(404, 'NOT_FOUND', 'Booking not found.');
      }
      await assertBookingParty(client, actor, booking);
      if (actor.role !== 'admin') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only an admin can resolve a dispute.');
      }

      const dispute = await findOpenDisputeForBooking(client, bookingId);
      if (!dispute) {
        throw new ApiException(409, 'NO_OPEN_DISPUTE', 'There is no open dispute on this booking.');
      }
      const now = await dbNow(client);
      if (
        dispute.status === 'awaiting_transporter_response' &&
        new Date(dispute.responseDueAt).getTime() > now.getTime()
      ) {
        throw new ApiException(
          409,
          'DISPUTE_RESPONSE_WINDOW_OPEN',
          'The transporter response window is still open.',
        );
      }

      if (dto.resolution === 'adjust_amount') {
        if (!dto.adjustedAgreedAmount) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
            fields: { adjustedAgreedAmount: 'is required for adjust_amount' },
          });
        }
      } else if (dto.adjustedAgreedAmount) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
          fields: { adjustedAgreedAmount: 'is only allowed for adjust_amount' },
        });
      }

      const reason = dto.reason.trim();
      const effective = effectiveAgreedMinor(booking);
      let adjustmentId: string | null = null;
      let adjustedAmount: number | null = null;
      let newCommissionAt: Date | null = null;
      let completion: 'locked' | 'cancelled' = 'locked';

      if (dto.resolution === 'adjust_amount') {
        const amount = dto.adjustedAgreedAmount!.amountMinor;
        if (dto.adjustedAgreedAmount!.currency !== booking.currency) {
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
        adjustedAmount = amount;
        if (booking.commissionRecognisedAt == null) {
          await this.billing.recognise(client, {
            bookingId: booking.id,
            transporterCompanyId: booking.transporterCompanyId,
            tripAmount: { amountMinor: amount, currency: booking.currency },
            paymentMethod: booking.paymentMethod as NonNullable<BookingRecord['paymentMethod']>,
            completedAt: now,
          });
          newCommissionAt = now;
        } else {
          const adjusted = await this.billing.adjustForResolvedDispute(client, {
            bookingId: booking.id,
            disputeRef: dispute.id,
            source: 'admin_decision' as DisputeSource,
            newTripAmount: { amountMinor: amount, currency: booking.currency },
            reason,
            actorUserId: actor.id,
            decidedAt: now,
            idempotencyKey: `dispute:${dispute.id}:resolution`,
          });
          adjustmentId = adjusted?.adjustment.id ?? null;
        }
      } else if (dto.resolution === 'complete_trip') {
        if (booking.commissionRecognisedAt == null) {
          await this.billing.recognise(client, {
            bookingId: booking.id,
            transporterCompanyId: booking.transporterCompanyId,
            tripAmount: { amountMinor: effective, currency: booking.currency },
            paymentMethod: booking.paymentMethod as NonNullable<BookingRecord['paymentMethod']>,
            completedAt: now,
          });
          newCommissionAt = now;
        } else {
          await this.billing.finaliseAfterDispute(client, {
            bookingId: booking.id,
            disputeRef: dispute.id,
            source: 'admin_decision',
            outcomeReason: reason,
            actorUserId: actor.id,
            idempotencyKey: `dispute:${dispute.id}:resolution`,
            at: now,
          });
        }
      } else {
        completion = 'cancelled';
        if (booking.commissionRecognisedAt != null) {
          await this.billing.voidForBooking(client, booking.id, { at: now });
        }
      }

      await client.query(
        `UPDATE bookings
         SET completion_status = $2,
             locked_at = CASE WHEN $2 = 'locked' THEN $3 ELSE locked_at END,
             adjusted_agreed_amount_minor = COALESCE($4, adjusted_agreed_amount_minor),
             commission_recognised_at = COALESCE(commission_recognised_at, $5),
             updated_at = $3
         WHERE id = $1`,
        [booking.id, completion, now, adjustedAmount, newCommissionAt],
      );
      await client.query(
        `UPDATE loads SET status = $2, updated_at = $3 WHERE id = $1`,
        [booking.loadId, completion === 'locked' ? 'completed' : 'cancelled', now],
      );
      await client.query(
        `UPDATE booking_disputes
         SET status = 'resolved',
             resolution_outcome = $2,
             resolution_reason = $3,
             resolution_adjusted_amount_minor = $4,
             resolution_adjustment_id = $5,
             resolved_by_user_id = $6,
             resolved_at = $7,
             closed_at = $7
         WHERE id = $1`,
        [dispute.id, dto.resolution, reason, adjustedAmount, adjustmentId, actor.id, now],
      );
      await this.notifications.record(client, {
        type: 'dispute_resolved',
        bookingId: booking.id,
        disputeId: dispute.id,
        recipientCompanyIds: [booking.shipperCompanyId, booking.transporterCompanyId],
      });
      await recordBookingEvent(client, {
        bookingId: booking.id,
        action: 'dispute_resolved',
        actorUserId: actor.id,
        reason,
        detail: {
          disputeId: dispute.id,
          resolution: dto.resolution,
          adjustedAgreedAmount: adjustedAmount,
          adjustmentId,
        },
      });

      const body: DisputeResolutionResponse = {
        bookingId: booking.id,
        resolution: dto.resolution,
        reason,
        adjustmentId,
        disputeId: dispute.id,
        resolvedByUserId: actor.id,
        resolvedAt: now.toISOString(),
        resultingCompletionStatus: completion,
      };
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'resolveBookingDispute',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }

  private callerSide(
    actor: DbUser,
    sides: { shipper: boolean; transporter: boolean },
  ): 'shipper' | 'transporter' {
    if (sides.shipper && !sides.transporter) {
      if (actor.role !== 'shipper') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a booking party can accept a settlement.');
      }
      return 'shipper';
    }
    if (sides.transporter && !sides.shipper) {
      if (actor.role !== 'transporter') {
        throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a booking party can accept a settlement.');
      }
      return 'transporter';
    }
    if (actor.role === 'transporter') return 'transporter';
    if (actor.role === 'shipper') return 'shipper';
    throw new ApiException(403, 'ROLE_NOT_PERMITTED', 'Only a booking party can accept a settlement.');
  }

  private async fetchPresentedDispute(client: PoolClient, disputeId: string): Promise<BookingDisputeResponse> {
    const result = await run(client, `SELECT ${DISPUTE_RETURNING} FROM booking_disputes d WHERE d.id = $1`, [
      disputeId,
    ]);
    if (!result.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Dispute not found.');
    }
    return presentDispute(result.rows[0]);
  }
}
