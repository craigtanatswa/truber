-- Internal dedupe of a recorded receipt across admins.
-- The contract field for this is a v0.6.0 item.

ALTER TABLE commission_collections
  ADD COLUMN IF NOT EXISTS receipt_ref_normalised text;

ALTER TABLE commission_collections
  DROP CONSTRAINT IF EXISTS commission_collections_receipt_ref_normalised_check,
  ADD CONSTRAINT commission_collections_receipt_ref_normalised_check CHECK (
    receipt_ref_normalised IS NULL
    OR char_length(receipt_ref_normalised) BETWEEN 1 AND 200
  );

CREATE UNIQUE INDEX IF NOT EXISTS commission_collections_receipt_uidx
  ON commission_collections (company_id, currency, receipt_ref_normalised)
  WHERE receipt_ref_normalised IS NOT NULL;

COMMENT ON COLUMN commission_collections.receipt_ref_normalised IS
  'Internal dedupe of a recorded receipt across admins; contract field for this is a v0.6.0 item.';
