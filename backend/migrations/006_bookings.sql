-- Bookings slice (API v0.5.0): confirmation, trip progress, completion, the 24-hour
-- dispute window, disputes, and append-only commission adjustment audit seams.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_recognised_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid REFERENCES users (id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS before_collection boolean;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check CHECK (
  payment_method IS NULL
  OR payment_method IN ('prepay', 'escrow', 'deposit_balance', 'cash', 'corporate_credit')
);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_cancel_reason_len;
ALTER TABLE bookings ADD CONSTRAINT bookings_cancel_reason_len CHECK (
  cancel_reason IS NULL OR char_length(cancel_reason) <= 2000
);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_cancelled_pair_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_cancelled_pair_check CHECK (
  (status = 'cancelled') = (cancelled_at IS NOT NULL)
);

-- A cancelled booking keeps any confirmation history it already had; a confirmed booking
-- still always has an arrangement and confirmation time.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_confirmed_pair_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_confirmed_pair_check CHECK (
  (status = 'confirmed'
    AND confirmed_payment_arrangement_id IS NOT NULL
    AND confirmed_at IS NOT NULL)
  OR (status = 'pending_payment_arrangement'
    AND confirmed_payment_arrangement_id IS NULL
    AND confirmed_at IS NULL)
  OR (status = 'cancelled'
    AND (confirmed_payment_arrangement_id IS NULL) = (confirmed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS booking_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings (id),
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users (id),
  reason text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  CONSTRAINT booking_events_action_check CHECK (
    action IN (
      'trip_status',
      'confirmed',
      'admin_confirm_override',
      'cancelled',
      'delivery_accepted',
      'delivery_disputed',
      'dispute_opened',
      'dispute_responded',
      'dispute_settled',
      'dispute_resolved',
      'adjustment_recorded'
    )
  ),
  CONSTRAINT booking_events_reason_len CHECK (
    reason IS NULL OR char_length(reason) <= 2000
  )
);

CREATE INDEX IF NOT EXISTS booking_events_booking_idx ON booking_events (booking_id, created_at);

CREATE TABLE IF NOT EXISTS delivery_confirmations (
  booking_id uuid PRIMARY KEY REFERENCES bookings (id),
  decision text NOT NULL,
  notes text,
  confirmed_by_user_id uuid NOT NULL REFERENCES users (id),
  confirmed_at timestamptz NOT NULL,
  CONSTRAINT delivery_confirmations_decision_check CHECK (
    decision IN ('accepted', 'disputed')
  ),
  CONSTRAINT delivery_confirmations_notes_len CHECK (
    notes IS NULL OR char_length(notes) <= 2000
  )
);

CREATE TABLE IF NOT EXISTS booking_disputes (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings (id),
  stage text NOT NULL,
  raised_by_user_id uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  proposed_amount_minor integer,
  currency text NOT NULL,
  status text NOT NULL,
  opened_at timestamptz NOT NULL,
  response_due_at timestamptz NOT NULL,
  response_by_user_id uuid REFERENCES users (id),
  responded_at timestamptz,
  response_statement text,
  response_evidence jsonb,
  counter_offer_amount_minor integer,
  settlement_amount_minor integer,
  settlement_accepted_by_user_id uuid REFERENCES users (id),
  settlement_accepted_at timestamptz,
  settlement_adjustment_id uuid,
  resolution_outcome text,
  resolution_reason text,
  resolution_adjusted_amount_minor integer,
  resolution_adjustment_id uuid,
  resolved_by_user_id uuid REFERENCES users (id),
  resolved_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT booking_disputes_stage_check CHECK (
    stage IN ('at_delivery_confirmation', 'dispute_window')
  ),
  CONSTRAINT booking_disputes_status_check CHECK (
    status IN ('awaiting_transporter_response', 'transporter_responded', 'settled', 'resolved')
  ),
  CONSTRAINT booking_disputes_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT booking_disputes_reason_len CHECK (
    char_length(reason) BETWEEN 10 AND 4000
  ),
  CONSTRAINT booking_disputes_proposed_amount_check CHECK (
    proposed_amount_minor IS NULL OR proposed_amount_minor >= 0
  ),
  CONSTRAINT booking_disputes_counter_offer_amount_check CHECK (
    counter_offer_amount_minor IS NULL OR counter_offer_amount_minor >= 0
  ),
  CONSTRAINT booking_disputes_settlement_amount_check CHECK (
    settlement_amount_minor IS NULL OR settlement_amount_minor >= 0
  ),
  CONSTRAINT booking_disputes_resolution_amount_check CHECK (
    resolution_adjusted_amount_minor IS NULL OR resolution_adjusted_amount_minor >= 0
  ),
  CONSTRAINT booking_disputes_response_due_check CHECK (
    response_due_at = opened_at + interval '48 hours'
  ),
  CONSTRAINT booking_disputes_response_pair_check CHECK (
    (response_by_user_id IS NULL AND responded_at IS NULL AND response_statement IS NULL)
    OR (response_by_user_id IS NOT NULL AND responded_at IS NOT NULL AND response_statement IS NOT NULL)
  ),
  CONSTRAINT booking_disputes_settlement_pair_check CHECK (
    (settlement_amount_minor IS NULL
      AND settlement_accepted_by_user_id IS NULL
      AND settlement_accepted_at IS NULL
      AND settlement_adjustment_id IS NULL)
    OR (settlement_amount_minor IS NOT NULL
      AND settlement_accepted_by_user_id IS NOT NULL
      AND settlement_accepted_at IS NOT NULL)
  ),
  CONSTRAINT booking_disputes_resolution_pair_check CHECK (
    (resolution_outcome IS NULL
      AND resolution_reason IS NULL
      AND resolution_adjusted_amount_minor IS NULL
      AND resolution_adjustment_id IS NULL
      AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL)
    OR (resolution_outcome IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND resolved_by_user_id IS NOT NULL
      AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT booking_disputes_resolution_outcome_check CHECK (
    resolution_outcome IS NULL
    OR resolution_outcome IN ('complete_trip', 'adjust_amount', 'cancel_trip')
  ),
  CONSTRAINT booking_disputes_status_pair_check CHECK (
    (status IN ('awaiting_transporter_response', 'transporter_responded')
      AND settlement_amount_minor IS NULL
      AND settlement_accepted_by_user_id IS NULL
      AND settlement_accepted_at IS NULL
      AND settlement_adjustment_id IS NULL
      AND resolution_outcome IS NULL
      AND resolution_reason IS NULL
      AND resolution_adjusted_amount_minor IS NULL
      AND resolution_adjustment_id IS NULL
      AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL
      AND closed_at IS NULL)
    OR (status = 'settled'
      AND settlement_amount_minor IS NOT NULL
      AND settlement_accepted_by_user_id IS NOT NULL
      AND settlement_accepted_at IS NOT NULL
      AND resolution_outcome IS NULL
      AND resolution_reason IS NULL
      AND resolution_adjusted_amount_minor IS NULL
      AND resolution_adjustment_id IS NULL
      AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL
      AND closed_at IS NOT NULL)
    OR (status = 'resolved'
      AND resolution_outcome IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND resolved_by_user_id IS NOT NULL
      AND resolved_at IS NOT NULL
      AND settlement_amount_minor IS NULL
      AND settlement_accepted_by_user_id IS NULL
      AND settlement_accepted_at IS NULL
      AND settlement_adjustment_id IS NULL
      AND closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS booking_disputes_booking_idx ON booking_disputes (booking_id, opened_at);

CREATE UNIQUE INDEX IF NOT EXISTS booking_disputes_one_open_per_booking_idx
  ON booking_disputes (booking_id)
  WHERE status IN ('awaiting_transporter_response', 'transporter_responded');

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  booking_id uuid,
  dispute_id uuid,
  recipient_company_id uuid NOT NULL REFERENCES companies (id),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  CONSTRAINT notification_events_type_check CHECK (
    event_type IN (
      'dispute_opened',
      'dispute_responded',
      'dispute_settled',
      'dispute_resolved',
      'counterparty_restricted',
      'counterparty_restriction_lifted'
    )
  )
);

CREATE INDEX IF NOT EXISTS notification_events_recipient_idx
  ON notification_events (recipient_company_id, created_at);
