-- EduClock Build 1: Employee↔User link, identity type/country, employeeNumber uniqueness, activation audit.

CREATE TYPE "EmployeeIdentityType" AS ENUM ('SA_ID', 'PASSPORT', 'PERMIT', 'OTHER');

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "identityType" "EmployeeIdentityType";
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "identityCountryCode" TEXT;

-- Normalize blank employee numbers to NULL so uniqueness only applies to real numbers.
UPDATE "Employee"
SET "employeeNumber" = NULL
WHERE "employeeNumber" IS NOT NULL AND BTRIM("employeeNumber") = '';

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_userId_key" ON "Employee"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_schoolId_employeeNumber_key"
  ON "Employee"("schoolId", "employeeNumber");

CREATE INDEX IF NOT EXISTS "Employee_schoolId_identityType_idx"
  ON "Employee"("schoolId", "identityType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Employee_userId_fkey'
  ) THEN
    ALTER TABLE "Employee"
      ADD CONSTRAINT "Employee_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "EduClockActivationAudit" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockActivationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EduClockActivationAudit_schoolId_createdAt_idx"
  ON "EduClockActivationAudit"("schoolId", "createdAt");

CREATE INDEX IF NOT EXISTS "EduClockActivationAudit_userId_idx"
  ON "EduClockActivationAudit"("userId");

CREATE INDEX IF NOT EXISTS "EduClockActivationAudit_employeeId_idx"
  ON "EduClockActivationAudit"("employeeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockActivationAudit_schoolId_fkey'
  ) THEN
    ALTER TABLE "EduClockActivationAudit"
      ADD CONSTRAINT "EduClockActivationAudit_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
