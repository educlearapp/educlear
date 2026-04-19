-- Add optional branding fields used by payslips/UI.
-- Safe migration: adds nullable columns only (no data reset).

ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT;

