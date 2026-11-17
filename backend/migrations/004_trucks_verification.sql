-- Trucks, verification documents and an internal account-status audit (launch item 5).

CREATE TABLE IF NOT EXISTS trucks (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  created_by uuid NOT NULL REFERENCES users (id),
  registration_number text NOT NULL,
  truck_type text NOT NULL,
  capacity_kg integer NOT NULL,
  trailer_specs text,
  insurance_reference text,
  current_location_text text,
  verification_status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT trucks_truck_type_check CHECK (
    truck_type IN ('flatbed', 'box', 'refrigerated', 'tanker', 'tipper', 'side_loader', 'other')
  ),
  CONSTRAINT trucks_capacity_check CHECK (capacity_kg >= 1),
  CONSTRAINT trucks_verification_check CHECK (
    verification_status IN ('unverified', 'pending', 'verified', 'rejected')
  ),
  CONSTRAINT trucks_registration_number_check CHECK (
    char_length(registration_number) BETWEEN 1 AND 64
    AND registration_number !~ '[[:space:]-]'
    AND registration_number = upper(registration_number)
  ),
  CONSTRAINT trucks_trailer_specs_len CHECK (
    trailer_specs IS NULL OR char_length(trailer_specs) <= 500
  ),
  CONSTRAINT trucks_insurance_reference_len CHECK (
    insurance_reference IS NULL OR char_length(insurance_reference) <= 200
  ),
  CONSTRAINT trucks_current_location_text_len CHECK (
    current_location_text IS NULL OR char_length(current_location_text) <= 200
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trucks_registration_number_uidx ON trucks (registration_number);
CREATE INDEX IF NOT EXISTS trucks_company_idx ON trucks (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trucks_verification_type_idx ON trucks (verification_status, truck_type);

CREATE TABLE IF NOT EXISTS verification_documents (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users (id),
  company_id uuid REFERENCES companies (id),
  truck_id uuid REFERENCES trucks (id),
  document_type text NOT NULL,
  document_uri text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  review_notes text,
  reviewed_by_user_id uuid REFERENCES users (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT vdocs_document_type_check CHECK (
    document_type IN (
      'national_id', 'company_registration', 'tax_clearance',
      'vehicle_registration', 'insurance', 'other'
    )
  ),
  CONSTRAINT vdocs_status_check CHECK (status IN ('submitted', 'approved', 'rejected')),
  CONSTRAINT vdocs_document_uri_check CHECK (
    document_uri ~ '^https://' AND char_length(document_uri) <= 2048
  ),
  CONSTRAINT vdocs_review_notes_len CHECK (
    review_notes IS NULL OR char_length(review_notes) <= 2000
  ),
  CONSTRAINT vdocs_truck_company_check CHECK (truck_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT vdocs_review_pair_check CHECK (
    (status = 'submitted' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (
      status IN ('approved', 'rejected')
      AND reviewed_at IS NOT NULL
      AND reviewed_by_user_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS vdocs_owner_idx ON verification_documents (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vdocs_company_idx ON verification_documents (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vdocs_truck_idx ON verification_documents (truck_id);
CREATE INDEX IF NOT EXISTS vdocs_status_idx ON verification_documents (status, created_at);

CREATE TABLE IF NOT EXISTS account_status_changes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_by_user_id uuid NOT NULL REFERENCES users (id),
  changed_at timestamptz NOT NULL,
  CONSTRAINT account_status_changes_status_check CHECK (
    from_status IN ('pending_verification', 'active', 'suspended', 'disabled')
    AND to_status IN ('pending_verification', 'active', 'suspended', 'disabled')
    AND from_status <> to_status
  )
);

CREATE INDEX IF NOT EXISTS account_status_changes_user_idx ON account_status_changes (user_id, changed_at DESC);
