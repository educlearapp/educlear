-- Family account references are Kid-e-Sys school-local identifiers.
-- Preserve existing accountRef values, but scope uniqueness by school.
DROP INDEX IF EXISTS "FamilyAccount_accountRef_key";

CREATE UNIQUE INDEX IF NOT EXISTS "FamilyAccount_schoolId_accountRef_key"
  ON "FamilyAccount"("schoolId", "accountRef");
