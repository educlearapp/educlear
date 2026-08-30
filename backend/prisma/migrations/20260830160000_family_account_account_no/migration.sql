-- Dedicated EduClear account number, separate from FamilyAccount.accountRef
-- (ledger / snapshot join key). Nullable: existing Kid-e-Sys schools keep
-- using accountRef as the visible number until a later optional copy. Multiple
-- NULLs are allowed per school.

ALTER TABLE "FamilyAccount" ADD COLUMN IF NOT EXISTS "accountNo" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "FamilyAccount_schoolId_accountNo_key"
  ON "FamilyAccount"("schoolId", "accountNo");
