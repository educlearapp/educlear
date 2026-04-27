-- Add optional dueDate to billing plan items and invoice lines.
-- Safe: nullable columns, no existing data changes.

ALTER TABLE "LearnerBillingPlanItem" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

