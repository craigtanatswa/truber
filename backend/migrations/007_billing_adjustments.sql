-- Commission dispute holds, adjustments, and credit netting (Section 0).
-- Records only. A credit is never paid out in cash; it only nets commission.

ALTER TABLE commission_receivables
  ADD COLUMN IF NOT EXISTS trip_minor bigint,
  ADD COLUMN IF NOT EXISTS reduced_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_applied_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_window_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_ref text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS transporter_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_hold_status text;

UPDATE commission_receivables
   SET dispute_window_ends_at = recognised_at + interval '24 hours'
 WHERE dispute_window_ends_at IS NULL;

ALTER TABLE commission_receivables
  ALTER COLUMN dispute_window_ends_at SET NOT NULL;

ALTER TABLE commission_collections
  ADD COLUMN IF NOT EXISTS credited_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE commission_collections
  DROP CONSTRAINT IF EXISTS commission_collections_credited_check,
  ADD CONSTRAINT commission_collections_credited_check CHECK (
    credited_minor >= 0 AND credited_minor <= amount_minor
  );

ALTER TABLE commission_receivables
  DROP CONSTRAINT IF EXISTS commission_receivables_status_check,
  DROP CONSTRAINT IF EXISTS commission_receivables_open_balance_check,
  DROP CONSTRAINT IF EXISTS commission_receivables_collected_state_check,
  DROP CONSTRAINT IF EXISTS commission_receivables_settled_voided_check;

