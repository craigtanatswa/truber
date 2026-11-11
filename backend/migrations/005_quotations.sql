-- Quotations (API v0.4.0) and the minimal bookings row created by acceptQuotation.
-- The bookings slice will extend this table; it must not create it again.
-- off_platform_reports.booking_id and off_platform_findings.booking_id deliberately
-- stay unconstrained: production already holds rows that reference fixture ids, so
-- migration 003 is not altered and no foreign key is added to bookings here.

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY,
  load_id uuid NOT NULL REFERENCES loads (id),
  transporter_company_id uuid NOT NULL REFERENCES companies (id),
  submitted_by_user_id uuid NOT NULL REFERENCES users (id),
  truck_id uuid,
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  notes text,
  status text NOT NULL,
  valid_until timestamptz NOT NULL,
  withdrawn_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT quotations_amount_check CHECK (amount_minor >= 1),
  CONSTRAINT quotations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT quotations_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT quotations_status_check CHECK (
    status IN ('submitted', 'withdrawn', 'accepted', 'not_selected', 'rejected', 'expired')
  )
);

-- truck_id intentionally has no foreign key: there is no trucks table in this slice.

CREATE UNIQUE INDEX IF NOT EXISTS quotations_open_per_company_idx
  ON quotations (load_id, transporter_company_id)
  WHERE status = 'submitted';
CREATE UNIQUE INDEX IF NOT EXISTS quotations_one_accepted_per_load_idx
  ON quotations (load_id)
  WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS quotations_load_idx ON quotations (load_id);
CREATE INDEX IF NOT EXISTS quotations_transporter_company_idx ON quotations (transporter_company_id);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  load_id uuid NOT NULL REFERENCES loads (id),
  quotation_id uuid NOT NULL UNIQUE REFERENCES quotations (id),
  shipper_company_id uuid NOT NULL REFERENCES companies (id),
  transporter_company_id uuid NOT NULL REFERENCES companies (id),
  truck_id uuid,
  status text NOT NULL DEFAULT 'pending_payment_arrangement',
  trip_status text NOT NULL DEFAULT 'not_started',
  completion_status text NOT NULL DEFAULT 'not_complete',
  agreed_amount_minor integer NOT NULL,
  currency text NOT NULL,
  commission_rate_bps integer NOT NULL DEFAULT 500,
  confirmed_payment_arrangement_id uuid,
  confirmed_at timestamptz,
  accept_notes text,
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT bookings_status_check CHECK (
    status IN ('pending_payment_arrangement', 'confirmed', 'cancelled')
  ),
  CONSTRAINT bookings_trip_status_check CHECK (
    trip_status IN ('not_started', 'truck_dispatched', 'goods_collected', 'in_transit', 'delivered')
  ),
  CONSTRAINT bookings_completion_status_check CHECK (
    completion_status IN ('not_complete', 'awaiting_shipper_acceptance', 'completed', 'disputed', 'cancelled')
  ),
  CONSTRAINT bookings_agreed_amount_check CHECK (agreed_amount_minor >= 1),
  CONSTRAINT bookings_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT bookings_commission_rate_check CHECK (commission_rate_bps = 500),
  CONSTRAINT bookings_accept_notes_len CHECK (accept_notes IS NULL OR char_length(accept_notes) <= 1000),
  -- Hard rule: no confirmed payment arrangement, no confirmed booking.
  CONSTRAINT bookings_confirmed_pair_check CHECK (
    (status = 'confirmed'
      AND confirmed_payment_arrangement_id IS NOT NULL
      AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed'
      AND confirmed_payment_arrangement_id IS NULL
      AND confirmed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_load_idx
  ON bookings (load_id)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS bookings_load_idx ON bookings (load_id);
CREATE INDEX IF NOT EXISTS bookings_transporter_company_idx ON bookings (transporter_company_id);
