-- EduClear Core Phase 1: tenant-level product module entitlements.
-- ProductModule: CORE | ACCOUNTING | PAYROLL.
-- CORE includes full school-fee Billing. ACCOUNTING and PAYROLL are optional.
-- Additive only. Backfill EVERY existing school with all three modules ENABLED
-- so applying this migration cannot remove Accounting, Payroll, Billing, or any
-- other current capability.

CREATE TYPE "ProductModule" AS ENUM ('CORE', 'ACCOUNTING', 'PAYROLL');

CREATE TABLE "SchoolModuleEntitlement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "module" "ProductModule" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByEmail" TEXT,

    CONSTRAINT "SchoolModuleEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolModuleEntitlement_schoolId_module_key" ON "SchoolModuleEntitlement"("schoolId", "module");
CREATE INDEX "SchoolModuleEntitlement_schoolId_idx" ON "SchoolModuleEntitlement"("schoolId");
CREATE INDEX "SchoolModuleEntitlement_module_idx" ON "SchoolModuleEntitlement"("module");

ALTER TABLE "SchoolModuleEntitlement"
  ADD CONSTRAINT "SchoolModuleEntitlement_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Production-safety backfill: every existing school gets CORE+ACCOUNTING+PAYROLL ENABLED.
INSERT INTO "SchoolModuleEntitlement" ("id", "schoolId", "module", "enabled", "createdAt", "updatedAt")
SELECT
  md5(s."id" || ':' || m.module_code || ':entitlement-backfill'),
  s."id",
  m.module_code::"ProductModule",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "School" s
CROSS JOIN (
  VALUES ('CORE'), ('ACCOUNTING'), ('PAYROLL')
) AS m(module_code)
ON CONFLICT ("schoolId", "module") DO NOTHING;
