import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException } from '../src/common/api.exception';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { AdjustForResolvedDisputeInput, BookingBillingHooks, HookCommissionAdjustment } from '../src/bookings/booking-billing-hooks';
import { PaymentArrangementGate } from '../src/bookings/payment-arrangement-gate';
import { ProofOfDeliveryCheck } from '../src/bookings/proof-of-delivery-check';
import { NewWorkCommissionGate } from '../src/quotations/commission-gate';
import { assertOperationResponse } from './contract';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  HttpResult,
  http,
  latestPayload,
  seedAdmin,
  truncate,
  uniqueEmail,
} from './helpers';
import { prepareTestDatabase } from './prepare-db';

const AGREED_MINOR = 100000;

describe('bookings API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists and gets bookings with party visibility and filters', async () => {
    const primary = await setupBooking(app);
    const other = await setupBooking(app);
    const outsider = await register(app, 'shipper');
    const outsiderCompany = await createCompany(app, outsider, 'shipper', 'Unrelated Shipper');

    const shipperList = expectContract(
      'listBookings',
      await http(app, 'get', '/bookings?page=1&pageSize=10', { token: primary.shipper.token }),
      200,
    );
    expect(shipperList.body.data.map((row: { id: string }) => row.id)).toEqual([primary.booking.id]);
    expect(shipperList.body.meta).toMatchObject({ page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });

    const transporterList = expectContract(
      'listBookings',
      await http(app, 'get', '/bookings', { token: primary.transporter.token }),
      200,
    );
    expect(transporterList.body.data.map((row: { id: string }) => row.id)).toEqual([primary.booking.id]);

    const adminList = expectContract('listBookings', await http(app, 'get', '/bookings', { token: primary.admin.token }), 200);
    expect(adminList.body.data.map((row: { id: string }) => row.id).sort()).toEqual(
      [primary.booking.id, other.booking.id].sort(),
    );

    const outsiderList = expectContract(
      'listBookings',
      await http(app, 'get', '/bookings', { token: outsider.token }),
      200,
    );
    expect(outsiderList.body.data).toEqual([]);

    const filteredByCompany = expectContract(
      'listBookings',
      await http(app, 'get', `/bookings?companyId=${primary.transporterCompany.id}`, {
        token: primary.admin.token,
      }),
      200,
    );
    expect(filteredByCompany.body.data.map((row: { id: string }) => row.id)).toEqual([primary.booking.id]);

    const filteredByStatus = expectContract(
      'listBookings',
      await http(app, 'get', '/bookings?status=confirmed', { token: primary.admin.token }),
      200,
    );
    expect(filteredByStatus.body.data).toEqual([]);

    expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${primary.booking.id}`, { token: primary.shipper.token }),
      200,
    );
    expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${primary.booking.id}`, { token: primary.transporter.token }),
      200,
    );
    expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${primary.booking.id}`, { token: primary.admin.token }),
      200,
    );
    expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${primary.booking.id}`, { token: outsider.token }),
      404,
    );
    const outsiderGet = await http(app, 'get', `/bookings/${primary.booking.id}`, { token: outsider.token });
    expect(outsiderGet.body.code).toBe('NOT_FOUND');

    expectContract(
      'listBookings',
      await http(app, 'get', `/bookings?companyId=${outsiderCompany.id}`, { token: primary.admin.token }),
      200,
    );
  });

  it('confirms only with a gate arrangement, enforces roles and the DB check', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, transporter, admin } = fixture;

    const noArrangement = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: shipper.token, body: {} }),
      409,
    );
    expect(noArrangement.body.code).toBe('BOOKING_CONFIRM_REQUIRES_ARRANGEMENT');
    expect(noArrangement.body.details).toEqual({ state: 'none' });

    const stillPending = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(stillPending.body.status).toBe('pending_payment_arrangement');

    expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: transporter.token, body: {} }),
      403,
    );
    const adminWithoutReason = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: admin.token, body: {} }),
      400,
    );
    expect(adminWithoutReason.body.code).toBe('VALIDATION_ERROR');

    const arrangementId = randomUUID();
    const gate = jest
      .spyOn(app.get(PaymentArrangementGate), 'assertConfirmed')
      .mockResolvedValue({ arrangementId, method: 'cash' });
    const key = `confirm-${randomUUID()}`;
    const confirmed = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, {
        token: shipper.token,
        body: {},
        idempotencyKey: key,
      }),
      200,
    );
    expect(gate).toHaveBeenCalledTimes(1);
    expect(confirmed.body).toMatchObject({
      status: 'confirmed',
      confirmedPaymentArrangementId: arrangementId,
    });
    expect(confirmed.body.confirmedAt).toEqual(expect.any(String));

    const loadRow = await app.get(DbService).query<{ status: string }>('SELECT status FROM loads WHERE id = $1', [
      fixture.load.id,
    ]);
    expect(loadRow.rows[0].status).toBe('booked');

    const replay = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, {
        token: shipper.token,
        body: {},
        idempotencyKey: key,
      }),
      200,
    );
    expect(replay.body).toEqual(confirmed.body);

    const second = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: shipper.token, body: {} }),
      409,
    );
    expect(second.body.code).toBe('BOOKING_NOT_PENDING');

    const other = await setupBooking(app);
    const db = app.get(DbService);
    await expect(
      db.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = clock_timestamp() WHERE id = $1`, [
        other.booking.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('checks the ban gate before commission and the commission gate before arrangements', async () => {
    const fixture = await setupBooking(app);
    const commissionGate = jest.spyOn(app.get(NewWorkCommissionGate), 'assertCanTakeNewWork');
    const arrangementGate = jest.spyOn(app.get(PaymentArrangementGate), 'assertConfirmed');
    await insertActiveBan(app, {
      userId: fixture.transporter.userId,
      companyId: fixture.transporterCompany.id,
      partyRole: 'transporter',
    });

    const banned = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${fixture.booking.id}/confirm`, {
        token: fixture.shipper.token,
        body: {},
      }),
      409,
    );
    expect(banned.body.code).toBe('ACCOUNT_BANNED');
    expect(commissionGate).not.toHaveBeenCalled();
    expect(arrangementGate).not.toHaveBeenCalled();

    await app.get(DbService).query('DELETE FROM off_platform_bans');
    commissionGate.mockRejectedValue(
      new ApiException(409, 'COMMISSION_OUTSTANDING', 'Outstanding commission must be settled before taking new work.', {
        outstandingByCurrency: [{ amountMinor: 500, currency: 'USD' }],
        outstandingAmount: { amountMinor: 500, currency: 'USD' },
      }),
    );
    const owing = expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${fixture.booking.id}/confirm`, {
        token: fixture.shipper.token,
        body: {},
      }),
      409,
    );
    expect(owing.body.code).toBe('COMMISSION_OUTSTANDING');
    expect(arrangementGate).not.toHaveBeenCalled();
  });

  it('advances trip status one step at a time and updates the load', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, transporter, admin, load } = fixture;

    const pending = expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: transporter.token,
        body: { tripStatus: 'truck_dispatched' },
      }),
      409,
    );
    expect(pending.body.code).toBe('BOOKING_NOT_CONFIRMED');

    await mockArrangement(app);
    expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: shipper.token, body: {} }),
      200,
    );

    expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: shipper.token,
        body: { tripStatus: 'truck_dispatched' },
      }),
      403,
    );
    expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: admin.token,
        body: { tripStatus: 'truck_dispatched' },
      }),
      403,
    );
    const skip = expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: transporter.token,
        body: { tripStatus: 'in_transit' },
      }),
      409,
    );
    expect(skip.body.code).toBe('INVALID_TRIP_TRANSITION');

    for (const tripStatus of ['truck_dispatched', 'goods_collected', 'in_transit']) {
      const advanced = expectContract(
        'updateBookingTripStatus',
        await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
          token: transporter.token,
          body: { tripStatus, note: `${tripStatus} note` },
        }),
        200,
      );
      expect(advanced.body.tripStatus).toBe(tripStatus);
      const loadRow = await app.get(DbService).query<{ status: string }>(
        'SELECT status FROM loads WHERE id = $1',
        [load.id],
      );
      expect(loadRow.rows[0].status).toBe('in_progress');
    }

    const delivered = expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: transporter.token,
        body: { tripStatus: 'delivered' },
      }),
      200,
    );
    expect(delivered.body.completionStatus).toBe('awaiting_shipper_acceptance');
    const deliveredLoad = await app.get(DbService).query<{ status: string }>(
      'SELECT status FROM loads WHERE id = $1',
      [load.id],
    );
    expect(deliveredLoad.rows[0].status).toBe('awaiting_shipper_acceptance');

    const again = expectContract(
      'updateBookingTripStatus',
      await http(app, 'post', `/bookings/${booking.id}/trip-status`, {
        token: transporter.token,
        body: { tripStatus: 'delivered' },
      }),
      409,
    );
    expect(again.body.code).toBe('INVALID_TRIP_TRANSITION');
  });

  it('requires a POD and records delivery acceptance with commission recognition', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, transporter } = fixture;
    await mockArrangement(app);
    expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${booking.id}/confirm`, { token: shipper.token, body: {} }),
      200,
    );

    expectContract(
      'getDeliveryConfirmation',
      await http(app, 'get', `/bookings/${booking.id}/delivery-confirmation`, { token: shipper.token }),
      404,
    );

    const missingPod = expectContract(
      'confirmDelivery',
      await http(app, 'post', `/bookings/${booking.id}/delivery-confirmation`, {
        token: shipper.token,
        body: { decision: 'accepted' },
      }),
      409,
    );
    expect(missingPod.body.code).toBe('POD_REQUIRED');

    await mockPod(app);
    expectContract(
      'confirmDelivery',
      await http(app, 'post', `/bookings/${booking.id}/delivery-confirmation`, {
        token: transporter.token,
        body: { decision: 'accepted' },
      }),
      403,
    );

    const billing = installBillingHooks(app);
    const accepted = expectContract(
      'confirmDelivery',
      await http(app, 'post', `/bookings/${booking.id}/delivery-confirmation`, {
        token: shipper.token,
        body: { decision: 'accepted' },
      }),
      200,
    );
    expect(accepted.body.decision).toBe('accepted');
    expect(accepted.body.confirmedByUserId).toBe(shipper.userId);

    const bookingAfter = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(bookingAfter.body.completionStatus).toBe('completed');
    expect(bookingAfter.body.deliveryConfirmedAt).toEqual(expect.any(String));
    const windowMs =
      new Date(bookingAfter.body.disputeWindowEndsAt).getTime() -
      new Date(bookingAfter.body.deliveryConfirmedAt).getTime();
    expect(windowMs).toBe(24 * 60 * 60 * 1000);

    expect(billing.recognise).toHaveBeenCalledTimes(1);
    const recogniseInput = billing.recognise.mock.calls[0][1] as {
      tripAmount: { amountMinor: number; currency: string };
      paymentMethod: string;
    };
    expect(recogniseInput.tripAmount).toEqual({ amountMinor: AGREED_MINOR, currency: 'USD' });
    expect(recogniseInput.paymentMethod).toBe('cash');

    const second = expectContract(
      'confirmDelivery',
      await http(app, 'post', `/bookings/${booking.id}/delivery-confirmation`, {
        token: shipper.token,
        body: { decision: 'accepted' },
      }),
      409,
    );
    expect(second.body.code).toBe('DELIVERY_ALREADY_CONFIRMED');

    const confirmation = expectContract(
      'getDeliveryConfirmation',
      await http(app, 'get', `/bookings/${booking.id}/delivery-confirmation`, { token: shipper.token }),
      200,
    );
    expect(confirmation.body.decision).toBe('accepted');
  });

  it('locks the trip after the window and refuses cancellation but allows adjustments', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, admin } = fixture;
    await completeBooking(app, fixture);

    const db = app.get(DbService);
    await db.query(
      `UPDATE bookings
       SET delivery_confirmed_at = delivery_confirmed_at - interval '25 hours',
           dispute_window_ends_at = dispute_window_ends_at - interval '25 hours'
       WHERE id = $1`,
      [booking.id],
    );

    const locked = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(locked.body.completionStatus).toBe('locked');
    expect(locked.body.lockedAt).toBe(locked.body.disputeWindowEndsAt);

    const raise = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: { reason: 'Trying to open a dispute after the window' },
      }),
      409,
    );
    expect(raise.body.code).toBe('DISPUTE_WINDOW_CLOSED');

    const cancel = expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${booking.id}/cancel`, {
        token: admin.token,
        body: { reason: 'Attempting to cancel a locked trip' },
      }),
      409,
    );
    expect(cancel.body.code).toBe('COMMISSION_FINAL');

    const billing = installBillingHooks(app);
    const adjustment = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${booking.id}/adjustments`, {
        token: admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 50000, currency: 'USD' },
          reason: 'Support case: half the load was rejected.',
        },
      }),
      201,
    );
    expect(adjustment.body.newTripAmount).toEqual({ amountMinor: 50000, currency: 'USD' });
    expect(billing.adjustForResolvedDispute).toHaveBeenCalledTimes(1);
    const adjustedBooking = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(adjustedBooking.body.adjustedAgreedAmount).toEqual({ amountMinor: 50000, currency: 'USD' });
  });

  it('raises an in-window dispute, holds commission and notifies the transporter', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, transporter, admin, transporterCompany } = fixture;
    await completeBooking(app, fixture);
    const billing = installBillingHooks(app);

    const above = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: {
          reason: 'The goods arrived damaged and we need a reduction.',
          proposedAmount: { amountMinor: AGREED_MINOR + 1, currency: 'USD' },
        },
      }),
      409,
    );
    expect(above.body.code).toBe('ADJUSTMENT_INCREASE_NOT_ALLOWED');

    const currency = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: {
          reason: 'The goods arrived damaged and we need a reduction.',
          proposedAmount: { amountMinor: 90000, currency: 'EUR' },
        },
      }),
      409,
    );
    expect(currency.body.code).toBe('CURRENCY_MISMATCH');

    const raised = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: {
          reason: 'The goods arrived damaged and we need a reduction.',
          evidence: [{ kind: 'photo', uri: 'https://evidence.example/photo.jpg', note: 'Damaged crate' }],
          proposedAmount: { amountMinor: 90000, currency: 'USD' },
        },
      }),
      201,
    );
    expect(raised.body.stage).toBe('dispute_window');
    expect(raised.body.status).toBe('awaiting_transporter_response');
    expect(raised.body.proposedAmount).toEqual({ amountMinor: 90000, currency: 'USD' });
    expect(new Date(raised.body.responseDueAt).getTime() - new Date(raised.body.openedAt).getTime()).toBe(
      48 * 60 * 60 * 1000,
    );

    const bookingAfter = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(bookingAfter.body.completionStatus).toBe('disputed');
    expect(billing.holdForDispute).toHaveBeenCalledTimes(1);

    const notification = await app.get(DbService).query<{ event_type: string; recipient_company_id: string }>(
      'SELECT event_type, recipient_company_id FROM notification_events WHERE booking_id = $1',
      [booking.id],
    );
    expect(notification.rows).toEqual([
      { event_type: 'dispute_opened', recipient_company_id: transporterCompany.id },
    ]);

    const second = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: { reason: 'A second dispute on the same booking.' },
      }),
      409,
    );
    expect(second.body.code).toBe('DISPUTE_ALREADY_OPEN');

    expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: transporter.token,
        body: { reason: 'Transporter cannot raise this dispute.' },
      }),
      403,
    );
    expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: admin.token,
        body: { reason: 'Admin resolves rather than raises disputes.' },
      }),
      403,
    );
    const outsider = await register(app, 'shipper');
    expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: outsider.token,
        body: { reason: 'Outsider cannot raise this dispute.' },
      }),
      404,
    );

    const early = await setupBooking(app);
    const notComplete = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${early.booking.id}/disputes`, {
        token: early.shipper.token,
        body: { reason: 'The trip has not been completed yet.' },
      }),
      409,
    );
    expect(notComplete.body.code).toBe('TRIP_NOT_COMPLETED');
  });

  it('responds once as the transporter and closes the response window after 48 hours', async () => {
    const fixture = await setupBooking(app);
    const { booking, shipper, transporter } = fixture;
    await completeBooking(app, fixture);
    const raised = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${booking.id}/disputes`, {
        token: shipper.token,
        body: { reason: 'The goods arrived damaged and we need a reduction.' },
      }),
      201,
    );

    expectContract(
      'respondToDispute',
      await http(app, 'post', `/disputes/${raised.body.id}/response`, {
        token: shipper.token,
        body: { statement: 'The shipper cannot respond to its own dispute.' },
      }),
      403,
    );

    const billing = installBillingHooks(app);
    const responded = expectContract(
      'respondToDispute',
      await http(app, 'post', `/disputes/${raised.body.id}/response`, {
        token: transporter.token,
        body: {
          statement: 'The driver has photos showing the goods were intact.',
          evidence: [{ kind: 'photo', uri: 'https://evidence.example/intact.jpg' }],
          counterOfferAmount: { amountMinor: 95000, currency: 'USD' },
        },
      }),
      200,
    );
    expect(responded.body.status).toBe('transporter_responded');
    expect(responded.body.response.counterOfferAmount).toEqual({ amountMinor: 95000, currency: 'USD' });
    expect(billing.recordDisputeResponse).toHaveBeenCalledTimes(1);

    const second = expectContract(
      'respondToDispute',
      await http(app, 'post', `/disputes/${raised.body.id}/response`, {
        token: transporter.token,
        body: { statement: 'A second response must be refused.' },
      }),
      409,
    );
    expect(second.body.code).toBe('DISPUTE_NOT_AWAITING_RESPONSE');

    const lateFixture = await setupBooking(app);
    await completeBooking(app, lateFixture);
    const late = expectContract(
      'raiseBookingDispute',
      await http(app, 'post', `/bookings/${lateFixture.booking.id}/disputes`, {
        token: lateFixture.shipper.token,
        body: { reason: 'A dispute that the transporter answers too late.' },
      }),
      201,
    );
    await app.get(DbService).query(
      `UPDATE booking_disputes
       SET opened_at = opened_at - interval '49 hours',
           response_due_at = response_due_at - interval '49 hours'
       WHERE id = $1`,
      [late.body.id],
    );
    const expired = expectContract(
      'respondToDispute',
      await http(app, 'post', `/disputes/${late.body.id}/response`, {
        token: lateFixture.transporter.token,
        body: { statement: 'This response is after the 48-hour window.' },
      }),
      409,
    );
    expect(expired.body.code).toBe('DISPUTE_RESPONSE_WINDOW_CLOSED');
  });

  it('settles by accepting the other side lower counter-offer and records the adjustment', async () => {
    const setup = await setupDispute(app, { counter: 80000 });
    const { fixture, dispute } = setup;
    const { booking, shipper, transporter } = fixture;
    const billing = installBillingHooks(app);
    const accepted = expectContract(
      'acceptDisputeSettlement',
      await http(app, 'post', `/disputes/${dispute.id}/settlement`, {
        token: shipper.token,
        body: { amount: { amountMinor: 80000, currency: 'USD' } },
      }),
      200,
    );
    expect(accepted.body.status).toBe('settled');
    expect(accepted.body.settlement.amount).toEqual({ amountMinor: 80000, currency: 'USD' });
    expect(accepted.body.settlement.adjustmentId).toEqual(expect.any(String));
    expect(billing.adjustForResolvedDispute).toHaveBeenCalledTimes(1);
    const adjustInput = billing.adjustForResolvedDispute.mock.calls[0][1] as AdjustForResolvedDisputeInput;
    expect(adjustInput.source).toBe('party_settlement');
    expect(adjustInput.newTripAmount).toEqual({ amountMinor: 80000, currency: 'USD' });
    expect(adjustInput.shipperAgreedBy).toBe(shipper.userId);
    expect(adjustInput.transporterAgreedBy).toBe(transporter.userId);

    const locked = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${booking.id}`, { token: shipper.token }),
      200,
    );
    expect(locked.body.completionStatus).toBe('locked');
    expect(locked.body.adjustedAgreedAmount).toEqual({ amountMinor: 80000, currency: 'USD' });

    const notifications = await app.get(DbService).query<{ event_type: string }>(
      `SELECT event_type FROM notification_events WHERE booking_id = $1 AND event_type = 'dispute_settled'`,
      [booking.id],
    );
    expect(notifications.rows).toHaveLength(2);
  });

  it('validates settlement offers and amounts', async () => {
    const mismatch = await setupDispute(app, { counter: 80000 });
    await expectSettlementError(app, mismatch, 70000, 'SETTLEMENT_AMOUNT_MISMATCH');

    const noOffer = await setupDispute(app);
    await expectSettlementError(app, noOffer, 50000, 'NO_OFFER_TO_ACCEPT');

    const ownOffer = await setupDispute(app, { proposed: 90000 });
    const own = expectContract(
      'acceptDisputeSettlement',
      await http(app, 'post', `/disputes/${ownOffer.dispute.id}/settlement`, {
        token: ownOffer.fixture.shipper.token,
        body: { amount: { amountMinor: 90000, currency: 'USD' } },
      }),
      403,
    );
    expect(own.body.code).toBe('ROLE_NOT_PERMITTED');
    expect(own.body.message).toBe('A party cannot accept its own offer.');
  });

  it('finalises an equal settlement without an adjustment', async () => {
    const setup = await setupDispute(app, { counter: AGREED_MINOR });
    const billing = installBillingHooks(app);
    const settled = expectContract(
      'acceptDisputeSettlement',
      await http(app, 'post', `/disputes/${setup.dispute.id}/settlement`, {
        token: setup.fixture.shipper.token,
        body: { amount: { amountMinor: AGREED_MINOR, currency: 'USD' } },
      }),
      200,
    );
    expect(settled.body.status).toBe('settled');
    expect(settled.body.settlement.adjustmentId).toBeNull();
    expect(billing.finaliseAfterDispute).toHaveBeenCalledTimes(1);
    expect(billing.adjustForResolvedDispute).not.toHaveBeenCalled();
    const booking = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${setup.fixture.booking.id}`, { token: setup.fixture.shipper.token }),
      200,
    );
    expect(booking.body.adjustedAgreedAmount).toBeNull();
  });

  it('resolves an at-delivery dispute after the response window and recognises commission', async () => {
    const fixture = await setupBooking(app);
    await mockArrangement(app);
    expectContract(
      'confirmBooking',
      await http(app, 'post', `/bookings/${fixture.booking.id}/confirm`, {
        token: fixture.shipper.token,
        body: {},
      }),
      200,
    );
    await mockPod(app);
    const billing = installBillingHooks(app);
    const disputed = expectContract(
      'confirmDelivery',
      await http(app, 'post', `/bookings/${fixture.booking.id}/delivery-confirmation`, {
        token: fixture.shipper.token,
        body: { decision: 'disputed', notes: 'The goods were damaged on arrival.' },
      }),
      200,
    );
    expect(disputed.body.decision).toBe('disputed');
    expect(billing.holdForDispute).not.toHaveBeenCalled();
    expect(billing.recognise).not.toHaveBeenCalled();

    const disputes = expectContract(
      'listBookingDisputes',
      await http(app, 'get', `/bookings/${fixture.booking.id}/disputes`, { token: fixture.shipper.token }),
      200,
    );
    expect(disputes.body.data).toHaveLength(1);
    expect(disputes.body.data[0].stage).toBe('at_delivery_confirmation');
    const disputeId = disputes.body.data[0].id as string;

    const early = expectContract(
      'resolveBookingDispute',
      await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
        token: fixture.admin.token,
        body: { resolution: 'complete_trip', reason: 'Deciding too early.' },
      }),
      409,
    );
    expect(early.body.code).toBe('DISPUTE_RESPONSE_WINDOW_OPEN');

    await app.get(DbService).query(
      `UPDATE booking_disputes
       SET opened_at = opened_at - interval '49 hours',
           response_due_at = response_due_at - interval '49 hours'
       WHERE id = $1`,
      [disputeId],
    );
    const resolved = expectContract(
      'resolveBookingDispute',
      await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
        token: fixture.admin.token,
        body: { resolution: 'complete_trip', reason: 'Evidence supports the transporter.' },
      }),
      200,
    );
    expect(resolved.body).toMatchObject({
      bookingId: fixture.booking.id,
      resolution: 'complete_trip',
      resultingCompletionStatus: 'locked',
      disputeId,
    });
    expect(billing.recognise).toHaveBeenCalledTimes(1);

    const listed = expectContract(
      'listBookingDisputes',
      await http(app, 'get', `/bookings/${fixture.booking.id}/disputes`, {
        token: fixture.transporter.token,
      }),
      200,
    );
    expect(listed.body.data[0].status).toBe('resolved');
    expect(listed.body.data[0].resolution).toMatchObject({
      outcome: 'complete_trip',
      reason: 'Evidence supports the transporter.',
    });
  });

  it('resolves an adjust_amount dispute and exposes the outcome to both parties', async () => {
    const setup = await setupDispute(app, { counter: 80000, respond: true });
    const { fixture, dispute } = setup;
    const billing = installBillingHooks(app);

    const missing = await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
      token: fixture.admin.token,
      body: { resolution: 'adjust_amount', reason: 'Adjustment without an amount.' },
    });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('VALIDATION_ERROR');

    expectContract(
      'resolveBookingDispute',
      await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
        token: fixture.shipper.token,
        body: { resolution: 'complete_trip', reason: 'A party cannot resolve this dispute.' },
      }),
      403,
    );

    const resolved = expectContract(
      'resolveBookingDispute',
      await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
        token: fixture.admin.token,
        body: {
          resolution: 'adjust_amount',
          reason: 'Admin reduced the trip after reviewing both sides.',
          adjustedAgreedAmount: { amountMinor: 60000, currency: 'USD' },
        },
      }),
      200,
    );
    expect(resolved.body.resolution).toBe('adjust_amount');
    expect(resolved.body.resultingCompletionStatus).toBe('locked');
    expect(resolved.body.adjustmentId).toEqual(expect.any(String));
    expect(billing.adjustForResolvedDispute).toHaveBeenCalledTimes(1);

    const booking = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${fixture.booking.id}`, { token: fixture.shipper.token }),
      200,
    );
    expect(booking.body.adjustedAgreedAmount).toEqual({ amountMinor: 60000, currency: 'USD' });
    expect(booking.body.completionStatus).toBe('locked');

    for (const token of [fixture.shipper.token, fixture.transporter.token]) {
      const listed = expectContract(
        'listBookingDisputes',
        await http(app, 'get', `/bookings/${fixture.booking.id}/disputes`, { token }),
        200,
      );
      expect(listed.body.data[0].id).toBe(dispute.id);
      expect(listed.body.data[0].resolution).toMatchObject({
        outcome: 'adjust_amount',
        reason: 'Admin reduced the trip after reviewing both sides.',
        adjustedAgreedAmount: { amountMinor: 60000, currency: 'USD' },
      });
    }
  });

  it('resolves a dispute by cancelling the trip and voids the recognised commission', async () => {
    const setup = await setupDispute(app, { respond: true });
    const { fixture, dispute } = setup;
    const billing = installBillingHooks(app);
    const resolved = expectContract(
      'resolveBookingDispute',
      await http(app, 'post', `/bookings/${fixture.booking.id}/disputes/resolve`, {
        token: fixture.admin.token,
        body: { resolution: 'cancel_trip', reason: 'The trip is cancelled after review.' },
      }),
      200,
    );
    expect(resolved.body.resultingCompletionStatus).toBe('cancelled');
    expect(resolved.body.adjustmentId).toBeNull();
    expect(billing.voidForBooking).toHaveBeenCalledTimes(1);

    const booking = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${fixture.booking.id}`, { token: fixture.shipper.token }),
      200,
    );
    expect(booking.body.status).toBe('confirmed');
    expect(booking.body.completionStatus).toBe('cancelled');
    const load = await app.get(DbService).query<{ status: string }>('SELECT status FROM loads WHERE id = $1', [
      fixture.load.id,
    ]);
    expect(load.rows[0].status).toBe('cancelled');
    const listed = expectContract(
      'listBookingDisputes',
      await http(app, 'get', `/bookings/${fixture.booking.id}/disputes`, {
        token: fixture.transporter.token,
      }),
      200,
    );
    expect(listed.body.data[0].id).toBe(dispute.id);
    expect(listed.body.data[0].resolution.outcome).toBe('cancel_trip');
  });

  it('cancels as admin only, records the reason and voids a recognised receivable', async () => {
    const pending = await setupBooking(app);
    const pinned = expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${pending.booking.id}/cancel`, {
        token: pending.shipper.token,
        body: { reason: 'Party tries to self-cancel.' },
      }),
      409,
    );
    expect(pinned.body).toMatchObject({
      code: 'SELF_CANCEL_NOT_ALLOWED',
      message: 'This booking can only be cancelled by Truber admin. Contact support.',
      details: { bookingId: pending.booking.id, bookingStatus: 'pending_payment_arrangement' },
    });
    const outsider = await register(app, 'transporter');
    expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${pending.booking.id}/cancel`, {
        token: outsider.token,
        body: { reason: 'Outsider tries to cancel.' },
      }),
      404,
    );

    const cancelled = expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${pending.booking.id}/cancel`, {
        token: pending.admin.token,
        body: { reason: 'Admin cancels before collection.' },
        idempotencyKey: `cancel-${randomUUID()}`,
      }),
      200,
    );
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.completionStatus).toBe('cancelled');
    const row = await app.get(DbService).query<{
      cancelled_at: Date | null;
      cancel_reason: string | null;
      before_collection: boolean | null;
    }>('SELECT cancelled_at, cancel_reason, before_collection FROM bookings WHERE id = $1', [pending.booking.id]);
    expect(row.rows[0].cancelled_at).not.toBeNull();
    expect(row.rows[0].cancel_reason).toBe('Admin cancels before collection.');
    expect(row.rows[0].before_collection).toBe(true);
    const load = await app.get(DbService).query<{ status: string }>('SELECT status FROM loads WHERE id = $1', [
      pending.load.id,
    ]);
    expect(load.rows[0].status).toBe('cancelled');

    const windowFixture = await setupBooking(app);
    await completeBooking(app, windowFixture);
    const billing = installBillingHooks(app);
    const cancelledInWindow = expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${windowFixture.booking.id}/cancel`, {
        token: windowFixture.admin.token,
        body: { reason: 'Admin cancels inside the dispute window.', beforeCollection: false },
      }),
      200,
    );
    expect(cancelledInWindow.body.status).toBe('cancelled');
    expect(billing.voidForBooking).toHaveBeenCalledTimes(1);

    const disputed = await setupDispute(app, { respond: true });
    const open = expectContract(
      'cancelBooking',
      await http(app, 'post', `/bookings/${disputed.fixture.booking.id}/cancel`, {
        token: disputed.fixture.admin.token,
        body: { reason: 'Admin tries to cancel while a dispute is open.' },
      }),
      409,
    );
    expect(open.body.code).toBe('DISPUTE_OPEN');
  });

  it('records admin adjustments only when billing hooks are bound', async () => {
    const fixture = await setupBooking(app);
    await completeBooking(app, fixture);
    await lockBooking(app, fixture.booking.id);

    const unavailable = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${fixture.booking.id}/adjustments`, {
        token: fixture.admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 50000, currency: 'USD' },
          reason: 'No billing binding is available yet.',
        },
      }),
      409,
    );
    expect(unavailable.body.code).toBe('BILLING_NOT_AVAILABLE');
    const unchanged = await app.get(DbService).query<{ adjusted_agreed_amount_minor: number | null }>(
      'SELECT adjusted_agreed_amount_minor FROM bookings WHERE id = $1',
      [fixture.booking.id],
    );
    expect(unchanged.rows[0].adjusted_agreed_amount_minor).toBeNull();

    const billing = installBillingHooks(app);
    const created = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${fixture.booking.id}/adjustments`, {
        token: fixture.admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 50000, currency: 'USD' },
          reason: 'Support case: half the load was rejected.',
        },
      }),
      201,
    );
    expect(created.body.newTripAmount).toEqual({ amountMinor: 50000, currency: 'USD' });
    expect(billing.adjustForResolvedDispute).toHaveBeenCalledTimes(1);
    const adjusted = expectContract(
      'getBooking',
      await http(app, 'get', `/bookings/${fixture.booking.id}`, { token: fixture.shipper.token }),
      200,
    );
    expect(adjusted.body.adjustedAgreedAmount).toEqual({ amountMinor: 50000, currency: 'USD' });

    const increase = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${fixture.booking.id}/adjustments`, {
        token: fixture.admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 80000, currency: 'USD' },
          reason: 'An adjustment must never increase the amount.',
        },
      }),
      409,
    );
    expect(increase.body.code).toBe('ADJUSTMENT_INCREASE_NOT_ALLOWED');
    const equal = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${fixture.booking.id}/adjustments`, {
        token: fixture.admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 50000, currency: 'USD' },
          reason: 'An adjustment must be lower than the current amount.',
        },
      }),
      400,
    );
    expect(equal.body.code).toBe('VALIDATION_ERROR');
    expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${fixture.booking.id}/adjustments`, {
        token: fixture.shipper.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 40000, currency: 'USD' },
          reason: 'A party cannot record an adjustment.',
        },
      }),
      403,
    );

    const unlocked = await setupBooking(app);
    await completeBooking(app, unlocked);
    const notLocked = expectContract(
      'recordBookingAdjustment',
      await http(app, 'post', `/admin/bookings/${unlocked.booking.id}/adjustments`, {
        token: unlocked.admin.token,
        body: {
          adjustedAgreedAmount: { amountMinor: 50000, currency: 'USD' },
          reason: 'The trip is not locked yet.',
        },
      }),
      409,
    );
    expect(notLocked.body.code).toBe('BOOKING_NOT_LOCKED');
  });
});

interface Session {
  token: string;
  userId: string;
  email: string;
  password: string;
}

interface BookingFixture {
  shipper: Session;
  shipperCompany: { id: string };
  transporter: Session & { companyId: string };
  transporterCompany: { id: string };
  load: { id: string };
  booking: { id: string };
  admin: Session;
}

interface DisputeSetup {
  fixture: BookingFixture;
  dispute: { id: string };
}

function expectContract(operationId: string, response: HttpResult, status: number): HttpResult {
  expect(response.status).toBe(status);
  assertOperationResponse(operationId, status, response.body);
  return response;
}

async function register(app: INestApplication, role: 'shipper' | 'transporter'): Promise<Session> {
  const email = uniqueEmail(role);
  const password = `${role}-password`;
  const response = await http(app, 'post', '/auth/register', {
    body: { email, password, fullName: `${role} user`, role },
  });
  if (response.status !== 201) {
    throw new Error(`register failed ${response.status}`);
  }
  return { token: response.body.accessToken as string, userId: response.body.user.id as string, email, password };
}

async function createCompany(
  app: INestApplication,
  session: Session,
  type: 'shipper' | 'transporter',
  legalName: string,
): Promise<{ id: string }> {
  const response = await http(app, 'post', '/companies', {
    token: session.token,
    body: { type, legalName },
  });
  if (response.status !== 201) {
    throw new Error(`company create failed ${response.status}`);
  }
  return { id: response.body.id as string };
}

async function verifyCompany(app: INestApplication, adminToken: string, companyId: string): Promise<void> {
  const response = await http(app, 'patch', `/companies/${companyId}`, {
    token: adminToken,
    body: { verificationStatus: 'verified' },
  });
  if (response.status !== 200) {
    throw new Error(`company verification failed ${response.status}`);
  }
}

async function loginAdmin(app: INestApplication): Promise<Session> {
  await seedAdmin();
  const response = await http(app, 'post', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (response.status !== 200) {
    throw new Error(`admin login failed ${response.status}`);
  }
  return {
    token: response.body.accessToken as string,
    userId: response.body.user.id as string,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  };
}

async function verifyOtp(app: INestApplication, token: string, userId: string): Promise<void> {
  const requested = await http(app, 'post', '/auth/otp/request', { token, body: { channel: 'sms' } });
  if (requested.status !== 202) {
    throw new Error(`otp request failed ${requested.status}`);
  }
  const code = await latestPayload(app, userId, 'otp');
  const verified = await http(app, 'post', '/auth/otp/verify', { token, body: { code } });
  if (verified.status !== 200 || verified.body.accountStatus !== 'active') {
    throw new Error(`otp verify failed ${verified.status}`);
  }
}

function draftInput(companyId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    companyId,
    goodsType: 'General cargo',
    weightKg: 1500,
    truckTypeRequired: 'flatbed',
    pickupAddress: 'Pickup yard',
    destinationAddress: 'Destination yard',
    loadingDate: '2026-12-20',
    rateType: 'negotiable',
    currency: 'USD',
    ...overrides,
  };
}

async function setupBooking(app: INestApplication): Promise<BookingFixture> {
  const shipper = await register(app, 'shipper');
  const shipperCompany = await createCompany(app, shipper, 'shipper', 'Booking Test Shipper');
  await verifyOtp(app, shipper.token, shipper.userId);
  const admin = await loginAdmin(app);
  await verifyCompany(app, admin.token, shipperCompany.id);
  const draft = expectContract(
    'createLoad',
    await http(app, 'post', '/loads', { token: shipper.token, body: draftInput(shipperCompany.id) }),
    201,
  );
  const posted = expectContract(
    'postLoad',
    await http(app, 'post', `/loads/${draft.body.id}/post`, { token: shipper.token }),
    200,
  );

  const transporter = await register(app, 'transporter');
  const transporterCompany = await createCompany(app, transporter, 'transporter', 'Booking Test Fleet');
  await verifyOtp(app, transporter.token, transporter.userId);
  await verifyCompany(app, admin.token, transporterCompany.id);
  const quote = expectContract(
    'createQuotation',
    await http(app, 'post', `/loads/${posted.body.id}/quotations`, {
      token: transporter.token,
      body: {
        transporterCompanyId: transporterCompany.id,
        amount: { amountMinor: AGREED_MINOR, currency: 'USD' },
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      },
    }),
    201,
  );
  const accepted = expectContract(
    'acceptQuotation',
    await http(app, 'post', `/quotations/${quote.body.id}/accept`, { token: shipper.token, body: {} }),
    201,
  );
  return {
    shipper,
    shipperCompany,
    transporter: { ...transporter, companyId: transporterCompany.id },
    transporterCompany,
    load: { id: posted.body.id as string },
    booking: { id: accepted.body.booking.id as string },
    admin,
  };
}

async function mockArrangement(app: INestApplication, method: 'cash' | 'prepay' = 'cash'): Promise<void> {
  const gate = app.get(PaymentArrangementGate);
  const existing = gate.assertConfirmed as unknown;
  if (jest.isMockFunction(existing)) {
    await (existing as jest.Mock).mockResolvedValue({ arrangementId: randomUUID(), method });
    return;
  }
  jest.spyOn(gate, 'assertConfirmed').mockResolvedValue({ arrangementId: randomUUID(), method });
}

async function mockPod(app: INestApplication): Promise<void> {
  const check = app.get(ProofOfDeliveryCheck);
  const existing = check.hasArtifact as unknown;
  if (jest.isMockFunction(existing)) {
    await (existing as jest.Mock).mockResolvedValue(true);
    return;
  }
  jest.spyOn(check, 'hasArtifact').mockResolvedValue(true);
}

async function confirmBooking(app: INestApplication, fixture: BookingFixture): Promise<void> {
  await mockArrangement(app);
  expectContract(
    'confirmBooking',
    await http(app, 'post', `/bookings/${fixture.booking.id}/confirm`, {
      token: fixture.shipper.token,
      body: {},
    }),
    200,
  );
}

async function completeBooking(app: INestApplication, fixture: BookingFixture): Promise<void> {
  await confirmBooking(app, fixture);
  await mockPod(app);
  expectContract(
    'confirmDelivery',
    await http(app, 'post', `/bookings/${fixture.booking.id}/delivery-confirmation`, {
      token: fixture.shipper.token,
      body: { decision: 'accepted' },
    }),
    200,
  );
}

async function lockBooking(app: INestApplication, bookingId: string): Promise<void> {
  await app.get(DbService).query(
    `UPDATE bookings
     SET delivery_confirmed_at = delivery_confirmed_at - interval '25 hours',
         dispute_window_ends_at = dispute_window_ends_at - interval '25 hours'
     WHERE id = $1`,
    [bookingId],
  );
}

async function raiseDispute(
  app: INestApplication,
  fixture: BookingFixture,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  await completeBooking(app, fixture);
  const response = expectContract(
    'raiseBookingDispute',
    await http(app, 'post', `/bookings/${fixture.booking.id}/disputes`, {
      token: fixture.shipper.token,
      body: {
        reason: 'The goods arrived damaged and a reduction is required.',
        ...overrides,
      },
    }),
    201,
  );
  return { id: response.body.id as string };
}

async function setupDispute(
  app: INestApplication,
  options: { proposed?: number; counter?: number; respond?: boolean } = {},
): Promise<DisputeSetup> {
  const fixture = await setupBooking(app);
  const overrides: Record<string, unknown> = {};
  if (options.proposed !== undefined) {
    overrides.proposedAmount = { amountMinor: options.proposed, currency: 'USD' };
  }
  const dispute = await raiseDispute(app, fixture, overrides);
  if (options.respond || options.counter !== undefined) {
    const body: Record<string, unknown> = {
      statement: 'The transporter disagrees and submits its evidence.',
    };
    if (options.counter !== undefined) {
      body.counterOfferAmount = { amountMinor: options.counter, currency: 'USD' };
    }
    expectContract(
      'respondToDispute',
      await http(app, 'post', `/disputes/${dispute.id}/response`, {
        token: fixture.transporter.token,
        body,
      }),
      200,
    );
  }
  return { fixture, dispute };
}

async function expectSettlementError(
  app: INestApplication,
  setup: DisputeSetup,
  amountMinor: number,
  code: string,
): Promise<void> {
  const response = expectContract(
    'acceptDisputeSettlement',
    await http(app, 'post', `/disputes/${setup.dispute.id}/settlement`, {
      token: setup.fixture.shipper.token,
      body: { amount: { amountMinor, currency: 'USD' } },
    }),
    409,
  );
  expect(response.body.code).toBe(code);
}

interface BillingSpies {
  recognise: jest.SpyInstance;
  holdForDispute: jest.SpyInstance;
  recordDisputeResponse: jest.SpyInstance;
  finaliseAfterDispute: jest.SpyInstance;
  adjustForResolvedDispute: jest.SpyInstance;
  voidForBooking: jest.SpyInstance;
}

function installBillingHooks(app: INestApplication): BillingSpies {
  const hooks = app.get(BookingBillingHooks);
  const spies: BillingSpies = {
    recognise: jest.spyOn(hooks, 'recognise').mockResolvedValue(null),
    holdForDispute: jest.spyOn(hooks, 'holdForDispute').mockResolvedValue(null),
    recordDisputeResponse: jest.spyOn(hooks, 'recordDisputeResponse').mockResolvedValue(null),
    finaliseAfterDispute: jest.spyOn(hooks, 'finaliseAfterDispute').mockResolvedValue(null),
    adjustForResolvedDispute: jest.spyOn(hooks, 'adjustForResolvedDispute').mockResolvedValue(null),
    voidForBooking: jest.spyOn(hooks, 'voidForBooking').mockResolvedValue(null),
  };
  spies.adjustForResolvedDispute.mockImplementation(
    async (client: PoolClient, input: AdjustForResolvedDisputeInput) => ({
      adjustment: await fakeAdjustment(client, input),
    }),
  );
  return spies;
}

async function fakeAdjustment(
  client: PoolClient,
  input: AdjustForResolvedDisputeInput,
): Promise<HookCommissionAdjustment> {
  const result = await client.query<{
    agreed: number;
    adjusted: number | null;
    currency: string;
    transporter: string;
  }>(
    `SELECT agreed_amount_minor AS agreed,
            adjusted_agreed_amount_minor AS adjusted,
            currency,
            transporter_company_id AS transporter
     FROM bookings WHERE id = $1`,
    [input.bookingId],
  );
  const row = result.rows[0];
  const previousTrip = row.adjusted ?? row.agreed;
  const previousCommission = halfUpFivePercent(previousTrip);
  const newCommission = halfUpFivePercent(input.newTripAmount.amountMinor);
  const delta = previousCommission - newCommission;
  return {
    id: randomUUID(),
    bookingId: input.bookingId,
    receivableId: randomUUID(),
    transporterCompanyId: row.transporter,
    disputeRef: input.disputeRef ?? null,
    source: input.source,
    shipperAgreedByUserId: input.shipperAgreedBy ?? null,
    transporterAgreedByUserId: input.transporterAgreedBy ?? null,
    decidedAt: input.decidedAt.toISOString(),
    previousTripAmount: { amountMinor: previousTrip, currency: row.currency },
    newTripAmount: input.newTripAmount,
    previousCommission: { amountMinor: previousCommission, currency: row.currency },
    newCommission: { amountMinor: newCommission, currency: row.currency },
    reducedOpenAmount: { amountMinor: delta, currency: row.currency },
    creditedAmount: { amountMinor: 0, currency: row.currency },
    reason: input.reason,
    recordedByUserId: input.actorUserId,
    recordedAt: input.decidedAt.toISOString(),
    fundsMovementClaimedByTruber: false,
  };
}

function halfUpFivePercent(amountMinor: number): number {
  return Math.floor((amountMinor * 5 + 50) / 100);
}

async function insertActiveBan(
  app: INestApplication,
  input: {
    userId: string;
    companyId: string;
    partyRole: 'shipper' | 'transporter';
  },
): Promise<void> {
  const db = app.get(DbService);
  const reportId = randomUUID();
  const findingId = randomUUID();
  const reason = 'Direct test fixture for an active off-platform ban';
  await db.query(
    `INSERT INTO off_platform_reports (
       id, booking_id, reported_by_user_id, reporter_role, suspected_party,
       description, evidence_uris, status, created_at
     ) VALUES ($1, $2, $3, $4, 'transporter', $5, '[]'::jsonb, 'open', clock_timestamp())`,
    [reportId, randomUUID(), input.userId, input.partyRole, reason],
  );
  await db.query(
    `INSERT INTO off_platform_findings (
       id, report_id, booking_id, outcome, reason, responsible_parties,
       reviewed_by_user_id, reviewed_at
     ) VALUES ($1, $2, $3, 'confirmed', $4, '[]'::jsonb, $5, clock_timestamp())`,
    [findingId, reportId, randomUUID(), reason, input.userId],
  );
  await db.query(
    `INSERT INTO off_platform_bans (
       id, finding_id, user_id, company_id, party_role, reason, starts_at, ends_at,
       duration_days, applied_by_user_id, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       clock_timestamp() - interval '1 hour',
       clock_timestamp() + interval '335 hours',
       14, $7, clock_timestamp()
     )`,
    [randomUUID(), findingId, input.userId, input.companyId, input.partyRole, reason, input.userId],
  );
}
