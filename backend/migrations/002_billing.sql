-- Billing records for the v0.4.0 contract. Records only: no provider calls and
-- no funds movement. Bookings are owned by another service; the booking_id
-- columns have no foreign key yet, and the FK is added when the bookings table
-- lands.

CREATE TABLE IF NOT EXISTS payment_arrangements (
  id uuid PRIMARY KEY,
  -- No FK yet: added when the bookings table lands.
  booking_id uuid NOT NULL,
  method text NOT NULL,
  arrangement_status text NOT NULL,
  protection_status text NOT NULL,
  release_status text NOT NULL,
  currency text NOT NULL,
  total_minor bigint NOT NULL,
  deposit_minor bigint,
  balance_minor bigint,
  corporate_credit_terms_days integer,
  provider_hint text,
  notes text,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT payment_arrangements_method_check CHECK (
    method IN ('prepay', 'escrow', 'deposit_balance', 'cash', 'corporate_credit')
  ),
  CONSTRAINT payment_arrangements_status_check CHECK (
    arrangement_status IN ('proposed', 'confirmed', 'rejected', 'cancelled')
  ),
  CONSTRAINT payment_arrangements_protection_status_check CHECK (
    protection_status IN (
      'none',
      'pending_evidence',
      'protected',
      'protection_failed',
      'released_from_protection'
    )
  ),
  CONSTRAINT payment_arrangements_release_status_check CHECK (
    release_status IN (
      'not_applicable',
      'held',
      'release_requested',
      'released_recorded',
      'release_failed'
    )
  ),
  CONSTRAINT payment_arrangements_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_arrangements_total_check CHECK (total_minor > 0),
  CONSTRAINT payment_arrangements_cash_protection_check CHECK (
    method <> 'cash' OR protection_status = 'none'
  ),
  CONSTRAINT payment_arrangements_deposit_balance_check CHECK (
    (
      method = 'deposit_balance'
      AND deposit_minor > 0
      AND balance_minor > 0
      AND deposit_minor + balance_minor = total_minor
    )
    OR (
      method <> 'deposit_balance'
      AND deposit_minor IS NULL
      AND balance_minor IS NULL
    )
  ),
  CONSTRAINT payment_arrangements_corporate_credit_terms_check CHECK (
    (method = 'corporate_credit' AND corporate_credit_terms_days IS NOT NULL)
    OR (method <> 'corporate_credit' AND corporate_credit_terms_days IS NULL)
  ),
  CONSTRAINT payment_arrangements_terms_days_check CHECK (
    corporate_credit_terms_days IS NULL
    OR corporate_credit_terms_days IN (7, 14, 30)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_arrangements_confirmed_booking_uidx
  ON payment_arrangements (booking_id)
  WHERE arrangement_status = 'confirmed';

CREATE TABLE IF NOT EXISTS payment_records (
  id uuid PRIMARY KEY,
  arrangement_id uuid NOT NULL REFERENCES payment_arrangements (id),
  kind text NOT NULL,
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  external_reference text,
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT payment_records_kind_check CHECK (
    kind IN ('shipper_payment', 'deposit_receipt', 'balance_receipt', 'processing_fee')
  ),
  CONSTRAINT payment_records_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_records_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT payment_records_positive_amount_check CHECK (
    kind = 'processing_fee' OR amount_minor > 0
  )
);

CREATE INDEX IF NOT EXISTS payment_records_arrangement_idx
  ON payment_records (arrangement_id);

CREATE TABLE IF NOT EXISTS commission_receivables (
  id uuid PRIMARY KEY,
  -- No FK yet: added when the bookings table lands.
  booking_id uuid NOT NULL,
  transporter_company_id uuid NOT NULL REFERENCES companies (id),
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  collected_minor bigint NOT NULL DEFAULT 0,
  remaining_minor bigint NOT NULL,
  status text NOT NULL,
  payment_method text,
  recognised_at timestamptz NOT NULL,
  settled_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT commission_receivables_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT commission_receivables_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT commission_receivables_collected_check CHECK (collected_minor >= 0),
  CONSTRAINT commission_receivables_remaining_check CHECK (remaining_minor >= 0),
  CONSTRAINT commission_receivables_collected_amount_check CHECK (
    collected_minor <= amount_minor
  ),
  CONSTRAINT commission_receivables_status_check CHECK (
    status IN ('open', 'settled_on_release', 'collected', 'voided')
  ),
  CONSTRAINT commission_receivables_payment_method_check CHECK (
    payment_method IS NULL
    OR payment_method IN ('prepay', 'escrow', 'deposit_balance', 'cash', 'corporate_credit')
  ),
  CONSTRAINT commission_receivables_open_balance_check CHECK (
    status <> 'open' OR remaining_minor + collected_minor = amount_minor
  ),
  CONSTRAINT commission_receivables_collected_state_check CHECK (
    status <> 'collected'
    OR (remaining_minor = 0 AND collected_minor = amount_minor)
  ),
  CONSTRAINT commission_receivables_settled_voided_check CHECK (
    status NOT IN ('settled_on_release', 'voided') OR remaining_minor = 0
  ),
  CONSTRAINT commission_receivables_voided_at_check CHECK (
    (status = 'voided') = (voided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS commission_receivables_booking_uidx
  ON commission_receivables (booking_id)
  WHERE status <> 'voided';

CREATE INDEX IF NOT EXISTS commission_receivables_company_idx
  ON commission_receivables (transporter_company_id, currency, status, recognised_at, id);

CREATE OR REPLACE FUNCTION billing_receivable_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.transporter_company_id IS DISTINCT FROM OLD.transporter_company_id THEN
    RAISE EXCEPTION 'commission receivable financial terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commission_receivables_immutable ON commission_receivables;
CREATE TRIGGER commission_receivables_immutable
  BEFORE UPDATE ON commission_receivables
  FOR EACH ROW EXECUTE FUNCTION billing_receivable_immutable();

CREATE TABLE IF NOT EXISTS commission_collections (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  external_reference text,
  notes text,
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT commission_collections_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT commission_collections_amount_check CHECK (amount_minor > 0),
  CONSTRAINT commission_collections_external_reference_len CHECK (
    external_reference IS NULL OR char_length(external_reference) <= 200
  ),
  CONSTRAINT commission_collections_notes_len CHECK (
    notes IS NULL OR char_length(notes) <= 2000
  )
);

CREATE INDEX IF NOT EXISTS commission_collections_company_idx
  ON commission_collections (company_id, recorded_at);

CREATE TABLE IF NOT EXISTS commission_collection_allocations (
  collection_id uuid NOT NULL REFERENCES commission_collections (id),
  receivable_id uuid NOT NULL REFERENCES commission_receivables (id),
  amount_minor bigint NOT NULL,
  PRIMARY KEY (collection_id, receivable_id),
  CONSTRAINT commission_collection_allocations_amount_check CHECK (amount_minor > 0)
);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY,
  arrangement_id uuid NOT NULL REFERENCES payment_arrangements (id),
  -- No FK yet: added when the bookings table lands.
  booking_id uuid NOT NULL,
  currency text NOT NULL,
  trip_minor bigint NOT NULL,
  commission_minor bigint NOT NULL,
  fees_minor bigint NOT NULL,
  net_minor bigint NOT NULL,
  status text NOT NULL,
  blocked_reason text,
  funds_movement_claimed_by_truber boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT payouts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payouts_trip_check CHECK (trip_minor > 0),
  CONSTRAINT payouts_commission_check CHECK (commission_minor >= 0),
  CONSTRAINT payouts_fees_check CHECK (fees_minor >= 0),
  CONSTRAINT payouts_net_check CHECK (net_minor >= 0),
  CONSTRAINT payouts_net_equation_check CHECK (
    net_minor = trip_minor - commission_minor - fees_minor
  ),
  CONSTRAINT payouts_status_check CHECK (
    status IN ('blocked', 'payable', 'recorded')
  ),
  CONSTRAINT payouts_funds_movement_check CHECK (funds_movement_claimed_by_truber = false)
);
