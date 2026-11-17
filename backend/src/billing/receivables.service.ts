import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiException, isPgError } from '../common/api.exception';
import { pageMeta, pageWindow } from '../common/http';
import { iso, sha256 } from '../common/crypto';
import { ENV, Env } from '../config/env';
import { DbService } from '../db/db.service';
import { DbUser } from '../domain';
import { planAdjustment } from './adjustments';
import { COMMISSION_RATE_BPS, commissionFor, PaymentMethod } from './commission';
import { lockCommissionExclusive } from './commission-lock';
import { owingStatuses } from './held-policy';
import { assertMoney, minorFromDb, Money } from './money';

export type CommissionReceivableStatus =
  | 'open'
  | 'settled_on_release'
  | 'collected'
  | 'voided'
  | 'held'
  | 'cancelled';

export type DisputeSource = 'party_settlement' | 'admin_decision';
export type DisputePreHoldStatus = 'open' | 'collected' | 'settled_on_release';
export type CreditSourceKind = 'adjustment' | 'void' | 'collection';

export interface CommissionReceivable {
  id: string;
  bookingId: string;
  transporterCompanyId: string;
  amount: Money;
  reducedAmount: Money;
  effectiveAmount: Money;
  creditAppliedAmount: Money;
  disputeWindowEndsAt: string;
  finalAt: string | null;
  disputeRef: string | null;
  heldSince: string | null;
  commissionRateBps: number;
  collectedAmount: Money;
  remainingAmount: Money;
  status: CommissionReceivableStatus;
  recognisedAt: string;
  settledAt: string | null;
  paymentMethod: PaymentMethod | null;
}

export interface CommissionAccount {
  companyId: string;
  outstandingByCurrency: Money[];
  outstandingAmount?: Money;
  heldByCurrency: Money[];
  creditByCurrency: Money[];
  receivables: CommissionReceivable[];
}

export interface CommissionBalances {
  outstandingByCurrency: Money[];
  creditByCurrency: Money[];
  heldByCurrency: Money[];
}

export interface CommissionCollectionRecord {
  id: string;
  companyId: string;
  amount: Money;
  outstandingAmountAfter: Money;
  outstandingByCurrencyAfter: Money[];
  creditedAmount: Money;
  externalReference: string | null;
  notes: string | null;
  fundsMovementClaimedByTruber: false;
  recordedAt: string;
  recordedByUserId: string;
}

export interface RecogniseReceivableInput {
  bookingId: string;
  transporterCompanyId: string;
  tripAmount: Money;
  paymentMethod: PaymentMethod;
  completedAt?: Date;
}

export interface RecordCollectionInput {
  amount: Money;
  externalReference?: string;
  notes?: string;
}

export interface VoidForBookingOptions {
  at?: Date;
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

export interface CommissionDisputeOutcome {
  id: string;
  receivableId: string;
  bookingId: string;
  transporterCompanyId: string;
  disputeRef: string | null;
  kind: 'unchanged' | 'adjusted';
  source: DisputeSource;
  adjustmentId: string | null;
  reason: string;
  actorUserId: string;
  decidedAt: string;
  idempotencyKey: string;
  requestHash: string;
  recordedAt: string;
}

export interface DisputeFinalisation {
  outcome: CommissionDisputeOutcome;
  receivable: CommissionReceivable;
}

export interface CommissionAdjustment {
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

export interface CommissionAdjustmentResult {
  adjustment: CommissionAdjustment;
  receivable: CommissionReceivable;
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

interface ReceivableRow extends QueryResultRow {
  id: string;
  booking_id: string;
  transporter_company_id: string;
  currency: string;
  amount_minor: string | number;
  collected_minor: string | number;
  remaining_minor: string | number;
  reduced_minor: string | number;
  credit_applied_minor: string | number;
  status: CommissionReceivableStatus;
  commission_rate_bps: number | string;
  recognised_at: Date | string;
  settled_at: Date | string | null;
  voided_at: Date | string | null;
  payment_method: PaymentMethod;
  trip_minor: string | number | null;
  dispute_window_ends_at: Date | string;
  dispute_ref: string | null;
  disputed_at: Date | string | null;
  response_deadline_at: Date | string | null;
  transporter_responded_at: Date | string | null;
  final_at: Date | string | null;
  pre_hold_status: DisputePreHoldStatus | null;
}

interface OpenReceivableRow extends QueryResultRow {
  id: string;
  status: CommissionReceivableStatus;
  collected_minor: string | number;
  remaining_minor: string | number;
}

interface OutstandingRow extends QueryResultRow {
  currency: string;
  total_minor: string | number;
}

interface AdjustmentRow extends QueryResultRow {
  id: string;
  booking_id: string;
  receivable_id: string;
  transporter_company_id: string;
  dispute_ref: string | null;
  source: DisputeSource;
  shipper_agreed_by: string | null;
  transporter_agreed_by: string | null;
  decided_at: Date | string;
  currency: string;
  previous_trip_minor: string | number;
  new_trip_minor: string | number;
  previous_commission_minor: string | number;
  new_commission_minor: string | number;
  reduced_open_minor: string | number;
  credited_minor: string | number;
  reason: string;
  recorded_by: string;
  recorded_at: Date | string;
  idempotency_key: string;
  request_hash: string;
}

interface OutcomeRow extends QueryResultRow {
  id: string;
  receivable_id: string;
  booking_id: string;
  transporter_company_id: string;
  dispute_ref: string | null;
  kind: 'unchanged' | 'adjusted';
  source: DisputeSource;
  adjustment_id: string | null;
  reason: string;
  actor_user_id: string;
  decided_at: Date | string;
  idempotency_key: string;
  request_hash: string;
  recorded_at: Date | string;
}

interface CreditRow extends QueryResultRow {
  id: string;
  company_id: string;
  currency: string;
  amount_minor: string | number;
  remaining_minor: string | number;
  source_kind: CreditSourceKind;
  created_at: Date | string;
}

interface LatestAdjustmentRow extends QueryResultRow {
  new_trip_minor: string | number;
  new_commission_minor: string | number;
}

interface FinalAtRow {
  status: string;
  final_at: Date | string | null;
  dispute_window_ends_at: Date | string;
}

const HOUR_MS = 60 * 60 * 1000;
const DISPUTE_WINDOW_MS = 24 * HOUR_MS;
const RESPONSE_WINDOW_MS = 48 * HOUR_MS;

function validationError(fields: Record<string, string>): ApiException {
  return new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', { fields });
}

function safeMinor(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`Amount ${value.toString()} is not a safe integer`);
  }
  return converted;
}

function dateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function requireDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw validationError({ [field]: 'must be a valid date' });
  }
  return value;
}

