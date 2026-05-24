-- Add optional dueDate to billing plan items and invoice lines.
-- Safe: nullable columns, no existing data changes.
-- Production-safe: legacy tables may never have existed on live DBs (skip when absent).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'LearnerBillingPlanItem'
  ) THEN
    ALTER TABLE "LearnerBillingPlanItem"
      ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'InvoiceLine'
  ) THEN
    ALTER TABLE "InvoiceLine"
      ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
  END IF;
END $$;
