-- Off-platform circumvention reports, findings, and 14-day bans (API v0.4.0).
-- booking_id has no foreign key yet: there is no bookings table in this codebase.
-- Add the bookings foreign key when bookings land.

CREATE TABLE IF NOT EXISTS off_platform_reports (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  reported_by_user_id uuid NOT NULL REFERENCES users (id),
  reporter_role text NOT NULL,
  suspected_party text NOT NULL,
  description text NOT NULL,
  evidence_uris jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL,
  CONSTRAINT off_platform_reports_reporter_role_check CHECK (
    reporter_role IN ('shipper', 'transporter', 'admin')
  ),
  CONSTRAINT off_platform_reports_suspected_party_check CHECK (
    suspected_party IN ('shipper', 'transporter', 'both', 'unknown')
  ),
  CONSTRAINT off_platform_reports_description_len CHECK (
    char_length(description) BETWEEN 10 AND 4000
  ),
  CONSTRAINT off_platform_reports_status_check CHECK (
    status IN ('open', 'confirmed', 'not_confirmed')
  )
);

CREATE INDEX IF NOT EXISTS off_platform_reports_booking_idx ON off_platform_reports (booking_id);
CREATE INDEX IF NOT EXISTS off_platform_reports_status_idx ON off_platform_reports (status);

CREATE TABLE IF NOT EXISTS off_platform_findings (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL UNIQUE REFERENCES off_platform_reports (id),
  booking_id uuid NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL,
  responsible_parties jsonb NOT NULL DEFAULT '[]',
  reviewed_by_user_id uuid NOT NULL REFERENCES users (id),
  reviewed_at timestamptz NOT NULL,
  CONSTRAINT off_platform_findings_outcome_check CHECK (
    outcome IN ('confirmed', 'not_confirmed')
  ),
  CONSTRAINT off_platform_findings_reason_len CHECK (
    char_length(reason) BETWEEN 8 AND 4000
  )
);

CREATE TABLE IF NOT EXISTS off_platform_bans (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES off_platform_findings (id),
  user_id uuid NOT NULL REFERENCES users (id),
  company_id uuid NOT NULL REFERENCES companies (id),
  party_role text NOT NULL,
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_days integer NOT NULL DEFAULT 14,
  applied_by_user_id uuid NOT NULL REFERENCES users (id),
  lifted_at timestamptz,
  lifted_by_user_id uuid REFERENCES users (id),
  lift_reason text,
  created_at timestamptz NOT NULL,
  CONSTRAINT off_platform_bans_party_role_check CHECK (
    party_role IN ('shipper', 'transporter')
  ),
  CONSTRAINT off_platform_bans_duration_check CHECK (duration_days = 14),
  CONSTRAINT off_platform_bans_ends_at_check CHECK (
    ends_at = starts_at + interval '14 days'
  ),
  CONSTRAINT off_platform_bans_lift_pair_check CHECK (
    (lifted_at IS NULL AND lifted_by_user_id IS NULL AND lift_reason IS NULL)
    OR (lifted_at IS NOT NULL AND lifted_by_user_id IS NOT NULL AND lift_reason IS NOT NULL)
  ),
  CONSTRAINT off_platform_bans_lift_reason_len CHECK (
    lift_reason IS NULL OR char_length(lift_reason) BETWEEN 8 AND 4000
  ),
  CONSTRAINT off_platform_bans_finding_party_unique UNIQUE (finding_id, party_role)
);

CREATE INDEX IF NOT EXISTS off_platform_bans_user_idx ON off_platform_bans (user_id);
CREATE INDEX IF NOT EXISTS off_platform_bans_company_idx ON off_platform_bans (company_id);