function requireReason(reason: string): string {
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 2000) {
    throw validationError({ reason: 'must be 1 to 2000 characters' });
  }
  return reason;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Contract v0.5.0: disputeRef is the BookingDispute id (format uuid). Stored lower-case. */
function requireDisputeRef(disputeRef: string): string {
  const normalised = typeof disputeRef === 'string' ? disputeRef.toLowerCase() : '';
  if (!UUID_PATTERN.test(normalised)) {
    throw validationError({ disputeRef: 'must be a UUID' });
  }
  return normalised;
}

/**
 * Receipt references are compared after NFKC folding (full-width to ASCII), removal of all
 * format characters (zero-width etc.) and all separators/whitespace, then upper-casing.
 * Hyphens are kept. 'EC\u200b123', 'ＥＣ123', 'EC 123' and 'ec123' all equal 'EC123'.
 */
export function normaliseReceiptRef(externalReference: string | undefined): string | null {
  if (typeof externalReference !== 'string') {
    return null;
  }
  const normalised = externalReference
    .normalize('NFKC')
    .replace(/[\p{Cf}\p{Z}\s]+/gu, '')
    .toUpperCase();
  return normalised.length === 0 ? null : normalised;
}

function duplicateCollectionError(): ApiException {
  return new ApiException(
    409,
    'DUPLICATE_COLLECTION',
    'That receipt reference is already recorded for this company and currency.',
  );
}

export function presentCommissionReceivable(
  row: ReceivableRow,
  now: Date = new Date(),
): CommissionReceivable {
  const currency = String(row.currency);
  const amountMinor = minorFromDb(row.amount_minor);
  const reducedMinor = minorFromDb(row.reduced_minor);
  const finalAt = finalAtFor(row, now);
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    transporterCompanyId: String(row.transporter_company_id),
    amount: { amountMinor, currency },
    reducedAmount: { amountMinor: reducedMinor, currency },
    effectiveAmount: { amountMinor: amountMinor - reducedMinor, currency },
    creditAppliedAmount: { amountMinor: minorFromDb(row.credit_applied_minor), currency },
    disputeWindowEndsAt: iso(row.dispute_window_ends_at),
    finalAt: finalAt == null ? null : iso(finalAt),
    disputeRef: row.status === 'held' && row.dispute_ref != null ? String(row.dispute_ref) : null,
    heldSince:
      row.status === 'held' && row.disputed_at != null ? iso(row.disputed_at) : null,
    commissionRateBps: Number(row.commission_rate_bps),
    collectedAmount: { amountMinor: minorFromDb(row.collected_minor), currency },
    remainingAmount: { amountMinor: minorFromDb(row.remaining_minor), currency },
    status: row.status,
    recognisedAt: iso(row.recognised_at),
    settledAt: row.settled_at == null ? null : iso(row.settled_at),
    paymentMethod: row.payment_method ?? null,
  };
}

export function presentCommissionAdjustment(row: AdjustmentRow): CommissionAdjustment {
  const currency = String(row.currency);
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    receivableId: String(row.receivable_id),
    transporterCompanyId: String(row.transporter_company_id),
    disputeRef: row.dispute_ref == null ? null : String(row.dispute_ref),
    source: row.source,
    shipperAgreedByUserId:
      row.shipper_agreed_by == null ? null : String(row.shipper_agreed_by),
    transporterAgreedByUserId:
      row.transporter_agreed_by == null ? null : String(row.transporter_agreed_by),
    decidedAt: iso(row.decided_at),
    previousTripAmount: { amountMinor: minorFromDb(row.previous_trip_minor), currency },
    newTripAmount: { amountMinor: minorFromDb(row.new_trip_minor), currency },
    previousCommission: {
      amountMinor: minorFromDb(row.previous_commission_minor),
      currency,
    },
    newCommission: { amountMinor: minorFromDb(row.new_commission_minor), currency },
    reducedOpenAmount: { amountMinor: minorFromDb(row.reduced_open_minor), currency },
    creditedAmount: { amountMinor: minorFromDb(row.credited_minor), currency },
    reason: String(row.reason),
    recordedByUserId: String(row.recorded_by),
    recordedAt: iso(row.recorded_at),
    fundsMovementClaimedByTruber: false,
  };
}

export function presentCommissionDisputeOutcome(row: OutcomeRow): CommissionDisputeOutcome {
  return {
    id: String(row.id),
    receivableId: String(row.receivable_id),
    bookingId: String(row.booking_id),
    transporterCompanyId: String(row.transporter_company_id),
    disputeRef: row.dispute_ref == null ? null : String(row.dispute_ref),
    kind: row.kind,
    source: row.source,
    adjustmentId: row.adjustment_id == null ? null : String(row.adjustment_id),
    reason: String(row.reason),
    actorUserId: String(row.actor_user_id),
    decidedAt: iso(row.decided_at),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    recordedAt: iso(row.recorded_at),
  };
}

