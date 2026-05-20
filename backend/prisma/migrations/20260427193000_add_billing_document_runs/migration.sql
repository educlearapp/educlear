-- Add BillingDocumentRun + BillingDocumentRunItem for legal letter runs.
-- Safe: new tables only.

CREATE TABLE IF NOT EXISTS "BillingDocumentRun" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "letterDate" TIMESTAMP(3) NOT NULL,
  "deadlineDate" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingDocumentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BillingDocumentRunItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "parentId" TEXT,
  "learnerId" TEXT,
  "accountId" TEXT,
  "parentEmail" TEXT,
  "totalOutstandingBalance" DECIMAL(12,2) NOT NULL,
  "overdueBalance" DECIMAL(12,2) NOT NULL,
  "generatedHtml" TEXT,
  "emailStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingDocumentRunItem_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (safe: ON DELETE policies avoid cascading into core billing tables)
ALTER TABLE "BillingDocumentRun"
  ADD CONSTRAINT "BillingDocumentRun_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingDocumentRunItem"
  ADD CONSTRAINT "BillingDocumentRunItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "BillingDocumentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingDocumentRunItem"
  ADD CONSTRAINT "BillingDocumentRunItem_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingDocumentRunItem"
  ADD CONSTRAINT "BillingDocumentRunItem_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingDocumentRunItem"
  ADD CONSTRAINT "BillingDocumentRunItem_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingDocumentRunItem"
  ADD CONSTRAINT "BillingDocumentRunItem_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "BillingDocumentRun_schoolId_idx" ON "BillingDocumentRun"("schoolId");
CREATE INDEX IF NOT EXISTS "BillingDocumentRun_schoolId_createdAt_idx" ON "BillingDocumentRun"("schoolId", "createdAt");

CREATE INDEX IF NOT EXISTS "BillingDocumentRunItem_runId_idx" ON "BillingDocumentRunItem"("runId");
CREATE INDEX IF NOT EXISTS "BillingDocumentRunItem_schoolId_idx" ON "BillingDocumentRunItem"("schoolId");
CREATE INDEX IF NOT EXISTS "BillingDocumentRunItem_schoolId_emailStatus_idx" ON "BillingDocumentRunItem"("schoolId", "emailStatus");
CREATE INDEX IF NOT EXISTS "BillingDocumentRunItem_parentId_idx" ON "BillingDocumentRunItem"("parentId");
CREATE INDEX IF NOT EXISTS "BillingDocumentRunItem_accountId_idx" ON "BillingDocumentRunItem"("accountId");

