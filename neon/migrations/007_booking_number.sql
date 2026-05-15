-- Migration 007: Self-booking public fields
-- Adds booking_number (human-readable reference) and public_token (UUID link backup)
-- to the existing bookings table.
-- Run once in the Neon SQL Editor.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_number TEXT,
  ADD COLUMN IF NOT EXISTS public_token   UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ NULL;

-- booking_number is unique per salon (not globally unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_number
  ON bookings (salon_id, booking_number)
  WHERE booking_number IS NOT NULL;

-- Fast lookup by public_token (for SMS links)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_public_token
  ON bookings (public_token)
  WHERE public_token IS NOT NULL;

-- booking_settings: add the 48-hour self-booking minimum (2880 minutes = 2 days)
UPDATE booking_settings
  SET min_advance_minutes = 2880
  WHERE min_advance_minutes < 2880;

-- Make sure booking_settings.min_advance_minutes default also reflects this
ALTER TABLE booking_settings
  ALTER COLUMN min_advance_minutes SET DEFAULT 2880;
