-- Additive FamilyAccount merge lifecycle. Existing rows stay active
-- (retiredAt and mergedIntoFamilyAccountId remain NULL). No balances,
-- invoices, payments, or ledger rows are modified.

ALTER TABLE "FamilyAccount" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);
ALTER TABLE "FamilyAccount" ADD COLUMN IF NOT EXISTS "mergedIntoFamilyAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "FamilyAccount_mergedIntoFamilyAccountId_idx" ON "FamilyAccount"("mergedIntoFamilyAccountId");
CREATE INDEX IF NOT EXISTS "FamilyAccount_schoolId_retiredAt_idx" ON "FamilyAccount"("schoolId", "retiredAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'FamilyAccount_mergedIntoFamilyAccountId_fkey'
  ) THEN
    ALTER TABLE "FamilyAccount" ADD CONSTRAINT "FamilyAccount_mergedIntoFamilyAccountId_fkey"
      FOREIGN KEY ("mergedIntoFamilyAccountId") REFERENCES "FamilyAccount"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
