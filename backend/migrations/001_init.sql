-- Auth + companies + loads schema for API v0.2.0 slice.
-- PostGIS is required. Booking, payment, quotation, and truck tables are
-- intentionally absent: those operations are not implemented in this slice.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  phone text,
  city text,
  role text NOT NULL,
  account_status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT users_email_lower CHECK (email = lower(email)),
  CONSTRAINT users_role_check CHECK (role IN ('shipper', 'transporter', 'admin')),
  CONSTRAINT users_account_status_check CHECK (
    account_status IN ('pending_verification', 'active', 'suspended', 'disabled')
  ),
  CONSTRAINT users_city_len CHECK (city IS NULL OR (char_length(city) BETWEEN 1 AND 120))
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  legal_name text NOT NULL,
  trading_name text,
  registration_number text,
  tax_number text,
  country_code text NOT NULL DEFAULT 'ZW',
  city text,
  verification_status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT companies_type_check CHECK (type IN ('shipper', 'transporter')),
  CONSTRAINT companies_verification_check CHECK (
    verification_status IN ('unverified', 'pending', 'verified', 'rejected')
  ),
  CONSTRAINT companies_city_len CHECK (city IS NULL OR (char_length(city) BETWEEN 1 AND 120))
);

CREATE TABLE IF NOT EXISTS company_members (
  company_id uuid NOT NULL REFERENCES companies (id),
  user_id uuid NOT NULL REFERENCES users (id),
  member_role text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, user_id),
  CONSTRAINT company_members_role_check CHECK (member_role IN ('owner'))
);

CREATE INDEX IF NOT EXISTS company_members_user_idx ON company_members (user_id);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS refresh_sessions_user_idx ON refresh_sessions (user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  channel text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT otp_channel_check CHECK (channel IN ('sms', 'email'))
);

CREATE INDEX IF NOT EXISTS otp_challenges_user_idx ON otp_challenges (user_id);

CREATE TABLE IF NOT EXISTS loads (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  created_by uuid NOT NULL REFERENCES users (id),
  status text NOT NULL,
  goods_type text NOT NULL,
  weight_kg integer NOT NULL,
  truck_type_required text NOT NULL,
  pickup_address text NOT NULL,
  pickup_geog geography(Point, 4326),
  destination_address text NOT NULL,
  destination_geog geography(Point, 4326),
  loading_date date NOT NULL,
  delivery_deadline date,
  special_requirements text,
  rate_type text NOT NULL,
  offered_amount_minor integer,
  offered_currency text,
  currency text NOT NULL,
  cancel_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT loads_status_check CHECK (
    status IN (
      'draft',
      'posted',
      'quoting',
      'booking_pending',
      'booked',
      'in_progress',
      'awaiting_shipper_acceptance',
      'completed',
      'cancelled'
    )
  ),
  CONSTRAINT loads_weight_check CHECK (weight_kg >= 1),
  CONSTRAINT loads_rate_type_check CHECK (rate_type IN ('fixed', 'negotiable')),
  CONSTRAINT loads_truck_type_check CHECK (
    truck_type_required IN (
      'flatbed', 'box', 'refrigerated', 'tanker', 'tipper', 'side_loader', 'other'
    )
  ),
  CONSTRAINT loads_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT loads_offered_pair_check CHECK (
    (offered_amount_minor IS NULL AND offered_currency IS NULL)
    OR (offered_amount_minor IS NOT NULL AND offered_currency IS NOT NULL)
  ),
  CONSTRAINT loads_deadline_check CHECK (
    delivery_deadline IS NULL OR delivery_deadline >= loading_date
  )
);

CREATE INDEX IF NOT EXISTS loads_company_idx ON loads (company_id);
CREATE INDEX IF NOT EXISTS loads_status_idx ON loads (status);
CREATE INDEX IF NOT EXISTS loads_loading_date_idx ON loads (loading_date);
CREATE INDEX IF NOT EXISTS loads_pickup_gix ON loads USING GIST (pickup_geog);
CREATE INDEX IF NOT EXISTS loads_destination_gix ON loads USING GIST (destination_geog);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT idempotency_unique UNIQUE (user_id, idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL
);

-- Plaintext delivery payloads. Written only by the dev/test delivery adapter.
-- No HTTP route reads this table. Production boot refuses DELIVERY_ADAPTER=dev.
CREATE TABLE IF NOT EXISTS delivery_outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  recipient text NOT NULL,
  user_id uuid,
  payload text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT delivery_outbox_kind_check CHECK (kind IN ('password_reset', 'otp'))
);

CREATE INDEX IF NOT EXISTS delivery_outbox_user_idx ON delivery_outbox (user_id, created_at DESC);