ALTER TABLE commission_receivables
  ADD CONSTRAINT commission_receivables_trip_minor_check CHECK (
    trip_minor IS NULL OR trip_minor > 0
  ),
  ADD CONSTRAINT commission_receivables_reduced_minor_check CHECK (reduced_minor >= 0),
  ADD CONSTRAINT commission_receivables_credit_applied_minor_check CHECK (
    credit_applied_minor >= 0
  ),
  ADD CONSTRAINT commission_receivables_dispute_window_check CHECK (
    dispute_window_ends_at = recognised_at + interval '24 hours'
  ),
  ADD CONSTRAINT commission_receivables_dispute_ref_uuid CHECK (
    dispute_ref IS NULL OR dispute_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT commission_receivables_pre_hold_status_check CHECK (
    pre_hold_status IS NULL
    OR pre_hold_status IN ('open', 'collected', 'settled_on_release')
  ),
  ADD CONSTRAINT commission_receivables_status_check CHECK (
    status IN ('open', 'settled_on_release', 'collected', 'voided', 'held', 'cancelled')
  ),
  ADD CONSTRAINT commission_receivables_open_balance_check CHECK (
    status NOT IN ('open', 'held')
    OR pre_hold_status IS NOT DISTINCT FROM 'settled_on_release'
    OR remaining_minor + collected_minor + credit_applied_minor + reduced_minor = amount_minor
  ),
  ADD CONSTRAINT commission_receivables_collected_state_check CHECK (
    status <> 'collected'
    OR (
      remaining_minor = 0
      AND collected_minor + credit_applied_minor + reduced_minor = amount_minor
    )
  ),
  ADD CONSTRAINT commission_receivables_settled_voided_check CHECK (
    status NOT IN ('settled_on_release', 'voided', 'cancelled') OR remaining_minor = 0
  ),
  ADD CONSTRAINT commission_receivables_cancelled_check CHECK (
    status <> 'cancelled'
    OR (collected_minor = 0 AND credit_applied_minor = 0 AND final_at IS NOT NULL)
  ),
  ADD CONSTRAINT commission_receivables_held_check CHECK (
    status <> 'held'
    OR (
      dispute_ref IS NOT NULL
      AND disputed_at IS NOT NULL
      AND response_deadline_at IS NOT NULL
      AND final_at IS NULL
      AND pre_hold_status IS NOT NULL
    )
  ),
  ADD CONSTRAINT commission_receivables_paid_le_amount CHECK (
    collected_minor + credit_applied_minor + reduced_minor <= amount_minor
  ),
  ADD CONSTRAINT commission_receivables_deadline_check CHECK (
    response_deadline_at IS NULL
    OR response_deadline_at = disputed_at + interval '48 hours'
  ),
  ADD CONSTRAINT commission_receivables_disputed_before_window_check CHECK (
    disputed_at IS NULL OR disputed_at < dispute_window_ends_at
  );

CREATE OR REPLACE FUNCTION billing_receivable_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.transporter_company_id IS DISTINCT FROM OLD.transporter_company_id
     OR NEW.commission_rate_bps IS DISTINCT FROM OLD.commission_rate_bps
     OR (OLD.trip_minor IS NOT NULL AND NEW.trip_minor IS DISTINCT FROM OLD.trip_minor)
     OR NEW.dispute_window_ends_at IS DISTINCT FROM OLD.dispute_window_ends_at
     OR NEW.recognised_at IS DISTINCT FROM OLD.recognised_at THEN
    RAISE EXCEPTION 'commission receivable financial terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION billing_receivable_immutable() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS commission_adjustments (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  receivable_id uuid NOT NULL REFERENCES commission_receivables (id),
  transporter_company_id uuid NOT NULL REFERENCES companies (id),
  dispute_ref text,
  source text NOT NULL,
  shipper_agreed_by uuid REFERENCES users (id),
  transporter_agreed_by uuid REFERENCES users (id),
  decided_at timestamptz NOT NULL,
  currency text NOT NULL,
  previous_trip_minor bigint NOT NULL,
  new_trip_minor bigint NOT NULL,
  previous_commission_minor bigint NOT NULL,
  new_commission_minor bigint NOT NULL,
  reduced_open_minor bigint NOT NULL,
  credited_minor bigint NOT NULL,
  reason text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  CONSTRAINT commission_adjustments_dispute_ref_uuid CHECK (
    dispute_ref IS NULL OR dispute_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT commission_adjustments_dispute_ref_source_check CHECK (
    dispute_ref IS NOT NULL OR source = 'admin_decision'
  ),
  CONSTRAINT commission_adjustments_source_check CHECK (
    source IN ('party_settlement', 'admin_decision')
  ),
  CONSTRAINT commission_adjustments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT commission_adjustments_previous_trip_check CHECK (previous_trip_minor >= 0),
  CONSTRAINT commission_adjustments_new_trip_check CHECK (new_trip_minor >= 0),
  CONSTRAINT commission_adjustments_previous_commission_check CHECK (
    previous_commission_minor >= 0
  ),
  CONSTRAINT commission_adjustments_new_commission_check CHECK (new_commission_minor >= 0),
  CONSTRAINT commission_adjustments_reduced_open_check CHECK (reduced_open_minor >= 0),
  CONSTRAINT commission_adjustments_credited_check CHECK (credited_minor >= 0),
  CONSTRAINT commission_adjustments_reason_len CHECK (char_length(reason) BETWEEN 1 AND 2000),
  CONSTRAINT commission_adjustments_decrease_check CHECK (
    new_trip_minor < previous_trip_minor
  ),
  CONSTRAINT commission_adjustments_commission_decrease_check CHECK (
    new_commission_minor <= previous_commission_minor
  ),
  CONSTRAINT commission_adjustments_split_check CHECK (
    reduced_open_minor + credited_minor = previous_commission_minor - new_commission_minor
  ),
  CONSTRAINT commission_adjustments_party_agreement_check CHECK (
    source <> 'party_settlement'
    OR (shipper_agreed_by IS NOT NULL AND transporter_agreed_by IS NOT NULL)
  ),
  CONSTRAINT commission_adjustments_receivable_key_unique UNIQUE (receivable_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS commission_adjustments_company_idx
  ON commission_adjustments (transporter_company_id, recorded_at);

CREATE INDEX IF NOT EXISTS commission_adjustments_receivable_idx
  ON commission_adjustments (receivable_id, recorded_at);

CREATE TABLE IF NOT EXISTS commission_dispute_outcomes (
  id uuid PRIMARY KEY,
  receivable_id uuid NOT NULL REFERENCES commission_receivables (id),
  booking_id uuid NOT NULL,
  transporter_company_id uuid NOT NULL REFERENCES companies (id),
  dispute_ref text,
  kind text NOT NULL,
  source text NOT NULL,
  adjustment_id uuid UNIQUE REFERENCES commission_adjustments (id),
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users (id),
  decided_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT commission_dispute_outcomes_dispute_ref_uuid CHECK (
    dispute_ref IS NULL OR dispute_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT commission_dispute_outcomes_dispute_ref_source_check CHECK (
    dispute_ref IS NOT NULL OR source = 'admin_decision'
  ),
  CONSTRAINT commission_dispute_outcomes_kind_check CHECK (
    kind IN ('unchanged', 'adjusted')
  ),
  CONSTRAINT commission_dispute_outcomes_source_check CHECK (
    source IN ('party_settlement', 'admin_decision')
  ),
  CONSTRAINT commission_dispute_outcomes_reason_len CHECK (
    char_length(reason) BETWEEN 1 AND 2000
  ),
  CONSTRAINT commission_dispute_outcomes_adjustment_check CHECK (
    (kind = 'adjusted') = (adjustment_id IS NOT NULL)
  ),
  CONSTRAINT commission_dispute_outcomes_receivable_key_unique UNIQUE (
    receivable_id, idempotency_key
  )
);

CREATE INDEX IF NOT EXISTS commission_dispute_outcomes_company_idx
  ON commission_dispute_outcomes (transporter_company_id, recorded_at);

CREATE INDEX IF NOT EXISTS commission_dispute_outcomes_receivable_idx
  ON commission_dispute_outcomes (receivable_id, recorded_at);

CREATE TABLE IF NOT EXISTS commission_credits (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  remaining_minor bigint NOT NULL,
  source_kind text NOT NULL,
  source_adjustment_id uuid UNIQUE REFERENCES commission_adjustments (id),
  source_receivable_id uuid REFERENCES commission_receivables (id),
  source_collection_id uuid REFERENCES commission_collections (id),
  created_at timestamptz NOT NULL,
  CONSTRAINT commission_credits_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT commission_credits_amount_check CHECK (amount_minor > 0),
  CONSTRAINT commission_credits_remaining_check CHECK (
    remaining_minor >= 0 AND remaining_minor <= amount_minor
  ),
  CONSTRAINT commission_credits_source_kind_check CHECK (
    source_kind IN ('adjustment', 'void', 'collection')
  ),
  CONSTRAINT commission_credits_source_adjustment_check CHECK (
    (source_kind = 'adjustment') = (source_adjustment_id IS NOT NULL)
  ),
  CONSTRAINT commission_credits_source_receivable_check CHECK (
    (source_kind = 'void') = (source_receivable_id IS NOT NULL)
  ),
  CONSTRAINT commission_credits_source_collection_check CHECK (
    (source_kind = 'collection') = (source_collection_id IS NOT NULL)
  )
);

COMMENT ON TABLE commission_credits IS
  'Commission credit is never paid out in cash; it only nets commission.';

CREATE UNIQUE INDEX IF NOT EXISTS commission_credits_void_receivable_uidx
  ON commission_credits (source_receivable_id)
  WHERE source_kind = 'void';

CREATE UNIQUE INDEX IF NOT EXISTS commission_credits_collection_uidx
  ON commission_credits (source_collection_id)
  WHERE source_kind = 'collection';

CREATE INDEX IF NOT EXISTS commission_credits_company_idx
  ON commission_credits (company_id, currency, created_at, id);

CREATE TABLE IF NOT EXISTS commission_credit_allocations (
  credit_id uuid NOT NULL REFERENCES commission_credits (id),
  receivable_id uuid NOT NULL REFERENCES commission_receivables (id),
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (credit_id, receivable_id),
  CONSTRAINT commission_credit_allocations_amount_check CHECK (amount_minor > 0)
);

CREATE OR REPLACE FUNCTION billing_credit_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_adjustment_id IS DISTINCT FROM OLD.source_adjustment_id
     OR NEW.source_receivable_id IS DISTINCT FROM OLD.source_receivable_id
     OR NEW.source_collection_id IS DISTINCT FROM OLD.source_collection_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'commission credit terms are immutable';
  END IF;
  IF NEW.remaining_minor > OLD.remaining_minor THEN
    RAISE EXCEPTION 'commission credit remaining may only decrease';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION billing_credit_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS commission_credits_guard ON commission_credits;
CREATE TRIGGER commission_credits_guard
  BEFORE UPDATE OR DELETE ON commission_credits
  FOR EACH ROW EXECUTE FUNCTION billing_credit_guard();

CREATE OR REPLACE FUNCTION billing_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

REVOKE ALL ON FUNCTION billing_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS commission_adjustments_append_only ON commission_adjustments;
CREATE TRIGGER commission_adjustments_append_only
  BEFORE UPDATE OR DELETE ON commission_adjustments
  FOR EACH ROW EXECUTE FUNCTION billing_append_only();

DROP TRIGGER IF EXISTS commission_dispute_outcomes_append_only ON commission_dispute_outcomes;
CREATE TRIGGER commission_dispute_outcomes_append_only
  BEFORE UPDATE OR DELETE ON commission_dispute_outcomes
  FOR EACH ROW EXECUTE FUNCTION billing_append_only();

DROP TRIGGER IF EXISTS commission_credit_allocations_append_only ON commission_credit_allocations;
CREATE TRIGGER commission_credit_allocations_append_only
  BEFORE UPDATE OR DELETE ON commission_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION billing_append_only();