export function finalAtFor(row: FinalAtRow, now: Date): Date | string | null {
  if (row.final_at != null) {
    return row.final_at;
  }
  if (row.status === 'held') {
    return null;
  }
  const windowEnd = dateValue(row.dispute_window_ends_at);
  if (now.getTime() >= windowEnd.getTime()) {
    return row.dispute_window_ends_at;
  }
  return null;
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async recognise(client: PoolClient | null, input: RecogniseReceivableInput): Promise<CommissionReceivable> {
    if (!client) {
      return this.db.tx((tx) => this.recognise(tx, input));
    }
    await lockCommissionExclusive(client, input.transporterCompanyId);
    const amount = commissionFor(input.tripAmount);
    const recognisedAt = input.completedAt ?? new Date();
    const disputeWindowEndsAt = new Date(recognisedAt.getTime() + DISPUTE_WINDOW_MS);
    const isZero = amount.amountMinor === 0;
    const status: CommissionReceivableStatus = isZero ? 'collected' : 'open';
    const id = randomUUID();

    let insertedId: string;
    try {
      const result = await this.query<{ id: string }>(
        client,
        `INSERT INTO commission_receivables (
           id, booking_id, transporter_company_id, currency, amount_minor, collected_minor,
           remaining_minor, status, payment_method, commission_rate_bps, recognised_at, settled_at,
           trip_minor, dispute_window_ends_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $10, $10)
         RETURNING id`,
        [
          id,
          input.bookingId,
          input.transporterCompanyId,
          amount.currency,
          amount.amountMinor,
          isZero ? 0 : amount.amountMinor,
          status,
          input.paymentMethod,
          COMMISSION_RATE_BPS,
          recognisedAt,
          isZero ? recognisedAt : null,
          input.tripAmount.amountMinor,
          disputeWindowEndsAt,
        ],
      );
      insertedId = String(result.rows[0].id);
    } catch (error) {
      if (isPgError(error) && error.code === '23505') {
        throw new ApiException(
          409,
          'COMMISSION_ALREADY_RECOGNISED',
          'Commission for this booking is already recognised.',
        );
      }
      throw error;
    }

    await this.netCredits(client, input.transporterCompanyId, amount.currency, insertedId);
    return presentCommissionReceivable(await this.loadReceivable(client, insertedId));
  }

  async voidForBooking(
    client: PoolClient | null,
    bookingId: string,
    opts: VoidForBookingOptions = {},
  ): Promise<CommissionReceivable> {
    if (!client) {
      return this.db.tx((tx) => this.voidForBooking(tx, bookingId, opts));
    }

    const at = requireDate(opts.at ?? new Date(), 'at');
    const row = await this.lockBookingReceivable(client, bookingId);

    if (row.status === 'held') {
      throw new ApiException(
        409,
        'DISPUTE_OPEN',
        'Commission is held by an open dispute.',
      );
    }
    if (row.status === 'cancelled') {
      throw new ApiException(409, 'RECEIVABLE_NOT_OPEN', 'Commission receivable is not open.');
    }
    if (
      row.final_at != null ||
      at.getTime() >= dateValue(row.dispute_window_ends_at).getTime()
    ) {
      throw new ApiException(
        409,
        'COMMISSION_FINAL',
        'Trip is locked; use a dispute adjustment.',
      );
    }

    const amount = BigInt(minorFromDb(row.amount_minor));
    const reduced = BigInt(minorFromDb(row.reduced_minor));
    const remaining = BigInt(minorFromDb(row.remaining_minor));
    const paid = amount - reduced - remaining;

    const updated = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET status = 'voided',
              remaining_minor = 0,
              voided_at = $2,
              updated_at = $2
        WHERE id = $1
        RETURNING *`,
      [row.id, at],
    );

    if (paid > 0n) {
      await this.query(
        client,
        `INSERT INTO commission_credits (
           id, company_id, currency, amount_minor, remaining_minor, source_kind,
           source_adjustment_id, source_receivable_id, created_at
         ) VALUES ($1, $2, $3, $4, $4, 'void', NULL, $5, $6)`,
        [randomUUID(), row.transporter_company_id, row.currency, safeMinor(paid), row.id, at],
      );
    }
    await this.netCredits(client, row.transporter_company_id, row.currency);

    return presentCommissionReceivable(updated.rows[0]);
  }

  async holdForDispute(
    client: PoolClient | null,
    input: HoldForDisputeInput,
  ): Promise<CommissionReceivable> {
    if (!client) {
      return this.db.tx((tx) => this.holdForDispute(tx, input));
    }

    const disputeRef = requireDisputeRef(input.disputeRef);
    const disputedAt = requireDate(input.disputedAt, 'disputedAt');
    const row = await this.lockBookingReceivable(client, input.bookingId);

    if (row.status === 'held') {
      if (row.dispute_ref === disputeRef) {
        return presentCommissionReceivable(row);
      }
      throw new ApiException(
        409,
        'DISPUTE_ALREADY_OPEN',
        'A different dispute is already open on this receivable.',
      );
    }
    if (row.final_at != null) {
      throw new ApiException(
        409,
        'COMMISSION_FINAL',
        'Trip is locked; use a dispute adjustment.',
      );
    }
    if (row.status === 'voided' || row.status === 'cancelled') {
      throw new ApiException(409, 'RECEIVABLE_NOT_OPEN', 'Commission receivable is not open.');
    }

    const recognisedAt = dateValue(row.recognised_at);
    if (disputedAt.getTime() < recognisedAt.getTime()) {
      throw validationError({ disputedAt: 'must be on or after recognisedAt' });
    }
    if (disputedAt.getTime() >= dateValue(row.dispute_window_ends_at).getTime()) {
      throw new ApiException(
        409,
        'DISPUTE_WINDOW_CLOSED',
        'The dispute window for this trip has closed.',
      );
    }

    const expectedDeadline = new Date(disputedAt.getTime() + RESPONSE_WINDOW_MS);
    if (
      input.responseDeadlineAt !== undefined &&
      requireDate(input.responseDeadlineAt, 'responseDeadlineAt').getTime() !==
        expectedDeadline.getTime()
    ) {
      throw validationError({
        responseDeadlineAt: 'must equal disputedAt + 48 hours',
      });
    }

    const updated = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET status = 'held',
              pre_hold_status = $2,
              dispute_ref = $3,
              disputed_at = $4,
              response_deadline_at = $5,
              final_at = NULL,
              updated_at = $4
        WHERE id = $1
        RETURNING *`,
      [row.id, row.status, disputeRef, disputedAt, expectedDeadline],
    );
    return presentCommissionReceivable(updated.rows[0]);
  }

  async recordDisputeResponse(
    client: PoolClient | null,
    input: RecordDisputeResponseInput,
  ): Promise<CommissionReceivable> {
    if (!client) {
      return this.db.tx((tx) => this.recordDisputeResponse(tx, input));
    }

    const disputeRef = requireDisputeRef(input.disputeRef);
    const respondedAt = requireDate(input.respondedAt, 'respondedAt');
    const row = await this.lockBookingReceivable(client, input.bookingId);

    if (row.status !== 'held' || row.dispute_ref !== disputeRef) {
      throw new ApiException(409, 'DISPUTE_NOT_OPEN', 'That dispute is not open.');
    }
    if (row.disputed_at != null && respondedAt.getTime() < dateValue(row.disputed_at).getTime()) {
      throw validationError({ respondedAt: 'must be on or after disputedAt' });
    }
    if (row.transporter_responded_at != null) {
      return presentCommissionReceivable(row);
    }

    const updated = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET transporter_responded_at = $2,
              updated_at = $2
        WHERE id = $1
        RETURNING *`,
      [row.id, respondedAt],
    );
    return presentCommissionReceivable(updated.rows[0]);
  }

  async finaliseAfterDispute(
    client: PoolClient | null,
    input: FinaliseAfterDisputeInput,
  ): Promise<DisputeFinalisation> {
    if (!client) {
      return this.db.tx((tx) => this.finaliseAfterDispute(tx, input));
    }

    const at = requireDate(input.at ?? new Date(), 'at');
    const requestHash = requestHashFor(input);
    const row = await this.lockBookingReceivable(client, input.bookingId);

    const replay = await this.readOutcome(client, row.id, input.idempotencyKey);
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw new ApiException(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used for a different request.',
        );
      }
      return {
        outcome: presentCommissionDisputeOutcome(replay),
        receivable: presentCommissionReceivable(await this.loadReceivable(client, row.id)),
      };
    }

    if (input.source === 'admin_decision') {
      await this.assertAdminActor(client, input.actorUserId);
    }

    const disputeRef = requireDisputeRef(input.disputeRef);
    if (row.status !== 'held' || row.dispute_ref !== disputeRef) {
      throw new ApiException(409, 'DISPUTE_NOT_OPEN', 'That dispute is not open.');
    }

    const reason = requireReason(input.outcomeReason);
    if (input.source !== 'party_settlement' && input.source !== 'admin_decision') {
      throw validationError({ source: 'must be party_settlement or admin_decision' });
    }

    if (
      input.source === 'admin_decision' &&
      row.transporter_responded_at == null &&
      row.disputed_at != null &&
      at.getTime() < dateValue(row.disputed_at).getTime() + RESPONSE_WINDOW_MS
    ) {
      throw new ApiException(
        409,
        'DISPUTE_RESPONSE_WINDOW_OPEN',
        'The transporter response window is still open.',
      );
    }

    const remaining = minorFromDb(row.remaining_minor);
    const previousStatus = row.pre_hold_status as DisputePreHoldStatus;
    let status: CommissionReceivableStatus;
    if (remaining > 0) {
      status = 'open';
    } else if (previousStatus === 'open') {
      status = 'collected';
    } else {
      status = previousStatus;
    }
    const settledAt = status === 'collected' ? row.settled_at ?? at : row.settled_at;

    await this.query(
      client,
      `UPDATE commission_receivables
          SET status = $2,
              final_at = $3,
              settled_at = $4,
              updated_at = $3
        WHERE id = $1`,
      [row.id, status, at, settledAt],
    );

    const recordedAt = new Date();
    const outcomeId = randomUUID();
    await this.query(
      client,
      `INSERT INTO commission_dispute_outcomes (
         id, receivable_id, booking_id, transporter_company_id, dispute_ref, kind, source,
         adjustment_id, reason, actor_user_id, decided_at, idempotency_key, request_hash, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, 'unchanged', $6, NULL, $7, $8, $9, $10, $11, $12)`,
      [
        outcomeId,
        row.id,
        row.booking_id,
        row.transporter_company_id,
        disputeRef,
        input.source,
        reason,
        input.actorUserId,
        at,
        input.idempotencyKey,
        requestHash,
        recordedAt,
      ],
    );

    await this.netCredits(client, row.transporter_company_id, row.currency);

    const outcome = await this.query<OutcomeRow>(
      client,
      `SELECT * FROM commission_dispute_outcomes WHERE id = $1`,
      [outcomeId],
    );
    return {
      outcome: presentCommissionDisputeOutcome(outcome.rows[0]),
      receivable: presentCommissionReceivable(await this.loadReceivable(client, row.id)),
    };
  }

  async adjustForResolvedDispute(
    client: PoolClient | null,
    input: AdjustForResolvedDisputeInput,
  ): Promise<CommissionAdjustmentResult> {
    if (!client) {
      return this.db.tx((tx) => this.adjustForResolvedDispute(tx, input));
    }

    const decidedAt = requireDate(input.decidedAt, 'decidedAt');
    const requestHash = requestHashFor(input);
    const row = await this.lockBookingReceivable(client, input.bookingId);

    const replay = await this.readOutcome(client, row.id, input.idempotencyKey);
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw new ApiException(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used for a different request.',
        );
      }
      if (!replay.adjustment_id) {
        throw new ApiException(404, 'NOT_FOUND', 'Commission adjustment not found.');
      }
      const adjustment = await this.loadAdjustment(client, replay.adjustment_id);
      return {
        adjustment: presentCommissionAdjustment(adjustment),
        receivable: presentCommissionReceivable(await this.loadReceivable(client, row.id)),
      };
    }

    if (input.source === 'admin_decision') {
      await this.assertAdminActor(client, input.actorUserId);
    }

    const reason = requireReason(input.reason);
    if (input.source !== 'party_settlement' && input.source !== 'admin_decision') {
      throw validationError({ source: 'must be party_settlement or admin_decision' });
    }
    const newTripAmount = assertMoney(input.newTripAmount, { allowZero: true });
    const suppliedDisputeRef =
      input.disputeRef === undefined ? null : requireDisputeRef(input.disputeRef);

    const held = row.status === 'held';
    let disputeRef: string | null = suppliedDisputeRef;
    let backstopDisputedAt: Date | null = null;
    let backstopRespondedAt: Date | null = null;
    let backstopApplies = false;

    if (held) {
      if (disputeRef == null || row.dispute_ref !== disputeRef) {
        throw new ApiException(409, 'DISPUTE_NOT_OPEN', 'That dispute is not open.');
      }
      backstopDisputedAt = row.disputed_at == null ? null : dateValue(row.disputed_at);
      backstopRespondedAt =
        row.transporter_responded_at == null
          ? null
          : dateValue(row.transporter_responded_at);
      backstopApplies = true;
    } else {
      if (row.status === 'voided' || row.status === 'cancelled') {
        throw new ApiException(409, 'RECEIVABLE_NOT_OPEN', 'Commission receivable is not open.');
      }
      const insideWindow =
        row.final_at == null &&
        decidedAt.getTime() < dateValue(row.dispute_window_ends_at).getTime();
      if (insideWindow) {
        throw new ApiException(409, 'DISPUTE_NOT_OPEN', 'That dispute is not open.');
      }
      if (input.source !== 'admin_decision') {
        throw new ApiException(
          409,
          'COMMISSION_FINAL',
          'Trip is locked; use a dispute adjustment.',
        );
      }
      if (disputeRef == null && input.disputedAt === undefined) {
        disputeRef = null;
      } else {
        if (input.disputedAt === undefined) {
          throw validationError({ disputedAt: 'required for a late admin decision' });
        }
        backstopDisputedAt = requireDate(input.disputedAt, 'disputedAt');
        backstopRespondedAt =
          input.transporterRespondedAt === undefined
            ? null
            : requireDate(input.transporterRespondedAt, 'transporterRespondedAt');
        backstopApplies = true;
      }
    }

    if (
      backstopApplies &&
      input.source === 'admin_decision' &&
      backstopRespondedAt == null &&
      (backstopDisputedAt == null ||
        decidedAt.getTime() < backstopDisputedAt.getTime() + RESPONSE_WINDOW_MS)
    ) {
      throw new ApiException(
        409,
        'DISPUTE_RESPONSE_WINDOW_OPEN',
        'The transporter response window is still open.',
      );
    }

    if (newTripAmount.currency !== String(row.currency)) {
      throw new ApiException(
        409,
        'CURRENCY_MISMATCH',
        'All amounts must use the same currency.',
      );
    }
    if (row.trip_minor == null) {
      throw new ApiException(
        409,
        'TRIP_AMOUNT_UNKNOWN',
        'The original trip amount is unknown for this legacy receivable.',
      );
    }

    if (input.source === 'party_settlement') {
      const missing: Record<string, string> = {};
      if (!input.shipperCompanyId) missing.shipperCompanyId = 'required for party settlement';
      if (!input.shipperAgreedBy) missing.shipperAgreedBy = 'required for party settlement';
      if (!input.transporterAgreedBy) {
        missing.transporterAgreedBy = 'required for party settlement';
      }
      if (Object.keys(missing).length > 0) {
        throw validationError(missing);
      }

      const transporterMember = await this.query<QueryResultRow>(
        client,
        `SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2`,
        [row.transporter_company_id, input.transporterAgreedBy],
      );
      if (!transporterMember.rowCount) {
        throw new ApiException(403, 'FORBIDDEN', 'The transporter agreer is not a company member.');
      }

      const shipper = await this.query<{ type: string }>(
        client,
        `SELECT c.type
           FROM companies c
           JOIN company_members cm ON cm.company_id = c.id AND cm.user_id = $2
          WHERE c.id = $1`,
        [input.shipperCompanyId, input.shipperAgreedBy],
      );
      if (!shipper.rows[0] || shipper.rows[0].type !== 'shipper') {
        throw new ApiException(403, 'FORBIDDEN', 'The shipper agreer is not a shipper member.');
      }
    }

    const latest = await this.query<LatestAdjustmentRow>(
      client,
      `SELECT new_trip_minor, new_commission_minor
         FROM commission_adjustments
        WHERE receivable_id = $1
        ORDER BY recorded_at DESC, decided_at DESC, id DESC
        LIMIT 1`,
      [row.id],
    );
    const previousTrip = latest.rows[0]
      ? minorFromDb(latest.rows[0].new_trip_minor)
      : minorFromDb(row.trip_minor);
    const previousCommission = latest.rows[0]
      ? minorFromDb(latest.rows[0].new_commission_minor)
      : minorFromDb(row.amount_minor);
    const remaining = minorFromDb(row.remaining_minor);
    const reduced = minorFromDb(row.reduced_minor);
    const collected = minorFromDb(row.collected_minor);
    const creditApplied = minorFromDb(row.credit_applied_minor);

    const plan = planAdjustment({
      previousTripMinor: previousTrip,
      previousCommissionMinor: previousCommission,
      newTripMinor: newTripAmount.amountMinor,
      remainingMinor: remaining,
      currency: String(row.currency),
    });

    const newRemaining = remaining - plan.reducedOpenMinor;
    const newReduced = reduced + plan.reducedOpenMinor;
    const baseStatus: DisputePreHoldStatus = held
      ? (row.pre_hold_status as DisputePreHoldStatus)
      : (row.status as DisputePreHoldStatus);

    let status: CommissionReceivableStatus;
    if (newRemaining > 0) {
      status = 'open';
    } else if (baseStatus === 'settled_on_release') {
      status = 'settled_on_release';
    } else if (collected + creditApplied > 0) {
      status = 'collected';
    } else {
      status = 'cancelled';
    }

    const finalAt = row.final_at != null ? row.final_at : decidedAt;
    const settledAt = status === 'collected' ? row.settled_at ?? decidedAt : row.settled_at;

    await this.query(
      client,
      `UPDATE commission_receivables
          SET remaining_minor = $2,
              reduced_minor = $3,
              status = $4,
              final_at = $5,
              settled_at = $6,
              updated_at = $7
        WHERE id = $1`,
      [row.id, newRemaining, newReduced, status, finalAt, settledAt, decidedAt],
    );

    const adjustmentId = randomUUID();
    const recordedAt = new Date();
    const adjustment = await this.query<AdjustmentRow>(
      client,
      `INSERT INTO commission_adjustments (
         id, booking_id, receivable_id, transporter_company_id, dispute_ref, source,
         shipper_agreed_by, transporter_agreed_by, decided_at, currency, previous_trip_minor,
         new_trip_minor, previous_commission_minor, new_commission_minor, reduced_open_minor,
         credited_minor, reason, recorded_by, recorded_at, idempotency_key, request_hash
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         $18, $19, $20, $21
       )
       RETURNING *`,
      [
        adjustmentId,
        row.booking_id,
        row.id,
        row.transporter_company_id,
        disputeRef,
        input.source,
        input.shipperAgreedBy ?? null,
        input.transporterAgreedBy ?? null,
        decidedAt,
        row.currency,
        previousTrip,
        newTripAmount.amountMinor,
        previousCommission,
        plan.newCommissionMinor,
        plan.reducedOpenMinor,
        plan.creditedMinor,
        reason,
        input.actorUserId,
        recordedAt,
        input.idempotencyKey,
        requestHash,
      ],
    );

    if (plan.creditedMinor > 0) {
      await this.query(
        client,
        `INSERT INTO commission_credits (
           id, company_id, currency, amount_minor, remaining_minor, source_kind,
           source_adjustment_id, source_receivable_id, created_at
         ) VALUES ($1, $2, $3, $4, $4, 'adjustment', $5, NULL, $6)`,
        [
          randomUUID(),
          row.transporter_company_id,
          row.currency,
          plan.creditedMinor,
          adjustmentId,
          decidedAt,
        ],
      );
    }

    await this.query(
      client,
      `INSERT INTO commission_dispute_outcomes (
         id, receivable_id, booking_id, transporter_company_id, dispute_ref, kind, source,
         adjustment_id, reason, actor_user_id, decided_at, idempotency_key, request_hash, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, 'adjusted', $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        row.id,
        row.booking_id,
        row.transporter_company_id,
        disputeRef,
        input.source,
        adjustmentId,
        reason,
        input.actorUserId,
        decidedAt,
        input.idempotencyKey,
        requestHash,
        recordedAt,
      ],
    );

    await this.netCredits(client, row.transporter_company_id, row.currency);

    return {
      adjustment: presentCommissionAdjustment(adjustment.rows[0]),
      receivable: presentCommissionReceivable(await this.loadReceivable(client, row.id)),
    };
  }

  async settleOnRelease(client: PoolClient | null, bookingId: string): Promise<CommissionReceivable> {
    if (!client) {
      return this.db.tx((tx) => this.settleOnRelease(tx, bookingId));
    }

    const owner = await this.query<{ transporter_company_id: string }>(
      client,
      `SELECT transporter_company_id
         FROM commission_receivables
        WHERE booking_id = $1
          AND status <> 'voided'
        ORDER BY recognised_at DESC, id DESC
        LIMIT 1`,
      [bookingId],
    );
    if (!owner.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    await lockCommissionExclusive(client, owner.rows[0].transporter_company_id);

    const updated = await this.query<ReceivableRow>(
      client,
      `UPDATE commission_receivables
          SET status = 'settled_on_release',
              remaining_minor = 0,
              settled_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE booking_id = $1
          AND status = 'open'
          AND payment_method <> 'cash'
        RETURNING *`,
      [bookingId],
    );
    const row = updated.rows[0];
    if (row) {
      return presentCommissionReceivable(row);
    }

    const existing = await this.query<{
      status: CommissionReceivableStatus;
      payment_method: PaymentMethod;
    }>(
      client,
      `SELECT status, payment_method
         FROM commission_receivables
        WHERE booking_id = $1
          AND status <> 'voided'
        ORDER BY recognised_at DESC, id DESC
        LIMIT 1`,
      [bookingId],
    );
    const receivable = existing.rows[0];
    if (!receivable) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    if (receivable.payment_method === 'cash') {
      throw new ApiException(
        409,
        'CASH_COMMISSION_NOT_SETTLED_BY_RELEASE',
        'Cash commission stays owing until collected.',
      );
    }
    throw new ApiException(409, 'RECEIVABLE_NOT_OPEN', 'Commission receivable is not open.');
  }

  async outstandingByCurrency(client: PoolClient | null, companyId: string): Promise<Money[]> {
    const result = await this.query<OutstandingRow>(
      client,
      `SELECT currency, sum(remaining_minor) AS total_minor
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND status = ANY($2::text[])
          AND remaining_minor > 0
        GROUP BY currency
        ORDER BY currency`,
      [companyId, [...owingStatuses()]],
    );
    return result.rows.map((row) => ({
      amountMinor: minorFromDb(row.total_minor),
      currency: String(row.currency),
    }));
  }

  async commissionBalances(
    client: PoolClient | null,
    companyId: string,
  ): Promise<CommissionBalances> {
    const credits = await this.query<OutstandingRow>(
      client,
      `SELECT currency, sum(remaining_minor) AS total_minor
         FROM commission_credits
        WHERE company_id = $1
          AND remaining_minor > 0
        GROUP BY currency
        ORDER BY currency`,
      [companyId],
    );
    const held = await this.query<OutstandingRow>(
      client,
      `SELECT currency, sum(remaining_minor) AS total_minor
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND status = 'held'
          AND remaining_minor > 0
        GROUP BY currency
        ORDER BY currency`,
      [companyId],
    );
    return {
      outstandingByCurrency: await this.outstandingByCurrency(client, companyId),
      creditByCurrency: credits.rows.map((row) => ({
        amountMinor: minorFromDb(row.total_minor),
        currency: String(row.currency),
      })),
      heldByCurrency: held.rows.map((row) => ({
        amountMinor: minorFromDb(row.total_minor),
        currency: String(row.currency),
      })),
    };
  }

  /**
   * Hook for Mark's repeat-abuse ban. Billing never bans; it only reports how
   * many dispute adjustments a transporter has recorded since a timestamp.
   */
  async countAdjustmentsAgainst(
    client: PoolClient | null,
    companyId: string,
    since: Date,
  ): Promise<number> {
    const result = await this.query<{ count: string | number }>(
      client,
      `SELECT count(*) AS count
         FROM commission_adjustments
        WHERE transporter_company_id = $1
          AND recorded_at >= $2`,
      [companyId, since],
    );
    return minorFromDb(result.rows[0].count);
  }

  async account(companyId: string): Promise<CommissionAccount> {
    return this.db.tx(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const balances = await this.commissionBalances(client, companyId);
      const result = await this.query<ReceivableRow>(
        client,
        `SELECT *
           FROM commission_receivables
          WHERE transporter_company_id = $1
          ORDER BY recognised_at ASC, id ASC`,
        [companyId],
      );
      const account: CommissionAccount = {
        companyId,
        outstandingByCurrency: balances.outstandingByCurrency,
        heldByCurrency: balances.heldByCurrency,
        creditByCurrency: balances.creditByCurrency,
        receivables: result.rows.map((row) => presentCommissionReceivable(row)),
      };
      if (balances.outstandingByCurrency.length === 1) {
        account.outstandingAmount = balances.outstandingByCurrency[0];
      }
      return account;
    });
  }

  private async recordCollection(
    actor: DbUser,
    companyId: string,
    input: RecordCollectionInput,
    client: PoolClient | null = null,
  ): Promise<CommissionCollectionRecord> {
    const amount = assertMoney(input.amount);
    if (client) {
      return this.applyCollection(client, actor, companyId, amount, input);
    }
    return this.db.tx((tx) => this.applyCollection(tx, actor, companyId, amount, input));
  }

  async accountFor(actor: DbUser, companyId: string): Promise<CommissionAccount> {
    const company = await this.db.query<{ id: string; type: string }>(
      'SELECT id, type FROM companies WHERE id = $1',
      [companyId],
    );
    if (!company.rows[0] || company.rows[0].type !== 'transporter') {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      const member = await this.db.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
        companyId,
        actor.id,
      ]);
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }
    return this.account(companyId);
  }

  async listAdjustmentsFor(
    actor: DbUser,
    companyId: string,
    page?: number,
    pageSize?: number,
  ): Promise<{ data: CommissionAdjustment[]; meta: ReturnType<typeof pageMeta> }> {
    const company = await this.db.query<{ id: string; type: string }>(
      'SELECT id, type FROM companies WHERE id = $1',
      [companyId],
    );
    if (!company.rows[0] || company.rows[0].type !== 'transporter') {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      if (actor.role === 'shipper') {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      const member = await this.db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, actor.id],
      );
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }

    const window = pageWindow(page, pageSize);
    const total = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM commission_adjustments
        WHERE transporter_company_id = $1`,
      [companyId],
    );
    const rows = await this.db.query<AdjustmentRow>(
      `SELECT *
         FROM commission_adjustments
        WHERE transporter_company_id = $1
        ORDER BY recorded_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [companyId, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentCommissionAdjustment(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async recordCollectionForAdmin(
    actor: DbUser,
    companyId: string,
    input: RecordCollectionInput,
    idempotencyKey: string | undefined,
  ): Promise<CommissionCollectionRecord> {
    if (actor.role !== 'admin') {
      throw new ApiException(403, 'ADMIN_ONLY', 'Only an admin can record commission collections.');
    }
    this.assertCollectionIdempotencyKey(idempotencyKey);
    const requestHash = sha256(canonicalJson({ companyId, body: input }));
    return this.db.tx(async (client) => {
      const company = await client.query<{ id: string; type: string }>(
        'SELECT id, type FROM companies WHERE id = $1',
        [companyId],
      );
      if (!company.rows[0] || company.rows[0].type !== 'transporter') {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
      const replay = await this.readIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'recordCommissionCollection',
        requestHash,
      );
      if (replay) {
        return replay;
      }
      const body = await this.recordCollection(actor, companyId, input, client);
      await this.storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'recordCommissionCollection',
        requestHash,
        body,
      );
      return body;
    });
  }

  private async applyCollection(
    client: PoolClient,
    actor: DbUser,
    companyId: string,
    amount: Money,
    input: RecordCollectionInput,
  ): Promise<CommissionCollectionRecord> {
    await lockCommissionExclusive(client, companyId);
    const currency = amount.currency;
    const receiptRefNormalised = normaliseReceiptRef(input.externalReference);
    if (receiptRefNormalised != null) {
      const duplicate = await this.query<{ id: string }>(
        client,
        `SELECT id
           FROM commission_collections
          WHERE company_id = $1
            AND currency = $2
            AND receipt_ref_normalised = $3
          LIMIT 1`,
        [companyId, currency, receiptRefNormalised],
      );
      if (duplicate.rows[0]) {
        throw duplicateCollectionError();
      }
    }
    const rows = await this.query<OpenReceivableRow>(
      client,
      `SELECT id, status, collected_minor, remaining_minor
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND currency = $2
          AND status = ANY($3::text[])
          AND remaining_minor > 0
        ORDER BY recognised_at ASC, id ASC
        FOR UPDATE`,
      [companyId, currency, [...owingStatuses()]],
    );

    let left = BigInt(amount.amountMinor);
    const recordedAt = new Date();
    const collectionId = randomUUID();
    const allocations: { receivableId: string; amountMinor: number }[] = [];

    for (const row of rows.rows) {
      if (left <= 0n) {
        break;
      }
      const remaining = BigInt(minorFromDb(row.remaining_minor));
      const collected = BigInt(minorFromDb(row.collected_minor));
      const applied = remaining < left ? remaining : left;
      if (applied <= 0n) {
        continue;
      }
      const newRemaining = remaining - applied;
      const newCollected = collected + applied;
      await this.query(
        client,
        `UPDATE commission_receivables
            SET collected_minor = $2,
                remaining_minor = $3,
                status = $4,
                settled_at = $5,
                updated_at = $6
          WHERE id = $1`,
        [
          row.id,
          safeMinor(newCollected),
          safeMinor(newRemaining),
          newRemaining === 0n ? 'collected' : row.status,
          newRemaining === 0n ? recordedAt : null,
          recordedAt,
        ],
      );
      allocations.push({ receivableId: row.id, amountMinor: safeMinor(applied) });
      left -= applied;
    }

    const creditedMinor = safeMinor(left);
    try {
      await this.query(
        client,
        `INSERT INTO commission_collections (
           id, company_id, currency, amount_minor, credited_minor, external_reference,
           receipt_ref_normalised, notes, recorded_by, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          collectionId,
          companyId,
          currency,
          amount.amountMinor,
          creditedMinor,
          input.externalReference ?? null,
          receiptRefNormalised,
          input.notes ?? null,
          actor.id,
          recordedAt,
        ],
      );
    } catch (error) {
      if (
        isPgError(error) &&
        error.code === '23505' &&
        (error as { constraint?: string }).constraint === 'commission_collections_receipt_uidx'
      ) {
        throw duplicateCollectionError();
      }
      throw error;
    }

    if (left > 0n) {
      await this.query(
        client,
        `INSERT INTO commission_credits (
           id, company_id, currency, amount_minor, remaining_minor, source_kind,
           source_adjustment_id, source_receivable_id, source_collection_id, created_at
         ) VALUES ($1, $2, $3, $4, $4, 'collection', NULL, NULL, $5, $6)`,
        [randomUUID(), companyId, currency, safeMinor(left), collectionId, recordedAt],
      );
    }

    for (const allocation of allocations) {
      await this.query(
        client,
        `INSERT INTO commission_collection_allocations (collection_id, receivable_id, amount_minor)
         VALUES ($1, $2, $3)`,
        [collectionId, allocation.receivableId, allocation.amountMinor],
      );
    }

    await this.netCredits(client, companyId, currency);

    const outstandingByCurrencyAfter = await this.outstandingByCurrency(client, companyId);
    const outstandingAmountAfter =
      outstandingByCurrencyAfter.find((entry) => entry.currency === currency) ?? {
        amountMinor: 0,
        currency,
      };

    return {
      id: collectionId,
      companyId,
      amount,
      outstandingAmountAfter,
      outstandingByCurrencyAfter,
      creditedAmount: { amountMinor: creditedMinor, currency },
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
      fundsMovementClaimedByTruber: false,
      recordedAt: iso(recordedAt),
      recordedByUserId: actor.id,
    };
  }

  /**
   * U1 (user decision 11 Nov 2026 16:37 CAT) applies to dispute/void credit only.
   * Collection credit is the transporter's own payment and always pays what they owe
   * (Mark review L2, 17 Nov). When true, every credit kind may offset existing debt.
   * When false, only 'collection' credit offsets existing debt; 'adjustment' and 'void'
   * credit offsets commission recognised after the credit exists.
   */
  private creditMayOffsetExisting(): boolean {
    return this.env.BILLING_CREDIT_OFFSETS_EXISTING;
  }

  private creditKindsForExistingDebt(): CreditSourceKind[] {
    return this.creditMayOffsetExisting()
      ? ['adjustment', 'void', 'collection']
      : ['collection'];
  }

  private async assertAdminActor(client: PoolClient, actorUserId: string): Promise<void> {
    const result = await this.query<{ role: string }>(
      client,
      `SELECT role FROM users WHERE id = $1`,
      [actorUserId],
    );
    if (result.rows[0]?.role !== 'admin') {
      throw new ApiException(
        403,
        'ADMIN_ONLY',
        'Only an admin can record an admin decision.',
      );
    }
  }

  private async netCredits(
    client: PoolClient,
    companyId: string,
    currency: string,
    newReceivableId: string | null = null,
  ): Promise<void> {
    await this.applyCredits(
      client,
      companyId,
      currency,
      this.creditKindsForExistingDebt(),
      null,
    );
    if (!this.creditMayOffsetExisting() && newReceivableId != null) {
      await this.applyCredits(client, companyId, currency, null, newReceivableId);
    }
  }

  private async applyCredits(
    client: PoolClient,
    companyId: string,
    currency: string,
    sourceKinds: CreditSourceKind[] | null,
    onlyReceivableId: string | null,
  ): Promise<void> {
    const creditParams: unknown[] = [companyId, currency];
    const kindsClause =
      sourceKinds == null ? '' : ` AND source_kind = ANY($${creditParams.push(sourceKinds)}::text[])`;
    const credits = await this.query<CreditRow>(
      client,
      `SELECT id, company_id, currency, amount_minor, remaining_minor, source_kind, created_at
         FROM commission_credits
        WHERE company_id = $1
          AND currency = $2
          AND remaining_minor > 0${kindsClause}
        ORDER BY created_at ASC, id ASC
        FOR UPDATE`,
      creditParams,
    );
    if (credits.rows.length === 0) {
      return;
    }

    const params: unknown[] = [companyId, currency, [...owingStatuses()]];
    const onlyReceivableClause =
      onlyReceivableId == null ? '' : ` AND id = $${params.push(onlyReceivableId)}`;
    const receivables = await this.query<ReceivableRow>(
      client,
      `SELECT *
         FROM commission_receivables
        WHERE transporter_company_id = $1
          AND currency = $2
          AND status = ANY($3::text[])
          AND remaining_minor > 0${onlyReceivableClause}
        ORDER BY recognised_at ASC, id ASC
        FOR UPDATE`,
      params,
    );
    if (receivables.rows.length === 0) {
      return;
    }

    const remainingByCredit = credits.rows.map((credit) => ({
      id: String(credit.id),
      remaining: BigInt(minorFromDb(credit.remaining_minor)),
    }));
    const appliedByCredit = new Map<string, bigint>();

    let creditIndex = 0;
    let receivableIndex = 0;
    while (creditIndex < remainingByCredit.length && receivableIndex < receivables.rows.length) {
      const credit = remainingByCredit[creditIndex];
      const receivable = receivables.rows[receivableIndex];
      if (credit.remaining <= 0n) {
        creditIndex += 1;
        continue;
      }

      const remaining = BigInt(minorFromDb(receivable.remaining_minor));
      const applied = credit.remaining < remaining ? credit.remaining : remaining;
      if (applied <= 0n) {
        receivableIndex += 1;
        continue;
      }

      const creditApplied = BigInt(minorFromDb(receivable.credit_applied_minor)) + applied;
      const newRemaining = remaining - applied;
      const collectedAt = new Date();
      await this.query(
        client,
        `INSERT INTO commission_credit_allocations (
           credit_id, receivable_id, amount_minor, created_at
         ) VALUES ($1, $2, $3, $4)`,
        [credit.id, receivable.id, safeMinor(applied), collectedAt],
      );
      await this.query(
        client,
        `UPDATE commission_receivables
            SET remaining_minor = $2,
                credit_applied_minor = $3,
                status = $4,
                settled_at = $5,
                updated_at = $6
          WHERE id = $1`,
        [
          receivable.id,
          safeMinor(newRemaining),
          safeMinor(creditApplied),
          newRemaining === 0n ? 'collected' : receivable.status,
          newRemaining === 0n ? collectedAt : receivable.settled_at,
          collectedAt,
        ],
      );
      receivable.remaining_minor = safeMinor(newRemaining);
      receivable.credit_applied_minor = safeMinor(creditApplied);
      receivable.status = newRemaining === 0n ? 'collected' : receivable.status;

      credit.remaining -= applied;
      appliedByCredit.set(credit.id, (appliedByCredit.get(credit.id) ?? 0n) + applied);

      if (newRemaining === 0n) {
        receivableIndex += 1;
      }
      if (credit.remaining === 0n) {
        creditIndex += 1;
      }
    }

    for (const [creditId, applied] of appliedByCredit) {
      await this.query(
        client,
        `UPDATE commission_credits
            SET remaining_minor = remaining_minor - $2
          WHERE id = $1`,
        [creditId, safeMinor(applied)],
      );
    }
  }

  private async lockBookingReceivable(
    client: PoolClient,
    bookingId: string,
  ): Promise<ReceivableRow> {
    const owner = await this.query<{ transporter_company_id: string }>(
      client,
      `SELECT transporter_company_id
         FROM commission_receivables
        WHERE booking_id = $1
          AND status <> 'voided'
        ORDER BY recognised_at DESC, id DESC
        LIMIT 1`,
      [bookingId],
    );
    const ownerRow = owner.rows[0];
    if (!ownerRow) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    await lockCommissionExclusive(client, ownerRow.transporter_company_id);

    const result = await this.query<ReceivableRow>(
      client,
      `SELECT *
         FROM commission_receivables
        WHERE booking_id = $1
          AND status <> 'voided'
        ORDER BY recognised_at DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [bookingId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Commission receivable not found.');
    }
    return row;
  }

  private async loadReceivable(client: PoolClient, id: string): Promise<ReceivableRow> {
    const result = await this.query<ReceivableRow>(
      client,
      `SELECT * FROM commission_receivables WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  private async loadAdjustment(client: PoolClient, id: string): Promise<AdjustmentRow> {
    const result = await this.query<AdjustmentRow>(
      client,
      `SELECT * FROM commission_adjustments WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  private async readOutcome(
    client: PoolClient,
    receivableId: string,
    idempotencyKey: string,
  ): Promise<OutcomeRow | null> {
    const result = await this.query<OutcomeRow>(
      client,
      `SELECT *
         FROM commission_dispute_outcomes
        WHERE receivable_id = $1
          AND idempotency_key = $2`,
      [receivableId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private assertCollectionIdempotencyKey(key: string | undefined): void {
    if (key === undefined) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { 'Idempotency-Key': 'required' },
      });
    }
    if (!/^[\x21-\x7E]{8,128}$/.test(key)) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { 'Idempotency-Key': 'must be 8 to 128 visible ASCII characters' },
      });
    }
  }

  private async readIdempotency(
    client: PoolClient,
    userId: string,
    key: string | undefined,
    operation: string,
    requestHash: string,
  ): Promise<CommissionCollectionRecord | null> {
    if (!key) return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${operation}:${key}`]);
    const existing = await client.query<{
      request_hash: string;
      response_body: CommissionCollectionRecord;
    }>(
      `SELECT request_hash, response_body
         FROM idempotency_records
        WHERE user_id = $1 AND idempotency_key = $2 AND operation = $3`,
      [userId, key, operation],
    );
    const prev = existing.rows[0];
    if (!prev) return null;
    if (prev.request_hash !== requestHash) {
      throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request.');
    }
    return prev.response_body;
  }

  private async storeIdempotency(
    client: PoolClient,
    userId: string,
    key: string | undefined,
    operation: string,
    requestHash: string,
    body: CommissionCollectionRecord,
  ): Promise<void> {
    if (!key) return;
    await client.query(
      `INSERT INTO idempotency_records (
         id, user_id, idempotency_key, operation, request_hash, status_code, response_body, created_at
       ) VALUES ($1, $2, $3, $4, $5, 201, $6::jsonb, clock_timestamp())`,
      [randomUUID(), userId, key, operation, requestHash, JSON.stringify(body)],
    );
  }

  private query<T extends QueryResultRow = QueryResultRow>(
    client: PoolClient | null,
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    if (client) {
      return client.query<T>(text, params);
    }
    return this.db.query<T>(text, params);
  }
}

function requestHashFor(value: unknown): string {
  return sha256(canonicalJson(normaliseForHash(value)));
}

function normaliseForHash(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normaliseForHash(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      out[key] = normaliseForHash(record[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
