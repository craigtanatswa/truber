-- Tighten the truck registration check from migration 004 to the normalised API format:
-- 1-64 ASCII upper-case letters or digits, compared with the C collation.
-- 004 stays immutable because it may already be applied on other databases.
-- This migration fails loudly if legacy rows do not already match the format; it never
-- rewrites registration numbers.

ALTER TABLE trucks DROP CONSTRAINT IF EXISTS trucks_registration_number_check;
ALTER TABLE trucks ADD CONSTRAINT trucks_registration_number_format CHECK (
  (registration_number COLLATE "C") ~ '^[A-Z0-9]{1,64}$'
);
